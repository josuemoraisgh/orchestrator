'use strict';

const readline = require('node:readline');
const { listAiMemoryTools, callAiMemoryTool, readAiMemoryPage, toolResultText } = require('./aiMemoryMcp');
const { redactSensitiveText } = require('./secretRedaction');

const config = {
  executable: process.env.ORCHESTRATOR_MEMORY_EXECUTABLE || '',
  cwd: process.env.ORCHESTRATOR_MEMORY_PROJECT_PATH || process.cwd(),
  connection: {
    dataDirectory: process.env.ORCHESTRATOR_MEMORY_DATA_DIRECTORY || '',
    configPath: process.env.ORCHESTRATOR_MEMORY_CONFIG_PATH || '',
    url: process.env.ORCHESTRATOR_MEMORY_URL || ''
  },
  scope: {
    workspace: process.env.ORCHESTRATOR_MEMORY_WORKSPACE || '',
    project: process.env.ORCHESTRATOR_MEMORY_PROJECT || '',
    projectId: process.env.ORCHESTRATOR_MEMORY_PROJECT_ID || ''
  },
  taskPath: process.env.ORCHESTRATOR_MEMORY_TASK_PATH || '',
  agentPath: process.env.ORCHESTRATOR_MEMORY_AGENT_PATH || '',
  taskMarker: process.env.ORCHESTRATOR_MEMORY_TASK_MARKER || '',
  agentMarker: process.env.ORCHESTRATOR_MEMORY_AGENT_MARKER || '',
  taskPageId: process.env.ORCHESTRATOR_MEMORY_TASK_PAGE_ID || '',
  agentPageId: process.env.ORCHESTRATOR_MEMORY_AGENT_PAGE_ID || ''
};

const tools = [
  {
    name: 'read_task_context',
    description: 'Read the verified shared AI Memory page for this task or this agent attempt. Page paths and project scope are fixed by Orchestrator.',
    inputSchema: { type: 'object', properties: { target: { type: 'string', enum: ['task', 'agent'] } }, required: ['target'], additionalProperties: false }
  },
  {
    name: 'write_task_context',
    description: 'Update only this agent attempt page in the official AI Memory runtime. The path and project scope are fixed; include a complete continuity update and preserve the required agent marker. The coordinator owns the shared task page.',
    inputSchema: { type: 'object', properties: { target: { type: 'string', enum: ['agent'] }, body: { type: 'string', minLength: 1, maxLength: 30000 } }, required: ['target', 'body'], additionalProperties: false }
  }
];

function respond(id, result, error) {
  process.stdout.write(`${JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })}\n`);
}

function errorResult(message) {
  return { content: [{ type: 'text', text: String(message || 'AI Memory task operation failed.') }], isError: true };
}

function targetInfo(target) {
  if (target === 'task') return { path: config.taskPath, marker: config.taskMarker, pageId: config.taskPageId, setPageId: value => { config.taskPageId = value; } };
  if (target === 'agent') return { path: config.agentPath, marker: config.agentMarker, pageId: config.agentPageId, setPageId: value => { config.agentPageId = value; } };
  throw new Error('Target must be task or agent.');
}

function scopeInput() {
  if (!config.scope.workspace || (!config.scope.project && !config.scope.projectId)) throw new Error('Verified AI Memory project scope is not configured.');
  const scope = { workspace: config.scope.workspace };
  if (config.scope.projectId) scope.project_id = config.scope.projectId;
  else scope.project = config.scope.project;
  return scope;
}

async function readTarget(target) {
  const info = targetInfo(target);
  if (!info.path || !info.marker) throw new Error(`The ${target} AI Memory page is not configured.`);
  const page = await readAiMemoryPage(config.executable, config.cwd, config.scope, info.path, 40000, config.connection);
  if (!page.body.includes(info.marker)) throw new Error(`AI Memory page ${info.path} did not contain the expected continuity marker.`);
  info.setPageId(page.pageId);
  return page;
}

async function callTool(name, args) {
  if (!config.executable || !config.connection.url || !config.connection.dataDirectory || !config.connection.configPath) throw new Error('The managed AI Memory runtime is not configured for this task.');
  if (!/^https?:\/\/127\.0\.0\.1:\d+$/.test(config.connection.url)) throw new Error('The AI Memory endpoint must be a local loopback URL.');
  if (name === 'read_task_context') {
    const page = await readTarget(args?.target);
    return { content: [{ type: 'text', text: JSON.stringify({ path: page.path, page_id: page.pageId, body: page.body, truncated: page.truncated, total_chars: page.totalChars }) }] };
  }
  if (name !== 'write_task_context') throw new Error(`Unsupported Orchestrator AI Memory tool: ${name}`);
  if (args?.target !== 'agent') throw new Error('Workers may write only their own task-scoped attempt page; the coordinator owns the shared task page.');
  const info = targetInfo('agent');
  const body = redactSensitiveText(String(args?.body || '').trim(), 30000);
  if (!info.path || !info.marker) throw new Error(`The ${args?.target} AI Memory page is not configured.`);
  if (!body || body.length > 30000) throw new Error('Memory body must contain 1 to 30000 characters.');
  if (!/^#\s+\S/m.test(body)) throw new Error('Memory body must start with a Markdown H1 heading.');
  if (!body.includes(info.marker)) throw new Error(`Memory body must preserve the required marker: ${info.marker}`);

  const available = await listAiMemoryTools(config.executable, config.cwd, config.connection);
  const writer = available.find(tool => String(tool.name || '').toLowerCase().endsWith('memory_write_page'));
  if (!writer) throw new Error('The official AI Memory runtime does not expose memory_write_page.');
  const input = {
    ...scopeInput(), path: info.path, body,
    tags: ['orchestrator', 'task', 'agent-attempt']
  };
  if (info.pageId) input.expected_page_id = info.pageId;
  else input.create_only = true;

  const result = await callAiMemoryTool(config.executable, config.cwd, writer.name, input, config.connection);
  const text = toolResultText(result);
  if (result?.isError) throw new Error(text || 'AI Memory rejected the page update.');
  const pageId = /"page_id"\s*:\s*"([^"]+)"/i.exec(text)?.[1] || /"pageId"\s*:\s*"([^"]+)"/i.exec(text)?.[1];
  if (!pageId) throw new Error(text.slice(0, 500) || 'AI Memory did not return a page_id.');
  const readback = await readTarget(args.target);
  if (readback.pageId !== pageId || readback.body !== body) throw new Error('AI Memory write did not match the page returned by read-back.');
  info.setPageId(readback.pageId);
  return { content: [{ type: 'text', text: JSON.stringify({ verified: true, path: readback.path, page_id: readback.pageId }) }] };
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (!Object.hasOwn(message, 'id')) return;
  const { id, method, params = {} } = message;
  if (method === 'initialize') {
    respond(id, { protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'orchestrator-task-memory', version: '1.0.0' } });
  } else if (method === 'ping') respond(id, {});
  else if (method === 'tools/list') respond(id, { tools });
  else if (method === 'tools/call') {
    try { respond(id, await callTool(String(params.name || ''), params.arguments || {})); }
    catch (error) { respond(id, errorResult(error.message || error)); }
  } else respond(id, undefined, { code: -32601, message: 'Method not found.' });
});

const { spawn } = require('node:child_process');
const extensionVersion = require('../package.json').version;

function callAiMemoryMcp(executable, cwd, method, params = {}, timeoutMs = 15000, connection = {}) {
  return new Promise((resolve, reject) => {
    const args = connection.url
      ? ['--data-dir', connection.dataDirectory, '--config', connection.configPath, 'mcp-bridge', '--no-session-id', '--server-url', connection.url]
      : ['mcp-bridge', '--no-session-id'];
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let buffer = '';
    let stderr = '';
    let nextId = 1;
    const pending = new Map();
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const request of pending.values()) request.reject(error || new Error('AI Memory MCP bridge closed before replying.'));
      pending.clear();
      if (error) reject(error);
      else resolve(value);
      try { child.stdin.end(); } catch { /* The child may already have closed. */ }
      const killTimer = setTimeout(() => child.kill(), 300);
      killTimer.unref?.();
    };

    const timer = setTimeout(() => finish(new Error(`AI Memory MCP bridge timed out during ${method}.`)), timeoutMs);
    timer.unref?.();
    const send = message => {
      if (settled) return;
      if (child.stdin.destroyed || !child.stdin.writable) return finish(new Error(`AI Memory MCP bridge closed while sending ${method}.`));
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`, error => {
          if (error && !settled) finish(new Error(`AI Memory MCP bridge could not send ${method}: ${error.message || error}`));
        });
      } catch (error) { finish(new Error(`AI Memory MCP bridge could not send ${method}: ${error.message || error}`)); }
    };
    const request = (requestMethod, requestParams) => new Promise((resolveRequest, rejectRequest) => {
      const id = nextId++;
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      send({ jsonrpc: '2.0', id, method: requestMethod, params: requestParams });
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (!Object.prototype.hasOwnProperty.call(message, 'id')) continue;
        const item = pending.get(message.id);
        if (!item) continue;
        pending.delete(message.id);
        if (message.error) item.reject(new Error(message.error.message || `AI Memory MCP error ${message.error.code || ''}`));
        else item.resolve(message.result);
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.once('error', error => finish(error));
    child.stdin.once('error', error => finish(new Error(`AI Memory MCP bridge input failed: ${error.message || error}`)));
    child.once('close', code => {
      if (!settled) finish(new Error(`AI Memory MCP bridge exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ''}`));
    });

    (async () => {
      const initialized = await request('initialize', {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'orchestrator-ai', version: extensionVersion }
      });
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      const result = await request(method, params);
      finish(undefined, result);
      return initialized;
    })().catch(error => finish(error));
  });
}

async function listAiMemoryTools(executable, cwd, connection) {
  const result = await callAiMemoryMcp(executable, cwd, 'tools/list', {}, 15000, connection);
  if (!Array.isArray(result?.tools)) throw new Error('AI Memory MCP bridge returned no tools list.');
  return result.tools;
}

async function callAiMemoryTool(executable, cwd, name, input, connection) {
  return callAiMemoryMcp(executable, cwd, 'tools/call', { name, arguments: input }, 15000, connection);
}

function buildMemoryQueryInput(tool, query, limit = 6) {
  const properties = tool?.inputSchema?.properties || {};
  const queryProperty = ['query', 'q', 'text'].find(name => Object.hasOwn(properties, name));
  if (!queryProperty) throw new Error('AI Memory memory_query does not declare a supported query field.');
  const text = String(query || '').trim();
  if (!text) throw new Error('AI Memory memory_query requires a non-empty query.');
  const input = { [queryProperty]: text.slice(0, 2000) };
  if (Object.hasOwn(properties, 'limit')) {
    const schema = properties.limit;
    const minimum = Number.isFinite(Number(schema.minimum)) ? Math.max(1, Number(schema.minimum)) : 1;
    const maximum = Number.isFinite(Number(schema.maximum)) ? Number(schema.maximum) : 100;
    const requested = Number(limit);
    if (!Number.isFinite(requested) || requested < 1) throw new Error('AI Memory search limit must be a positive integer.');
    input.limit = Math.max(minimum, Math.min(Math.max(minimum, maximum), Math.trunc(requested)));
  }
  return input;
}

function toolResultText(result) {
  return (result?.content || []).map(part => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n');
}

async function readAiMemoryPage(executable, cwd, scope, pagePath, maxChars = 5000, connection) {
  const tools = await listAiMemoryTools(executable, cwd, connection);
  const tool = tools.find(item => String(item.name || '').toLowerCase().endsWith('memory_read_page'));
  if (!tool) throw new Error('AI Memory does not expose memory_read_page.');
  const properties = tool.inputSchema?.properties || {};
  const input = { path: pagePath };
  if (properties.workspace) input.workspace = scope.workspace;
  if (properties.project_id && scope.projectId) input.project_id = scope.projectId;
  else if (properties.project) input.project = scope.project;
  if (properties.max_chars) input.max_chars = Math.min(64000, Math.max(500, Math.trunc(maxChars)));
  const result = await callAiMemoryTool(executable, cwd, tool.name, input, connection);
  const text = toolResultText(result);
  if (result?.isError) throw new Error(text || 'AI Memory could not read the task page.');
  let page;
  try { page = JSON.parse(text); }
  catch { throw new Error(text.slice(0, 500) || 'AI Memory returned an invalid page response.'); }
  if (page.path !== pagePath || typeof page.page_id !== 'string' || !page.page_id || typeof page.body !== 'string') {
    throw new Error('AI Memory did not verify the requested page path, page_id, and body.');
  }
  return {
    path: page.path, pageId: page.page_id, title: String(page.title || ''),
    body: page.body, sections: Array.isArray(page.sections) ? page.sections : [],
    frontmatter: page.frontmatter && typeof page.frontmatter === 'object' ? page.frontmatter : {},
    truncated: page.truncated === true, totalChars: page.total_chars
  };
}

module.exports = { buildMemoryQueryInput, callAiMemoryMcp, callAiMemoryTool, listAiMemoryTools, readAiMemoryPage, toolResultText };

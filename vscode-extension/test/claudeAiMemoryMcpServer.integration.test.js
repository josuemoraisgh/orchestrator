'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const test = require('node:test');
const { AiMemoryRuntime } = require('../src/aiMemoryRuntime');

test('agent MCP bridge redacts secrets before writing an AI Memory attempt page', {
  skip: !process.env.ORCHESTRATOR_AI_MEMORY_BIN
}, async t => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-memory-redaction-'));
  const projectPath = path.join(scratch, 'project');
  await fs.mkdir(projectPath);
  const runtime = new AiMemoryRuntime(path.join(scratch, 'runtime'), async () => process.env.ORCHESTRATOR_AI_MEMORY_BIN);
  let child;
  const cleanup = async () => {
    if (child && child.exitCode === null) child.kill();
    if (child && child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    runtime.dispose();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  };
  t.after(cleanup);

  const connection = await runtime.ensure();
  const taskId = `run-${Date.now()}/task-redaction`;
  const taskMarker = `Task-ID: ${taskId}`;
  const agentMarker = `Agent-ID: codex; profile: test; attempt: 1; task: ${taskId}`;
  const taskPath = `orchestrator/tasks/${taskId}.md`;
  const agentPath = `orchestrator/tasks/${taskId}/agents/codex-attempt-1.md`;
  const env = {
    ...process.env,
    ORCHESTRATOR_MEMORY_EXECUTABLE: connection.executable,
    ORCHESTRATOR_MEMORY_PROJECT_PATH: projectPath,
    ORCHESTRATOR_MEMORY_DATA_DIRECTORY: connection.dataDirectory,
    ORCHESTRATOR_MEMORY_CONFIG_PATH: connection.configPath,
    ORCHESTRATOR_MEMORY_URL: connection.url,
    ORCHESTRATOR_MEMORY_WORKSPACE: 'default',
    ORCHESTRATOR_MEMORY_PROJECT: `redaction-${taskId.replace(/[^a-z0-9-]/gi, '-')}`,
    ORCHESTRATOR_MEMORY_TASK_PATH: taskPath,
    ORCHESTRATOR_MEMORY_AGENT_PATH: agentPath,
    ORCHESTRATOR_MEMORY_TASK_MARKER: taskMarker,
    ORCHESTRATOR_MEMORY_AGENT_MARKER: agentMarker,
    ORCHESTRATOR_MEMORY_TASK_PAGE_ID: '',
    ORCHESTRATOR_MEMORY_AGENT_PAGE_ID: ''
  };
  child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'claudeAiMemoryMcpServer.js')], {
    cwd: projectPath, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!Object.hasOwn(message, 'id')) return;
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message); }
  });
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for MCP response ${id}.`)); }, 20000);
    pending.set(id, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const initialized = await request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.ok(initialized.result?.serverInfo);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const written = await request(2, 'tools/call', { name: 'write_task_context', arguments: {
    target: 'agent', body: `# Attempt\n${agentMarker}\n${taskMarker}\n\nProvider response: password: "two secret words"; token: ghp_abcdefghijklmnopqrstuvwxyz123456.`
  } });
  assert.equal(written.result?.isError, undefined, JSON.stringify(written));
  assert.equal(JSON.parse(written.result.content[0].text).verified, true);

  const read = await request(3, 'tools/call', { name: 'read_task_context', arguments: { target: 'agent' } });
  assert.equal(read.result?.isError, undefined, JSON.stringify(read));
  const content = read.result.content.map(part => part.text || '').join('\n');
  const page = JSON.parse(content);
  assert.match(page.body, new RegExp(agentMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(page.body, /two secret words|ghp_abcdefghijklmnopqrstuvwxyz/);
  assert.match(page.body, /REDACTED/);
});

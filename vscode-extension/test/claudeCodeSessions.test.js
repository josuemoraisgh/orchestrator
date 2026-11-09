const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const cp = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ClaudeCodeSessions } = require('../src/claudeCodeSessions');
const { createClaudePermissionServer } = require('../src/claudePermissionServer');

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.prompt = '';
  child.stdin.on('data', chunk => { child.prompt += chunk.toString(); });
  setImmediate(() => child.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'initial-session' })}\n`));
  child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGTERM')); return true; };
  return child;
}

test('Claude Code session streams progress, resumes its provider session, and reports completion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-claude-test-'));
  const child = fakeChild();
  let executable;
  let args;
  let launchOptions;
  const events = [];
  const sessions = new ClaudeCodeSessions({ spawn: (...values) => { [executable, args, launchOptions] = values; return child; } });
  try {
    const opened = await sessions.start({
      executable: 'claude.exe', prefixArgs: ['cli.js'], root, nodeExecutable: process.execPath,
      model: 'sonnet', effort: 'high', sessionId: 'previous-provider-session', prompt: 'Inspect and summarize',
      requestApproval: async () => true, onEvent: event => events.push(event)
    });
    assert.match(executable, /claude\.exe$/);
    assert.deepEqual(args.slice(0, 1), ['cli.js']);
    assert.ok(args.includes('--resume'));
    assert.ok(args.includes('--input-format') && args.includes('stream-json'));
    assert.ok(args.includes('previous-provider-session'));
    assert.ok(args.includes('--model') && args.includes('sonnet'));
    assert.ok(args.includes('--effort') && args.includes('high'));
    assert.ok(args.includes('mcp__orchestrator_permissions__prompt'));
    assert.equal(launchOptions.cwd, root);
    assert.equal(launchOptions.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.deepEqual(JSON.parse(child.prompt), { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Inspect and summarize' }] } });
    const mcpConfigPath = args[args.indexOf('--mcp-config') + 1];
    const mcpConfig = JSON.parse(await fs.readFile(mcpConfigPath, 'utf8'));
    assert.equal(mcpConfig.mcpServers.orchestrator_permissions.command, process.execPath);
    child.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session-42' })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working on the task' }] } })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-session-42', result: 'Finished' })}\n`);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sessions.poll(opened.id).status, 'answered');
    assert.equal(sessions.poll(opened.id).result, 'Finished');
    assert.equal(sessions.poll(opened.id).providerSessionId, 'claude-session-42');
    assert.ok(events.some(event => event.type === 'assistant-message'));
  } finally {
    sessions.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Claude Code session exposes only the Orchestrator scoped AI Memory bridge when verified task context is supplied', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-claude-memory-test-'));
  const child = fakeChild();
  let args;
  const sessions = new ClaudeCodeSessions({ spawn: (_executable, childArgs) => { args = childArgs; return child; } });
  const memoryBridge = {
    executable: 'C:/tools/ai-memory.exe', projectPath: root,
    connection: { dataDirectory: 'C:/memory/data', configPath: 'C:/memory/data/config.toml', url: 'http://127.0.0.1:43210' },
    scope: { workspace: 'default', project: 'sample-project', projectId: 'project-id' },
    taskPath: 'orchestrator/tasks/run/task-1.md', agentPath: 'orchestrator/tasks/run/task-1/agents/claude-attempt-1.md',
    taskMarker: 'Task-ID: run/task-1', agentMarker: 'Agent-ID: claude; attempt: 1; task: run/task-1', taskPageId: 'task-page-id'
  };
  try {
    await sessions.start({ executable: 'claude.exe', root, nodeExecutable: process.execPath, prompt: 'Inspect the task', memoryBridge });
    const configPath = args[args.indexOf('--mcp-config') + 1];
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const server = config.mcpServers.orchestrator_memory;
    assert.ok(server.args.at(-1).endsWith('claudeAiMemoryMcpServer.js'));
    const allowedTools = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--strict-mcp-config'));
    assert.deepEqual(allowedTools, [
      'mcp__orchestrator_memory__read_task_context',
      'mcp__orchestrator_memory__write_task_context'
    ]);
    assert.equal(server.env.ORCHESTRATOR_MEMORY_URL, memoryBridge.connection.url);
    assert.equal(server.env.ORCHESTRATOR_MEMORY_TASK_PATH, memoryBridge.taskPath);
    assert.equal(server.env.ORCHESTRATOR_MEMORY_AGENT_PATH, memoryBridge.agentPath);
    assert.equal(server.env.ORCHESTRATOR_MEMORY_TASK_PAGE_ID, memoryBridge.taskPageId);
  } finally {
    sessions.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Claude Code session cancellation resolves and releases the worker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-claude-test-'));
  const child = fakeChild();
  const sessions = new ClaudeCodeSessions({ spawn: () => child });
  try {
    const opened = await sessions.start({ executable: 'claude', root, nodeExecutable: process.execPath, prompt: 'Long task', requestApproval: async () => false });
    const stopped = await sessions.stop(opened.id);
    assert.equal(stopped.stopped, true);
    assert.equal(sessions.poll(opened.id).stopped, true);
  } finally {
    sessions.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Claude MCP permission bridge requires its token and refuses checkout escapes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-permission-root-'));
  let requested = 0;
  const server = await createClaudePermissionServer({ root, requestApproval: async () => { requested++; return true; } });
  try {
    const unauthorized = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool_name: 'Bash', input: { command: 'echo ok' } }) });
    assert.equal(unauthorized.status, 404);
    const escaped = await fetch(server.url, { method: 'POST', headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ tool_name: 'Write', input: { file_path: path.join(root, '..', 'outside.txt') } }) });
    assert.deepEqual(await escaped.json(), { behavior: 'deny', message: 'Requested path is outside the task checkout.' });
    assert.equal(requested, 0);
    const allowed = await fetch(server.url, { method: 'POST', headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ tool_name: 'Bash', input: { command: 'git status', cwd: root } }) });
    assert.deepEqual(await allowed.json(), { behavior: 'allow', updatedInput: { command: 'git status', cwd: root } });
    assert.equal(requested, 1);
  } finally {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Claude permission MCP sidecar implements initialize, tool discovery, and approval calls', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-permission-root-'));
  const bridge = await createClaudePermissionServer({ root, requestApproval: async () => true });
  const child = cp.spawn(process.execPath, [path.join(__dirname, '..', 'src', 'claudePermissionMcpServer.js')], {
    env: { ...process.env, ORCHESTRATOR_PERMISSION_URL: bridge.url, ORCHESTRATOR_PERMISSION_TOKEN: bridge.token },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  const messages = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const replies = new Map();
  const waiters = new Map();
  messages.on('line', line => {
    const message = JSON.parse(line);
    if (!Object.hasOwn(message, 'id')) return;
    replies.set(message.id, message);
    waiters.get(message.id)?.(message);
  });
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`MCP request ${method} timed out.`)); }, 2000);
    waiters.set(id, message => { clearTimeout(timer); waiters.delete(id); resolve(message); });
    if (replies.has(id)) { clearTimeout(timer); waiters.delete(id); resolve(replies.get(id)); return; }
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    const initialized = await request(1, 'initialize', { protocolVersion: '2024-11-05' });
    assert.equal(initialized.result.serverInfo.name, 'orchestrator-permissions');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = await request(2, 'tools/list');
    assert.equal(listed.result.tools[0].name, 'prompt');
    const called = await request(3, 'tools/call', { name: 'prompt', arguments: { tool_name: 'Bash', input: { command: 'git status', cwd: root } } });
    assert.deepEqual(JSON.parse(called.result.content[0].text), { behavior: 'allow', updatedInput: { command: 'git status', cwd: root } });
  } finally {
    child.kill();
    await bridge.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

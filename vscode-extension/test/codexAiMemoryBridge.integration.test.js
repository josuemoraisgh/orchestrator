'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const extensionManifest = require('../package.json');
const { AiMemoryRuntime } = require('../src/aiMemoryRuntime');
const { callAiMemoryTool, listAiMemoryTools, readAiMemoryPage, toolResultText } = require('../src/aiMemoryMcp');
const { memoryConfigArgs } = require('../src/codexAppServer');

const aiMemoryExecutable = process.env.ORCHESTRATOR_AI_MEMORY_BIN;
const codexScript = process.env.ORCHESTRATOR_CODEX_CLI;
const enabled = Boolean(aiMemoryExecutable && codexScript);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('Codex app-server reads and writes only its AI Memory task-attempt page', { skip: !enabled }, async t => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-codex-ai-memory-'));
  const runtime = new AiMemoryRuntime(storage, async () => aiMemoryExecutable);
  const profileHome = path.join(storage, 'codex-home');
  const projectPath = process.cwd();
  await fs.mkdir(profileHome, { recursive: true });
  let child;
  let buffer = '';
  let stderr = '';
  let sequence = 0;
  const pending = new Map();
  let threadId = '';

  t.after(async () => {
    const appServerChild = child;
    try { appServerChild?.stdin.end(); appServerChild?.kill(); } catch { /* The app-server may already be stopped. */ }
    if (appServerChild && appServerChild.exitCode === null) await new Promise(resolve => appServerChild.once('exit', resolve));
    const owned = [...runtime.processes.values()];
    runtime.dispose();
    await Promise.all(owned.map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise(resolve => proc.once('exit', resolve))));
    await fs.rm(storage, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  const connection = await runtime.ensure();
  const codexEnvironment = { ...process.env, CODEX_HOME: profileHome };
  const tools = await listAiMemoryTools(aiMemoryExecutable, projectPath, connection);
  const writer = tools.find(item => item.name.endsWith('memory_write_page'));
  assert.ok(writer, 'official AI Memory runtime must expose memory_write_page');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18);
  const scope = { workspace: 'orchestrator-integration', project: `codex-${suffix}` };
  const taskPath = `orchestrator/tasks/integration-${suffix}.md`;
  const agentPath = `orchestrator/tasks/integration-${suffix}/agents/codex-attempt-1.md`;
  const taskMarker = `Task-ID: integration-${suffix}`;
  const agentMarker = `Agent-ID: codex; profile: integration; attempt: 1; task: integration-${suffix}`;
  const taskBody = `# Integration task\n${taskMarker}\n\nShared task page owned by Orchestrator.`;
  const created = await callAiMemoryTool(aiMemoryExecutable, projectPath, writer.name, {
    ...scope, path: taskPath, body: taskBody, tags: ['orchestrator', 'integration'], create_only: true
  }, connection);
  assert.equal(created.isError, false, toolResultText(created));
  const taskPageId = /"page_id"\s*:\s*"([^"]+)"/i.exec(toolResultText(created))?.[1];
  assert.ok(taskPageId, toolResultText(created));

  const memoryBridge = {
    executable: aiMemoryExecutable, projectPath, connection, scope,
    taskPath, agentPath, taskMarker, agentMarker, taskPageId
  };
  const nodeExecutable = process.env.ORCHESTRATOR_CODEX_NODE || process.execPath;
  child = cp.spawn(nodeExecutable, [codexScript, ...memoryConfigArgs(memoryBridge, nodeExecutable), 'app-server', '--listen', 'stdio://'], {
    cwd: projectPath,
    env: codexEnvironment,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8').on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (!pending.has(message.id)) continue;
      const item = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message || 'Codex app-server request failed.'));
      else item.resolve(message.result);
    }
  });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  child.once('error', error => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  });

  function call(method, params = {}) {
    const id = ++sequence;
    const wait = deferred();
    const timer = setTimeout(() => {
      pending.delete(id);
      wait.reject(new Error(`Codex app-server timed out during ${method}.${stderr ? ` ${stderr.trim()}` : ''}`));
    }, 20000);
    pending.set(id, { ...wait, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return wait.promise;
  }

  await call('initialize', { clientInfo: { name: 'orchestrator_ai_memory_test', title: 'Orchestrator-AI integration test', version: extensionManifest.version }, capabilities: {} });
  child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
  const started = await call('thread/start', { cwd: projectPath, approvalPolicy: 'on-request', sandbox: 'workspace-write' });
  threadId = started.thread.id;
  assert.ok(threadId);

  const deadline = Date.now() + 20000;
  let server;
  do {
    const status = await call('mcpServerStatus/list', { threadId, serverName: 'orchestrator_memory', detail: 'toolsAndAuthOnly' });
    server = (status.data || []).find(item => item.name === 'orchestrator_memory');
    if (server?.runtimeStatus === 'connected' && server.tools?.read_task_context && server.tools?.write_task_context) break;
    if (server?.runtimeStatus === 'failed' || server?.runtimeStatus === 'disabled') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  assert.equal(server?.runtimeStatus, 'connected', `${JSON.stringify(server)} ${stderr}`);
  assert.ok(server.tools.read_task_context && server.tools.write_task_context);

  const read = await call('mcpServer/tool/call', { threadId, server: 'orchestrator_memory', tool: 'read_task_context', arguments: { target: 'task' } });
  assert.notEqual(read.isError, true, JSON.stringify(read));
  const readPayload = JSON.parse(toolResultText(read));
  assert.equal(readPayload.path, taskPath);
  assert.equal(readPayload.page_id, taskPageId);
  assert.match(readPayload.body, new RegExp(taskMarker));

  const agentBody = `# Codex attempt\n${agentMarker}\n\n## Work completed\nMCP round-trip verified.`;
  const write = await call('mcpServer/tool/call', {
    threadId, server: 'orchestrator_memory', tool: 'write_task_context',
    arguments: { target: 'agent', body: agentBody }
  });
  assert.notEqual(write.isError, true, JSON.stringify(write));
  assert.match(toolResultText(write), /"verified":true/);

  const forbidden = await call('mcpServer/tool/call', {
    threadId, server: 'orchestrator_memory', tool: 'write_task_context',
    arguments: { target: 'task', body: `# Attack\n${taskMarker}\nreplace shared page` }
  });
  assert.match(toolResultText(forbidden), /Workers may write only their own task-scoped attempt page/i, JSON.stringify(forbidden));

  const savedAgent = await readAiMemoryPage(aiMemoryExecutable, projectPath, scope, agentPath, 4000, connection);
  const savedTask = await readAiMemoryPage(aiMemoryExecutable, projectPath, scope, taskPath, 4000, connection);
  assert.equal(savedAgent.body, agentBody);
  assert.equal(savedTask.body, taskBody, 'rejected worker call must leave the shared task page unchanged');
});

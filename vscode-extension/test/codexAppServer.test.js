'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { CodexAppServerSessions, memoryToolElicitationResponse } = require('../src/codexAppServer');

test('Codex MCP approval accepts only the task-scoped AI Memory read and write tools', () => {
  const memoryBridge = { executable: 'C:/tools/ai-memory.exe', connection: { url: 'http://127.0.0.1:43210' } };
  const request = toolName => ({
    serverName: 'orchestrator_memory', mode: 'form',
    _meta: { codex_approval_kind: 'mcp_tool_call', tool_name: toolName },
    requestedSchema: { type: 'object', properties: {} }
  });

  assert.deepEqual(memoryToolElicitationResponse(request('read_task_context'), memoryBridge), {
    action: 'accept', content: {}, _meta: null
  });
  assert.deepEqual(memoryToolElicitationResponse(request('write_task_context'), memoryBridge), {
    action: 'accept', content: {}, _meta: null
  });
  const codexApproval = request('');
  codexApproval._meta = {
    codex_approval_kind: 'mcp_tool_call',
    tool_description: 'Read the verified shared AI Memory page for this task or this agent attempt. Page paths and project scope are fixed by Orchestrator.'
  };
  assert.equal(memoryToolElicitationResponse(codexApproval, memoryBridge).action, 'accept');
  for (const unsafe of [
    { ...request('shell'), serverName: 'orchestrator_memory' },
    { ...request('read_task_context'), serverName: 'other_server' },
    { ...request('read_task_context'), _meta: { ...request('read_task_context')._meta, codex_approval_kind: 'other' } },
    { ...request('read_task_context'), requestedSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { ...request('read_task_context'), _meta: undefined }
  ]) {
    assert.equal(memoryToolElicitationResponse(unsafe, memoryBridge).action, 'decline');
  }
  assert.equal(memoryToolElicitationResponse(request('read_task_context'), undefined).action, 'decline');
});

function fakeSpawn(options = {}) {
  const children = [];
  const spawn = (executable, args, spawnOptions) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.killed = false;
    child.requests = [];
    child.stdin.setEncoding('utf8');
    let buffer = '';
    child.stdin.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        child.requests.push(request);
        if (request.id !== undefined && !options.noResponses) {
          let result = {};
          if (request.method === 'thread/start') result = { thread: { id: 'thread-1' } };
          if (request.method === 'thread/resume') result = { thread: { id: request.params.threadId } };
          if (request.method === 'mcpServerStatus/list') result = options.memoryDisconnected
            ? { data: [{ name: 'orchestrator_memory', runtimeStatus: 'failed', tools: {} }], nextCursor: null }
            : { data: [{ name: 'orchestrator_memory', runtimeStatus: 'connected', tools: { read_task_context: {}, write_task_context: {} } }], nextCursor: null };
          if (request.method === 'turn/start') result = { turn: { id: 'turn-1' } };
          setImmediate(() => child.stdout.write(JSON.stringify({ id: request.id, result }) + '\n'));
          if (request.method === 'turn/start' && options.complete) setImmediate(() => {
            if (options.lifecycleEvents) {
              child.stdout.write(JSON.stringify({ method: 'item/started', params: { threadId: 'thread-1', item: { id: 'item-1', type: 'commandExecution', command: 'echo private-command' } } }) + '\n');
              child.stdout.write(JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'item-1', type: 'commandExecution', exitCode: 0, aggregatedOutput: 'private tool output' } } }) + '\n');
              child.stdout.write(JSON.stringify({ method: 'turn/plan/updated', params: { threadId: 'thread-1', plan: { steps: [{ step: 'private plan detail' }] } } }) + '\n');
            }
            child.stdout.write(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'feito' } }) + '\n');
            child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: options.status || 'completed' } } }) + '\n');
          });
          if (request.method === 'turn/interrupt') setImmediate(() => child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } } }) + '\n'));
        }
      }
    });
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', 0, null)); return true; };
    children.push({ child, executable, args, spawnOptions });
    return child;
  };
  return { spawn, children };
}

async function waitForStatus(sessions, id, expected) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const state = sessions.poll(id);
    if (state.status === expected) return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return sessions.poll(id);
}

test('starts a bounded Codex app-server turn, streams visible text, and reports only completed turns as answered', async () => {
  const fake = fakeSpawn({ complete: true });
  const sessions = new CodexAppServerSessions({ spawn: fake.spawn });
  const events = [];
  const opened = await sessions.start({ executable: 'codex', cwd: 'C:/project/task', model: 'gpt-test', effort: 'high', prompt: 'Implement this task', onEvent: event => events.push(event) });

  assert.match(opened.id, /^orchestrator-codex-/);
  assert.equal(opened.threadId, 'thread-1');
  const result = await waitForStatus(sessions, opened.id, 'answered');
  assert.equal(result.status, 'answered');
  assert.equal(result.result, 'feito');
  assert.equal(events.filter(event => event.type === 'assistant-delta').length, 1);
  const sent = fake.children[0].child.requests;
  const thread = sent.find(item => item.method === 'thread/start');
  const turn = sent.find(item => item.method === 'turn/start');
  assert.equal(thread.params.model, 'gpt-test');
  assert.equal(thread.params.sandbox, 'workspace-write');
  assert.equal(turn.params.effort, 'high');
  assert.equal(turn.params.sandboxPolicy.writableRoots[0], 'C:/project/task');
  assert.equal(turn.params.sandboxPolicy.networkAccess, false);
});

test('terminates an app-server that never responds during startup', async () => {
  const fake = fakeSpawn({ noResponses: true });
  const sessions = new CodexAppServerSessions({ spawn: fake.spawn });
  await assert.rejects(
    sessions.start({ executable: 'codex', cwd: 'C:/project/task', prompt: 'Start', startupTimeoutMs: 25 }),
    /não iniciou a tarefa em 0 segundos/
  );
  assert.equal(fake.children[0].child.killed, true);
  assert.equal(sessions.poll([...sessions.sessions.keys()][0]).status, 'failed');
});

test('records Codex item and plan lifecycle metadata without copying commands, tool output, or plan text', async () => {
  const fake = fakeSpawn({ complete: true, lifecycleEvents: true });
  const sessions = new CodexAppServerSessions({ spawn: fake.spawn });
  const events = [];
  const opened = await sessions.start({ executable: 'codex', cwd: 'C:/project/task', prompt: 'Implement this task', onEvent: event => events.push(event) });
  await waitForStatus(sessions, opened.id, 'answered');

  const lifecycle = events.filter(event => event.type.startsWith('codex-item-') || event.type === 'codex-plan-updated');
  assert.deepEqual(lifecycle.map(event => event.type), ['codex-item-started', 'codex-item-completed', 'codex-plan-updated']);
  assert.equal(lifecycle[0].toolName, 'commandExecution');
  assert.match(lifecycle[0].summary, /started commandExecution/);
  assert.match(lifecycle[1].summary, /exit code 0/);
  assert.match(lifecycle[2].summary, /1 steps/);
  assert.doesNotMatch(JSON.stringify(lifecycle), /private-command|private tool output|private plan detail/);
});

test('adds task-scoped AI Memory MCP settings only to this Codex app-server process', async () => {
  const fake = fakeSpawn({ complete: false });
  const sessions = new CodexAppServerSessions({ spawn: fake.spawn });
  const memoryBridge = {
    executable: 'C:/tools/ai-memory.exe', projectPath: 'C:/project',
    connection: { url: 'http://127.0.0.1:43210', dataDirectory: 'C:/memory/data', configPath: 'C:/memory/data/config.toml' },
    scope: { workspace: 'default', project: 'sample', projectId: 'project-1' },
    taskPath: 'orchestrator/tasks/run/task.md', agentPath: 'orchestrator/tasks/run/agents/codex-attempt-1.md',
    taskMarker: 'Task-ID: run/task', agentMarker: 'Agent-ID: codex; attempt: 1', taskPageId: 'page-task'
  };
  const opened = await sessions.start({ executable: 'codex', cwd: 'C:/project/task', prompt: 'Continue', nodeExecutable: 'C:/node/node.exe', memoryBridge });
  const { args } = fake.children[0];
  assert.ok(args.includes('mcp_servers={}'), 'the task app-server must not inherit global MCP servers.');
  assert.ok(args.includes('mcp_servers.orchestrator_memory.enabled=true'));
  assert.ok(args.some(value => value.startsWith('mcp_servers.orchestrator_memory.command=')));
  assert.ok(args.some(value => value.startsWith('mcp_servers.orchestrator_memory.args=')));
  assert.ok(args.some(value => value === 'mcp_servers.orchestrator_memory.env.ORCHESTRATOR_MEMORY_AGENT_PATH="orchestrator/tasks/run/agents/codex-attempt-1.md"'));
  assert.equal(args.at(-3), 'app-server');
  assert.ok(fake.children[0].child.requests.some(item => item.method === 'mcpServerStatus/list' && item.params.threadId === 'thread-1'));
  await sessions.stop(opened.id);
});

test('does not start the Codex task turn when the scoped AI Memory bridge is unavailable', async () => {
  const fake = fakeSpawn({ memoryDisconnected: true });
  const sessions = new CodexAppServerSessions({ spawn: fake.spawn });
  const memoryBridge = {
    executable: 'C:/tools/ai-memory.exe', projectPath: 'C:/project',
    connection: { url: 'http://127.0.0.1:43210', dataDirectory: 'C:/memory/data', configPath: 'C:/memory/data/config.toml' },
    scope: { workspace: 'default', project: 'sample', projectId: 'project-1' },
    taskPath: 'orchestrator/tasks/run/task.md', agentPath: 'orchestrator/tasks/run/agents/codex-attempt-1.md',
    taskMarker: 'Task-ID: run/task', agentMarker: 'Agent-ID: codex; attempt: 1', taskPageId: 'page-task'
  };
  await assert.rejects(() => sessions.start({ executable: 'codex', cwd: 'C:/project/task', prompt: 'Continue', nodeExecutable: 'C:/node/node.exe', memoryBridge }), /ponte MCP do AI Memory do Codex não foi confirmada/);
  assert.equal(fake.children[0].child.requests.some(item => item.method === 'turn/start'), false);
});

test('resumes a supplied thread and parks an interrupted task as stopped', async () => {
  const fake = fakeSpawn({ complete: false });
  const sessions = new CodexAppServerSessions({ spawn: fake.spawn });
  const opened = await sessions.start({ executable: 'codex', cwd: 'C:/project/task', threadId: 'thread-existing', prompt: 'Continue from the handoff' });
  assert.equal(opened.threadId, 'thread-existing');
  assert.equal(sessions.poll(opened.id).status, 'pending');
  await sessions.stop(opened.id);
  assert.equal(sessions.poll(opened.id).status, 'failed');
  assert.equal(sessions.poll(opened.id).stopped, true);
});

test('does not treat failed app-server turns as successful', async () => {
  const fake = fakeSpawn({ complete: true, status: 'failed' });
  const sessions = new CodexAppServerSessions({ spawn: fake.spawn });
  const opened = await sessions.start({ executable: 'codex', cwd: 'C:/project/task', prompt: 'Try a bounded task' });
  const result = await waitForStatus(sessions, opened.id, 'failed');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /não concluiu/);
});

test('surfaces a sanitized model-availability diagnostic when Codex rejects a turn', async () => {
  const fake = fakeSpawn({ complete: false });
  const sessions = new CodexAppServerSessions({ spawn: fake.spawn });
  const opened = await sessions.start({ executable: 'codex', cwd: 'C:/project/task', prompt: 'Try a bounded task' });
  const child = fake.children[0].child;
  child.stderr.write('The gpt-example model is not supported for this account. sk-test-secret-token-value\n');
  child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed' } } }) + '\n');

  const result = await waitForStatus(sessions, opened.id, 'failed');
  assert.match(result.error, /gpt-example model is not supported/);
  assert.match(result.error, /\[credential redacted\]/);
  assert.doesNotMatch(result.error, /sk-test-secret-token-value/);
});

test('returns the documented one-time command approval decision over JSON-RPC', async () => {
  const fake = fakeSpawn({ complete: false });
  const sessions = new CodexAppServerSessions({ spawn: fake.spawn });
  const opened = await sessions.start({
    executable: 'codex', cwd: 'C:/project/task', prompt: 'Run the approved task',
    approveRequest: async request => request.method === 'item/commandExecution/requestApproval'
  });
  const child = fake.children[0].child;
  child.stdout.write(JSON.stringify({
    id: 'approval-1', method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'cmd-1', command: 'npm test', cwd: 'C:/project/task' }
  }) + '\n');
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline && !child.requests.some(message => message.id === 'approval-1')) await new Promise(resolve => setTimeout(resolve, 5));
  const response = child.requests.find(message => message.id === 'approval-1');
  assert.deepEqual(response?.result, { decision: 'accept' });
  await sessions.stop(opened.id);
});

test('returns user answers to a blocking app-server question without logging the answer', async () => {
  const fake = fakeSpawn({ complete: false });
  const sessions = new CodexAppServerSessions({ spawn: fake.spawn });
  const opened = await sessions.start({
    executable: 'codex', cwd: 'C:/project/task', prompt: 'Ask the user',
    answerUserInput: async questions => ({ [questions[0].id]: { answers: ['chosen'] } })
  });
  const child = fake.children[0].child;
  child.stdout.write(JSON.stringify({
    id: 'question-1', method: 'item/tool/requestUserInput',
    params: { questions: [{ id: 'choice', header: 'Choice', question: 'Pick one', isOther: false, isSecret: false, options: null }] }
  }) + '\n');
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline && !child.requests.some(message => message.id === 'question-1')) await new Promise(resolve => setTimeout(resolve, 5));
  const response = child.requests.find(message => message.id === 'question-1');
  assert.deepEqual(response?.result, { answers: { choice: { answers: ['chosen'] } } });
  assert.equal(sessions.poll(opened.id).status, 'pending');
  await sessions.stop(opened.id);
});

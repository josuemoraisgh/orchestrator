'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { AiMemoryRuntime } = require('../src/aiMemoryRuntime');
const { callAiMemoryTool, listAiMemoryTools, readAiMemoryPage, toolResultText } = require('../src/aiMemoryMcp');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return {
    lm: { tools: [] },
    CancellationTokenSource: class { constructor() { this.token = {}; } dispose() {} }
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { OrchestratorHomeView } = require('../src/orchestratorHomeView');
Module._load = originalLoad;

test('CLI coordinator searches current-project AI Memory with verified project scope', async () => {
  const tool = {
    name: 'ai-memory/memory_query',
    inputSchema: { properties: {
      query: { type: 'string' },
      limit: { type: 'integer' },
      workspace: { type: 'string' },
      project: { type: 'string' }
    } }
  };
  const calls = [];
  const view = Object.create(OrchestratorHomeView.prototype);
  view.memoryToolsByRoot = new Map();
  view.getState = async () => ({ workspace: 'C:/project' });
  view.taskActions = {
    listMemoryTools: async () => [tool],
    resolveMemoryScope: async () => ({ workspace: 'memory-workspace', project: 'memory-project' }),
    callMemoryTool: async (...args) => {
      calls.push(args);
      return { content: [{ text: JSON.stringify({ hits: [{ path: 'decisions/build.md', snippet: 'Use verified upstream versions.' }] }) }] };
    }
  };

  const excerpt = await view.queryMemoryForCoordinator('C:/project', 'How do we handle upstream builds?');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['C:/project', tool.name, {
    query: 'How do we handle upstream builds?', limit: 6,
    workspace: 'memory-workspace', project: 'memory-project'
  }]);
  assert.match(excerpt, /decisions\/build\.md/);
  assert.match(excerpt, /untrusted historical evidence/);
});

test('coordinator redacts credentials before writing the AI Memory task page', async () => {
  let runs = [{ id: 'run-secret', title: 'Store a safe task summary', tasks: [{
    id: 'task-secret', title: 'Handle provider output', description: 'Capture only safe continuation details.',
    status: 'awaitingReview', provider: 'claude', executor: 'claude-code-cli', attempts: 1,
    result: 'Provider output: password: "two secret words"; token: ghp_abcdefghijklmnopqrstuvwxyz123456',
    history: [], acceptanceCriteria: [], dependsOn: [], memory: { workspace: 'memory-workspace', project: 'memory-project' }
  }] }];
  let savedBody = '';
  const tools = {
    'memory_write_page': { name: 'memory_write_page', bridge: true, inputSchema: { properties: {} } },
    'memory_read_page': { name: 'memory_read_page', bridge: true, inputSchema: { properties: {} } },
    'memory_resolve_write_target': { name: 'memory_resolve_write_target', bridge: true, inputSchema: { properties: {} } }
  };
  const view = Object.create(OrchestratorHomeView.prototype);
  view.memoryToolsByRoot = new Map();
  view.context = { workspaceState: {
    get: (_key, fallback) => runs || fallback,
    update: async (_key, value) => { runs = value; }
  } };
  view.getState = async () => ({ workspace: 'C:/project' });
  view.taskActions = {
    listMemoryTools: async () => Object.values(tools),
    resolveMemoryScope: async () => ({ workspace: 'memory-workspace', project: 'memory-project' }),
    callMemoryTool: async (_root, name, input) => {
      if (name === tools.memory_resolve_write_target.name) {
        return { content: [{ text: JSON.stringify({ project_id: 'project-id', workspace: 'memory-workspace', project: 'memory-project' }) }] };
      }
      if (name === tools.memory_write_page.name) {
        savedBody = input.body;
        return { content: [{ text: JSON.stringify({ page_id: 'page-secret-test' }) }] };
      }
      if (name === tools.memory_read_page.name) {
        return { content: [{ text: JSON.stringify({ page_id: 'page-secret-test', path: input.path, body: savedBody }) }] };
      }
      throw new Error(`Unexpected AI Memory tool: ${name}`);
    }
  };

  const result = await view.recordTaskMemory('run-secret', 'task-secret', 'test-update', 'credential not retained');
  assert.equal(result.verified, true);
  assert.match(savedBody, /Task-ID: run-secret\/task-secret/);
  assert.doesNotMatch(savedBody, /two secret words|ghp_abcdefghijklmnopqrstuvwxyz/);
  assert.match(savedBody, /REDACTED/);
});

test('coordinator creates a clearly attributed attempt page when Codex did not write one', {
  skip: !process.env.ORCHESTRATOR_AI_MEMORY_BIN
}, async t => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-memory-fallback-'));
  const projectRoot = path.join(scratch, 'project');
  await fs.mkdir(projectRoot);
  const runtime = new AiMemoryRuntime(path.join(scratch, 'memory'), async () => process.env.ORCHESTRATOR_AI_MEMORY_BIN);
  const children = [];
  t.after(async () => {
    children.push(...runtime.processes.values());
    runtime.dispose();
    await Promise.all(children.map(child => child.exitCode !== null
      ? Promise.resolve()
      : new Promise(resolve => child.once('exit', resolve))));
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  const connection = await runtime.ensure();
  const tools = await listAiMemoryTools(connection.executable, projectRoot, connection);
  const writer = tools.find(tool => tool.name.endsWith('memory_write_page'));
  assert.ok(writer);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const scope = { workspace: 'default', project: `fallback-${suffix}` };
  const taskPath = `orchestrator/tasks/${suffix}.md`;
  const taskMarker = `Task-ID: run-${suffix}/task-1`;
  const agentPath = `orchestrator/tasks/run-${suffix}/task-1/agents/codex-attempt-1.md`;
  const agentMarker = `Agent-ID: codex; attempt: 1; task: run-${suffix}/task-1`;
  const created = await callAiMemoryTool(connection.executable, projectRoot, writer.name, {
    ...scope, path: taskPath, title: 'Coordinator fallback test', body: `# Task\n${taskMarker}`,
    tags: ['orchestrator', 'integration'], create_only: true
  }, connection);
  assert.equal(created.isError, false, toolResultText(created));
  const taskPageId = /"page_id"\s*:\s*"([^"]+)"/.exec(toolResultText(created))?.[1];
  assert.ok(taskPageId, toolResultText(created));

  let runs = [{ id: `run-${suffix}`, tasks: [{
    id: 'task-1', title: 'Inspect Codex memory handoff', description: 'Confirm continuity is recoverable.',
    acceptanceCriteria: ['The attempt report is readable by another agent.'], attempts: 1,
    executor: 'codex-app-server', provider: 'codex', sessionId: 'codex-session',
    result: 'Codex answered, but no agent attempt page was written. Provider response included password: "two words secret" and a private key block.', status: 'awaitingReview',
    history: [{ at: Date.now(), event: 'result', detail: 'Codex answered.' }],
    memory: {
      workspace: scope.workspace, project: scope.project, projectId: '', taskPagePath: taskPath,
      taskMarker, pageId: taskPageId, agentPagePath: agentPath, agentMarker,
      status: 'coordinator-write-read-verified'
    }
  }] }];
  const context = {
    workspaceState: {
      get: (_key, fallback) => runs || fallback,
      update: async (_key, value) => { runs = value; }
    }
  };
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = context;
  view.getState = async () => ({ workspace: projectRoot });
  view.memoryToolsByRoot = new Map();
  view.taskActions = {
    listMemoryTools: root => listAiMemoryTools(connection.executable, root, connection),
    callMemoryTool: (root, name, input) => callAiMemoryTool(connection.executable, root, name, input, connection),
    resolveMemoryScope: async () => scope
  };

  const task = runs[0].tasks[0];
  const verified = await view.verifyAgentMemoryPage(task, runs[0].id);
  assert.equal(verified, true, task.memory.agentPageVerificationError);
  assert.equal(task.memory.agentPageSource, 'orchestrator-fallback');
  const page = await readAiMemoryPage(connection.executable, projectRoot, scope, agentPath, 10000, connection);
  assert.equal(page.pageId, task.memory.agentPageId);
  assert.match(page.body, new RegExp(agentMarker));
  assert.match(page.body, /Resumo de continuidade gravado pelo Orchestrator/);
  assert.match(page.body, /executor codex-app-server/);
  assert.match(page.body, /Nao e uma transcricao/);
  assert.match(page.body, /Codex answered, but no agent attempt page was written/);
  assert.doesNotMatch(page.body, /two words secret/);
});

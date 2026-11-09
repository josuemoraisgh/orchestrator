'use strict';

// Opt-in provider integration. A real Claude coordinator creates a plan via
// the production chat handler; the production approval and scheduler methods
// then dispatch into a bounded fake worker adapter. No agent process or VS
// Code window is launched by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { checkProfileAuthentication, runCoordinator } = require('../src/coordinatorCli');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return {
    workspace: { isTrusted: true },
    lm: { tools: [], selectChatModels: async () => [] },
    CancellationTokenSource: class { constructor() { this.token = {}; } dispose() {} }
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { OrchestratorHomeView } = require('../src/orchestratorHomeView');
Module._load = originalLoad;

const enabled = process.env.ORCHESTRATOR_LIVE_ORCHESTRATOR_WORKFLOW === '1'
  && Boolean(process.env.ORCHESTRATOR_CLAUDE_BIN);
const taskRunsKey = 'orchestratorAi.taskRuns';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('live coordinator plan stays pending until approval, then reaches the scheduler', {
  skip: !enabled,
  timeout: 180000
}, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-live-workflow-'));
  const project = path.join(temp, 'project');
  await fs.mkdir(project);
  const profile = { id: 'live-claude-workflow', providerId: 'claude', name: 'Live Claude CLI', authorized: true };
  const provider = { id: 'claude', name: 'Claude', executablePath: process.env.ORCHESTRATOR_CLAUDE_BIN, canCoordinateWithCli: true };
  const auth = await checkProfileAuthentication(profile, provider, path.join(temp, 'profiles'), project);
  assert.equal(auth.status, 'verified', auth.text);

  const state = {
    workspace: project,
    config: {
      orchestration: { mode: 'cli', providerId: 'claude', profileId: profile.id, modelId: '', effort: '', allowedProviders: ['claude'], maxParallel: 1, maxAttempts: 2 },
      workerDefaults: { provider: 'claude', model: '', effort: '' }
    },
    coordinatorProfiles: [profile],
    options: { providers: [{
      id: 'claude', name: 'Claude', executablePath: provider.executablePath,
      canCoordinateWithCli: true, canRunClaudeCode: true,
      canRunCodexAppServer: false, canRunInVscodeModel: false, canRunInLich: false, workerModels: []
    }] }
  };
  const values = new Map([
    ['orchestratorAi.chatThreads', [{ id: 'live-thread', title: 'Nova conversa', updatedAt: Date.now(), messages: [] }]],
    ['orchestratorAi.activeThread', 'live-thread'],
    [taskRunsKey, []]
  ]);
  const workspaceState = {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    update: async (key, value) => { values.set(key, value); }
  };
  const startedTasks = [];
  const journalEvents = [];
  const messages = [];
  const context = { workspaceState };
  const view = Object.create(OrchestratorHomeView.prototype);
  Object.assign(view, {
    context,
    getState: async () => state,
    view: { webview: { postMessage: async message => { messages.push(message); } } },
    threadKey: 'orchestratorAi.chatThreads',
    activeKey: 'orchestratorAi.activeThread',
    coordinatorProfileAuth: {},
    memoryToolsByRoot: new Map(),
    schedulingRuns: new Map(),
    rescheduleRuns: new Set(),
    schedulingQueue: Promise.resolve(),
    refreshState: async () => {},
    queryMemoryForCoordinator: async () => 'AI Memory unavailable in this isolated workflow test.',
    findMemoryTool: async () => undefined,
    recordTaskMemory: async () => ({ verified: false }),
    releaseCompletedCheckoutSessions: async () => {},
    settlePendingDispatchAbort: async () => false,
    sharedTaskSlots: {
      ownerId: 'live-workflow-test',
      active: 0,
      register: async () => {},
      reserve: async () => ({ reserved: true }),
      release: async () => {},
      update: async () => {},
      snapshot: async () => ({ active: 0, externalActive: 0, uncertainExternal: 0, leases: [] })
    },
    taskActions: {
      checkCoordinatorProfile: async () => auth,
      runCoordinator: (selectedProfile, selectedProvider, prompt, model, effort) =>
        runCoordinator(selectedProfile, selectedProvider, path.join(temp, 'profiles'), project, prompt, model, effort),
      canUseWorktree: async () => false,
      listBranches: async () => [],
      listSessions: async () => [],
      recordTaskJournal: async (_root, _run, task, event) => { journalEvents.push({ taskId: task.id, event }); },
      start: async input => {
        startedTasks.push(input.task);
        return {
          status: 'running', sessionId: 'bounded-test-worker-session', sessionName: 'Mock worker',
          provider: input.task.provider, profileId: input.task.profileId,
          executor: input.task.executor, projectPath: input.root
        };
      },
      stop: async () => ({ stopped: true })
    }
  });

  t.after(async () => {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  await view.sendMessage('This is a request to perform work, not a question. Return exactly mode="plan" with one task only. The task should ask a worker to report the token LIVE_WORKFLOW_ACCEPTED as its acceptance evidence. Do not answer in mode="answer" and do not start any agent now.');
  let runs = workspaceState.get(taskRunsKey, []);
  assert.equal(runs.length, 1, JSON.stringify({ messages, thread: workspaceState.get('orchestratorAi.chatThreads', []) }));
  assert.equal(runs[0].status, 'awaitingApproval');
  assert.equal(startedTasks.length, 0, 'a real provider plan must not dispatch before explicit user approval');
  assert.equal(runs[0].tasks.length, 1);

  await view.approvePlan(runs[0].id, JSON.stringify({ title: runs[0].title, tasks: runs[0].tasks }));
  runs = workspaceState.get(taskRunsKey, []);
  assert.equal(startedTasks.length, 1, 'approval must pass the validated plan into the task scheduler');
  assert.equal(runs[0].tasks[0].status, 'running');
  assert.equal(runs[0].tasks[0].sessionId, 'bounded-test-worker-session');
  assert.equal(runs[0].tasks[0].executor, 'claude-code-cli');
  assert.ok(journalEvents.some(event => event.event === 'plan-approved'));
  assert.ok(journalEvents.some(event => event.event === 'session-started'));
  assert.ok(messages.some(message => message.type === 'busy' && message.value === false));
});

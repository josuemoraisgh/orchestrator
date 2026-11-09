'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { SharedTaskSlots } = require('../src/sharedTaskSlots');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return {
    lm: { tools: [] }, CancellationTokenSource: class { constructor() { this.token = {}; } dispose() {} },
    workspace: { isTrusted: true }
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { OrchestratorHomeView } = require('../src/orchestratorHomeView');
Module._load = originalLoad;

test('production scheduler starts independent tasks in parallel and cancels only the selected task', async t => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-parallel-scheduler-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const workspace = path.join(scratch, 'project');
  const storage = path.join(scratch, 'extension-storage');
  await fs.mkdir(workspace);
  let runs = [{
    id: 'parallel-run', title: 'Two independent tasks', status: 'approved', paused: false,
    tasks: ['task-a', 'task-b'].map((id, index) => ({
      id, title: id, description: `Run ${id}`, acceptanceCriteria: [`${id} started`],
      dependsOn: [], provider: 'copilot', profileId: '', executor: 'vscode-model',
      model: 'test-model', effort: '', worktree: `orchestrator/${id}`,
      status: 'ready', attempts: 0, history: []
    }))
  }];
  let resolveBothStarted;
  const bothStarted = new Promise(resolve => { resolveBothStarted = resolve; });
  const started = [];
  const stopped = [];
  const liveSessions = [];
  let activeStarts = 0;
  let maximumConcurrentStarts = 0;
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = {
    workspaceState: {
      get: (_key, fallback) => runs || fallback,
      update: async (_key, value) => { runs = value; }
    }
  };
  view.getState = async () => ({
    workspace, config: { orchestration: { maxParallel: 2 } }, coordinatorProfiles: []
  });
  view.sharedTaskSlots = new SharedTaskSlots(storage, 'parallel-test-owner');
  view.rescheduleRuns = new Set();
  view.refreshState = async () => {};
  view.saveRuns = async value => { runs = value; };
  view.recordTaskJournal = async (_root, _run, task) => { task.journal = { status: 'verified' }; return true; };
  view.recordTaskMemory = async () => ({ verified: true });
  view.settlePendingDispatchAbort = async () => false;
  view.releaseCompletedCheckoutSessions = async () => {};
  view.taskActions = {
    canUseWorktree: async () => true,
    listSessions: async () => liveSessions,
    start: async ({ task, root }) => {
      activeStarts++;
      maximumConcurrentStarts = Math.max(maximumConcurrentStarts, activeStarts);
      started.push(task.id);
      if (started.length === 2) resolveBothStarted();
      let timer;
      try {
        await Promise.race([
          bothStarted,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Scheduler did not dispatch both tasks concurrently.')), 3000); })
        ]);
      } finally {
        clearTimeout(timer);
        activeStarts--;
      }
      liveSessions.push({ id: `session-${task.id}`, projectPath: root, state: 'busy' });
      return {
        status: 'running', sessionId: `session-${task.id}`, sessionName: task.id,
        provider: task.provider, profileId: '', executor: task.executor,
        projectPath: root, worktreePath: path.join(root, '.worktrees', task.id),
        threadId: `thread-${task.id}`
      };
    },
    stop: async input => {
      stopped.push(input.session);
      const index = liveSessions.findIndex(session => session.id === input.session);
      if (index >= 0) liveSessions.splice(index, 1);
      return { stopped: true };
    }
  };

  await view.scheduleRunOnce('parallel-run');

  assert.deepEqual(started.sort(), ['task-a', 'task-b']);
  assert.equal(maximumConcurrentStarts, 2);
  assert.deepEqual(runs[0].tasks.map(task => task.status), ['running', 'running']);
  const beforeCancel = await view.sharedTaskSlots.snapshot(workspace, async () => liveSessions);
  assert.equal(beforeCancel.active, 2, JSON.stringify(beforeCancel));

  const cancelled = await view.cancelTask('parallel-run', 'task-a');

  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(stopped, ['session-task-a']);
  assert.deepEqual(runs[0].tasks.map(task => task.status), ['cancelled', 'running']);
  assert.equal(runs[0].status, 'running');
  const afterCancel = await view.sharedTaskSlots.snapshot(workspace, async () => liveSessions);
  assert.equal(afterCancel.active, 1);
});

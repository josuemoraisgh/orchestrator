'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
const vscode = {
  lm: { tools: [] },
  CancellationTokenSource: class { constructor() { this.token = {}; } dispose() {} },
  window: { showInputBox: async () => 'Please add the missing boundary check.' },
  workspace: { isTrusted: true }
};
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};
const { OrchestratorHomeView } = require('../src/orchestratorHomeView');
Module._load = originalLoad;

test('review feedback is persisted and forwarded as the next attempt guidance', async () => {
  const task = {
    id: 'task-1', title: 'Validate input', status: 'awaitingReview', attempts: 1,
    result: 'The first attempt added a parser but missed an empty-input check.',
    sessionId: 'session-1', worktreePath: 'C:/project/.worktrees/task-1',
    history: []
  };
  const run = { id: 'run-1', tasks: [task] };
  let savedRuns;
  let journalEvent;
  let retryArgs;
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = { workspaceState: { get: (_key, fallback) => savedRuns || [run], update: async (_key, value) => { savedRuns = value; } } };
  view.getState = async () => ({ workspace: 'C:/project', config: { orchestration: { maxAttempts: 3 } } });
  view.recordTaskJournal = async (_root, _run, _task, event) => { journalEvent = event; return true; };
  view.retryTask = async (...args) => { retryArgs = args; };

  await view.requestTaskChanges('run-1', 'task-1');

  assert.equal(journalEvent, 'review-feedback-requested');
  assert.equal(savedRuns[0].tasks[0].status, 'blocked');
  assert.equal(savedRuns[0].tasks[0].error, 'A revisão solicitou ajustes.');
  assert.equal(savedRuns[0].tasks[0].history[0].event, 'review-feedback');
  assert.equal(savedRuns[0].tasks[0].history[0].detail, 'Please add the missing boundary check.');
  assert.deepEqual(retryArgs, ['run-1', 'task-1', 'Please add the missing boundary check.']);
});

test('review feedback cannot exceed the configured attempt limit', async () => {
  let prompted = false;
  vscode.window.showInputBox = async () => { prompted = true; return 'retry'; };
  const run = { id: 'run-1', tasks: [{ id: 'task-1', title: 'Validate input', status: 'awaitingReview', attempts: 2 }] };
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = { workspaceState: { get: (_key, fallback) => [run], update: async () => {} } };
  view.getState = async () => ({ workspace: 'C:/project', config: { orchestration: { maxAttempts: 2 } } });

  await assert.rejects(view.requestTaskChanges('run-1', 'task-1'), /limite configurado/);
  assert.equal(prompted, false);
});

test('line-specific review comment is validated, recorded, and forwarded to the retry', async () => {
  const task = { id: 'task-1', title: 'Validate input', status: 'awaitingReview', attempts: 1, worktreePath: 'C:/project/.worktrees/task-1', history: [] };
  const run = { id: 'run-1', tasks: [task] };
  let savedRuns = [run];
  const prompts = ['src/input.js:5', 'Reject empty input before accessing length.'];
  vscode.window.showInputBox = async () => prompts.shift();
  let retryArgs;
  let journalEvent;
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = { workspaceState: { get: (_key, fallback) => savedRuns || fallback, update: async (_key, value) => { savedRuns = value; } } };
  view.getState = async () => ({ workspace: 'C:/project', config: { orchestration: { maxAttempts: 3 } } });
  view.taskActions = { readDiff: async () => ({ verified: true, diffTruncated: false, diffPreview: [
    'diff --git a/src/input.js b/src/input.js', '--- a/src/input.js', '+++ b/src/input.js', '@@ -4,2 +4,3 @@', ' context', '+  if (value.length === 0) return false;', ' context'
  ].join('\n') }) };
  view.recordTaskJournal = async (_root, _run, _task, event) => { journalEvent = event; return true; };
  view.retryTask = async (...args) => { retryArgs = args; };

  await view.requestTaskLineComment('run-1', 'task-1');

  assert.equal(journalEvent, 'review-line-comment');
  assert.deepEqual(task.history[0], {
    at: task.history[0].at, event: 'review-line-comment', path: 'src/input.js', line: 5,
    detail: 'Reject empty input before accessing length.'
  });
  assert.equal(task.status, 'blocked');
  assert.deepEqual(retryArgs, ['run-1', 'task-1', 'Comentário de revisão na linha src/input.js:5:\nReject empty input before accessing length.']);
});

test('line-specific review rejects a line outside the verified diff without retrying', async () => {
  const task = { id: 'task-1', title: 'Validate input', status: 'awaitingReview', attempts: 1, worktreePath: 'C:/project/.worktrees/task-1', history: [] };
  const run = { id: 'run-1', tasks: [task] };
  vscode.window.showInputBox = async () => 'src/input.js:99';
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = { workspaceState: { get: () => [run] } };
  view.getState = async () => ({ workspace: 'C:/project', config: { orchestration: { maxAttempts: 3 } } });
  view.taskActions = { readDiff: async () => ({ verified: true, diffPreview: '--- a/src/input.js\n+++ b/src/input.js\n@@ -1 +1,2 @@\n+added', diffTruncated: false }) };
  let retried = false;
  view.retryTask = async () => { retried = true; };

  await assert.rejects(view.requestTaskLineComment('run-1', 'task-1'), /não é uma linha adicionada/);
  assert.equal(retried, false);
});

test('Orchestrator review UI exposes the corrective feedback action', () => {
  const view = Object.create(OrchestratorHomeView.prototype);
  const html = view.html({ cspSource: 'vscode-webview://test' });
  assert.match(html, /Solicitar ajustes ao agente/);
  assert.match(html, /Comentar linha do diff/);
  assert.match(html, /requestTaskLineComment/);
  assert.match(html, /requestTaskChanges/);
  assert.match(html, /Cancelar tarefa/);
  assert.match(html, /cancelTask/);
});

test('cancelling a selected running task stops and releases only that task', async () => {
  const first = { id: 'task-a', status: 'running', sessionId: 'session-a', provider: 'codex', executor: 'codex-app-server', history: [] };
  const second = { id: 'task-b', status: 'running', sessionId: 'session-b', provider: 'claude', executor: 'claude-code-cli', history: [] };
  let runs = [{ id: 'run-1', status: 'running', tasks: [first, second] }];
  const stopped = [];
  const released = [];
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = { workspaceState: { get: (_key, fallback) => runs || fallback, update: async (_key, value) => { runs = value; } } };
  view.getState = async () => ({ workspace: 'C:/project' });
  view.taskActions = { stop: async input => { stopped.push(input.session); return { stopped: true }; } };
  view.sharedTaskSlots = { release: async (...args) => { released.push(args); } };
  view.recordTaskJournal = async () => true;
  view.recordTaskMemory = async () => ({ verified: true });
  view.refreshState = async () => {};

  const result = await view.cancelTask('run-1', 'task-a');

  assert.deepEqual(result, { status: 'cancelled', error: '' });
  assert.deepEqual(stopped, ['session-a']);
  assert.deepEqual(released, [['C:/project', 'run-1', 'task-a']]);
  assert.equal(runs[0].tasks[0].status, 'cancelled');
  assert.equal(runs[0].tasks[1].status, 'running');
  assert.equal(runs[0].status, 'running');
});

test('failed task cancellation remains running and keeps its resource reservation', async () => {
  const task = { id: 'task-a', status: 'running', sessionId: 'session-a', executor: 'codex-app-server', history: [] };
  let runs = [{ id: 'run-1', status: 'running', tasks: [task] }];
  let released = false;
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = { workspaceState: { get: (_key, fallback) => runs || fallback, update: async (_key, value) => { runs = value; } } };
  view.getState = async () => ({ workspace: 'C:/project' });
  view.taskActions = { stop: async () => ({ stopped: false, sessionState: 'busy' }) };
  view.sharedTaskSlots = { release: async () => { released = true; } };
  view.recordTaskJournal = async () => true;
  view.refreshState = async () => {};

  const result = await view.cancelTask('run-1', 'task-a');

  assert.equal(result.status, 'running');
  assert.match(result.error, /busy/);
  assert.equal(task.status, 'running');
  assert.equal(released, false);
});

test('cancellation during startup marks only the chosen task for stop on dispatch return', async () => {
  const task = { id: 'task-a', status: 'starting', history: [] };
  let runs = [{ id: 'run-1', status: 'running', tasks: [task] }];
  let stopCalled = false;
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = { workspaceState: { get: (_key, fallback) => runs || fallback, update: async (_key, value) => { runs = value; } } };
  view.getState = async () => ({ workspace: 'C:/project' });
  view.taskActions = { stop: async () => { stopCalled = true; return { stopped: true }; } };
  view.recordTaskJournal = async () => true;

  const result = await view.cancelTask('run-1', 'task-a');

  assert.deepEqual(result, { status: 'cancelling' });
  assert.equal(task.status, 'cancelling');
  assert.equal(stopCalled, false);
});

test('cancelRun keeps the run and task active when the adapter cannot confirm stop', async () => {
  const task = { id: 'task-a', status: 'running', sessionId: 'session-a', executor: 'codex-app-server', history: [] };
  let runs = [{ id: 'run-1', status: 'running', tasks: [task] }];
  let released = false;
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = { workspaceState: { get: (_key, fallback) => runs || fallback, update: async (_key, value) => { runs = value; } } };
  view.getState = async () => ({ workspace: 'C:/project' });
  view.taskActions = { stop: async () => ({ stopped: false, sessionState: 'busy' }) };
  view.sharedTaskSlots = { release: async () => { released = true; } };
  view.recordTaskJournal = async () => true;
  view.recordRunJournal = async () => true;
  view.recordTaskMemory = async () => ({ verified: true });
  view.saveRuns = async value => { runs = value; };

  await view.cancelRun('run-1');

  assert.equal(task.status, 'cancelling');
  assert.match(task.error, /busy/);
  assert.equal(runs[0].status, 'cancelling');
  assert.equal(released, false);
});

test('recovery keeps a cancelling session reserved until stop is confirmed', async () => {
  const task = { id: 'task-a', status: 'cancelling', sessionId: 'session-a', executor: 'codex-app-server', history: [] };
  let runs = [{ id: 'run-1', status: 'cancelling', tasks: [task] }];
  let released = false;
  const view = Object.create(OrchestratorHomeView.prototype);
  view.view = {};
  view.polling = false;
  view.context = { workspaceState: { get: (_key, fallback) => runs || fallback, update: async (_key, value) => { runs = value; } } };
  view.getState = async () => ({ workspace: 'C:/project' });
  view.taskActions = { stop: async () => ({ stopped: false, sessionState: 'busy' }) };
  view.sharedTaskSlots = { release: async () => { released = true; } };
  view.refreshState = async () => {};

  await view.pollTasks(true);

  assert.equal(task.status, 'cancelling');
  assert.match(task.error, /busy/);
  assert.equal(runs[0].status, 'cancelling');
  assert.equal(released, false);
  assert.equal(view.polling, false);
});

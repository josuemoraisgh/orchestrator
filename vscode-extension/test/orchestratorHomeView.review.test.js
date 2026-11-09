'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
const vscode = {
  lm: { tools: [] },
  CancellationTokenSource: class { constructor() { this.token = {}; } dispose() {} },
  window: { showInputBox: async () => 'Please add the missing boundary check.' }
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

test('Orchestrator review UI exposes the corrective feedback action', () => {
  const view = Object.create(OrchestratorHomeView.prototype);
  const html = view.html({ cspSource: 'vscode-webview://test' });
  assert.match(html, /Solicitar ajustes ao agente/);
  assert.match(html, /requestTaskChanges/);
});

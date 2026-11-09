'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { TaskJournal } = require('../src/taskJournal');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return {
    lm: { tools: [] },
    workspace: { isTrusted: true, workspaceFolders: [] },
    CancellationTokenSource: class { constructor() { this.token = {}; } dispose() {} }
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { OrchestratorHomeView } = require('../src/orchestratorHomeView');
Module._load = originalLoad;

async function createFixture(t, stopResult = { stopped: true }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-handoff-flow-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  const journal = new TaskJournal(path.join(root, 'storage'));
  const run = { id: 'run-handoff', title: 'Continue task', prompt: 'Implement the requested change.', status: 'running', paused: false, tasks: [] };
  const task = {
    id: 'task-handoff', title: 'Continue implementation', description: 'Continue verified work.',
    acceptanceCriteria: ['Return a verifiable result.'], status: 'running', provider: 'claude',
    executor: 'claude-code-cli', profileId: 'claude-profile', model: 'claude-default', effort: '',
    sessionId: 'claude-session-1', sessionName: 'Claude task', projectPath: project,
    worktreePath: project, dependsOn: [], history: []
  };
  run.tasks.push(task);
  await journal.record(project, run, task, 'session-started');
  const state = {
    workspace: project,
    config: { orchestration: { allowedProviders: ['claude', 'codex'], providerId: 'claude', profileId: 'claude-profile' } },
    options: { providers: [
      { id: 'claude', name: 'Claude', canRunClaudeCode: true },
      { id: 'codex', name: 'Codex', canRunCodexAppServer: true }
    ] },
    coordinatorProfiles: [
      { id: 'claude-profile', providerId: 'claude', authorized: true },
      { id: 'codex-profile', providerId: 'codex', authorized: true }
    ]
  };
  let savedRuns = [run];
  const stopCalls = [];
  const schedulingCalls = [];
  const memoryCalls = [];
  const view = Object.create(OrchestratorHomeView.prototype);
  view.context = { workspaceState: {
    get(key, fallback) { return key === 'orchestratorAi.taskRuns' ? savedRuns : fallback; },
    async update(key, value) { if (key === 'orchestratorAi.taskRuns') savedRuns = value; }
  } };
  view.getState = async () => state;
  view.sharedTaskSlots = { release: async (...args) => { stopCalls.push(['release-slot', ...args]); } };
  view.taskActions = {
    createTaskHandoff: (projectRoot, input) => journal.createHandoff(projectRoot, input),
    claimTaskHandoff: (projectRoot, id, recipient) => journal.claimHandoff(projectRoot, id, recipient),
    cancelTaskHandoff: (projectRoot, id) => journal.cancelHandoff(projectRoot, id),
    releaseTaskHandoff: (projectRoot, id, recipient) => journal.releaseClaimedHandoff(projectRoot, id, recipient),
    recordTaskJournal: (projectRoot, currentRun, currentTask, event) => journal.record(projectRoot, currentRun, currentTask, event),
    start: async input => {
      assert.equal(input.runId, run.id);
      assert.equal(input.task.id, task.id);
      assert.equal(input.task.provider, 'codex');
      assert.equal(input.task.executor, 'codex-app-server');
      assert.equal(input.handoff, 'Objective, verified progress, changed files, and next step.');
      const context = await journal.readContext(project, run.id, task.id);
      assert.equal(context.verified, true);
      assert.match(context.text, /Objective, verified progress, changed files, and next step/);
      return {
        provider: 'codex', executor: 'codex-app-server', profileId: 'codex-profile',
        sessionId: 'codex-session-2', sessionName: 'Codex continuation', status: 'running'
      };
    },
    recordHandoffSessionStarted: (projectRoot, id, recipient, sessionId) => journal.recordHandoffSessionStarted(projectRoot, id, recipient, sessionId),
    stop: async input => { stopCalls.push(['stop', input]); return stopResult; }
  };
  view.recordTaskMemory = async (...args) => { memoryCalls.push(args); return { verified: true }; };
  view.scheduleRun = async runId => {
    schedulingCalls.push(runId);
    const currentRun = savedRuns.find(item => item.id === runId);
    const currentTask = currentRun.tasks.find(item => item.id === task.id);
    currentTask.status = 'starting';
    await view.recordTaskJournal(project, currentRun, currentTask, 'dispatch-starting');
    Object.assign(currentTask, await view.taskActions.start({ runId, task: currentTask, handoff: currentTask.handoff }));
    currentTask.status = 'running';
    await view.recordTaskJournal(project, currentRun, currentTask, 'session-started');
    const receipt = await view.taskActions.recordHandoffSessionStarted(project, currentTask.handoffId, currentTask.handoffRecipient, currentTask.sessionId);
    assert.equal(receipt.recorded, true);
    currentTask.handoffReceipt = { status: 'session-started', sessionId: currentTask.sessionId };
    await view.recordTaskJournal(project, currentRun, currentTask, 'handoff-session-started');
    await view.context.workspaceState.update('orchestratorAi.taskRuns', savedRuns);
  };
  return { project, journal, run, task, view, state, getSavedRuns: () => savedRuns, stopCalls, schedulingCalls, memoryCalls };
}

test('cross-provider handoff claims, parks, journals, and schedules the same task', async t => {
  const fixture = await createFixture(t);
  const result = await fixture.view.handoffTask(fixture.run.id, fixture.task.id, {
    provider: 'codex', executor: 'codex-app-server', profileId: 'codex-profile',
    model: '', effort: '', context: 'Objective, verified progress, changed files, and next step.'
  });

  assert.equal(fixture.stopCalls[0][0], 'stop');
  assert.equal(fixture.stopCalls[0][1].session, 'claude-session-1');
  assert.equal(fixture.task.provider, 'codex');
  assert.equal(fixture.task.executor, 'codex-app-server');
  assert.equal(fixture.task.profileId, 'codex-profile');
  assert.equal(fixture.task.status, 'running');
  assert.equal(fixture.task.sessionId, 'codex-session-2');
  assert.equal(fixture.task.handoff, 'Objective, verified progress, changed files, and next step.');
  assert.equal(result.handoffId, fixture.task.handoffId);
  assert.deepEqual(fixture.schedulingCalls, [fixture.run.id]);
  assert.equal(fixture.memoryCalls.length, 1);

  const handoff = (await fixture.journal.listHandoffs(fixture.project, { runId: fixture.run.id, taskId: fixture.task.id }))[0];
  assert.equal(handoff.status, 'session-started');
  assert.equal(handoff.fromProvider, 'claude');
  assert.equal(handoff.fromSessionId, 'claude-session-1');
  assert.equal(handoff.claimedBy, 'codex:codex-app-server::codex-profile');
  assert.equal(handoff.sessionId, 'codex-session-2');
  const persisted = await fixture.journal.read(fixture.project, fixture.run.id, fixture.task.id);
  assert.equal(persisted.latest.status, 'running');
  assert.equal(persisted.latest.provider, 'codex');
  assert.equal(persisted.latest.handoffId, handoff.id);
  assert.equal(persisted.latest.handoffRecipient, handoff.claimedBy);
  assert.equal(persisted.latest.sessionId, 'codex-session-2');
});

test('failed parking rolls back a claimed handoff and preserves the original worker assignment', async t => {
  const fixture = await createFixture(t, { stopped: false, sessionState: 'busy' });

  await assert.rejects(fixture.view.handoffTask(fixture.run.id, fixture.task.id, {
    provider: 'codex', executor: 'codex-app-server', profileId: 'codex-profile',
    model: '', effort: '', context: 'Continue only after the prior worker has stopped.'
  }), /prior worker was not parked/);

  assert.equal(fixture.task.provider, 'claude');
  assert.equal(fixture.task.sessionId, 'claude-session-1');
  assert.equal(fixture.task.status, 'running');
  assert.deepEqual(fixture.schedulingCalls, []);
  assert.equal(fixture.memoryCalls.length, 0);
  const handoff = (await fixture.journal.listHandoffs(fixture.project, { runId: fixture.run.id, taskId: fixture.task.id }))[0];
  assert.equal(handoff.status, 'cancelled');
});

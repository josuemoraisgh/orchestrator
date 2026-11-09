'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { TaskJournal } = require('../src/taskJournal');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return {
    lm: { tools: [] },
    extensions: { all: [] },
    workspace: { isTrusted: true },
    window: {},
    commands: {}
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { pollCodexAppServerTask, pollClaudeCodeTask } = require('../src/extension');
Module._load = originalLoad;

function foreignSessionHarness(latest) {
  return {
    sessions: { poll: () => ({ status: 'unknown', code: 'SESSION_NOT_OWNED' }) },
    journal: { read: async () => ({ latest }) },
    task: { runId: 'run-1', id: 'task-1', projectPath: 'C:/project', sessionId: 'session-1', threadId: 'thread-1' }
  };
}

test('Codex polling in another VS Code window keeps a live owner session pending', async () => {
  const { sessions, journal, task } = foreignSessionHarness({ status: 'running', sessionId: 'session-1', ownerPid: process.pid });

  const result = await pollCodexAppServerTask(sessions, journal, task);

  assert.deepEqual(result, {
    status: 'pending', sessionState: 'busy', sessionDetail: 'Executando em outra janela do VS Code.'
  });
});

test('Codex polling recovers a completed result from the shared task journal', async () => {
  const { sessions, journal, task } = foreignSessionHarness({
    status: 'awaitingReview', sessionId: 'session-1', result: 'Verified work', threadId: 'thread-2'
  });

  const result = await pollCodexAppServerTask(sessions, journal, task);

  assert.deepEqual(result, { status: 'answered', result: 'Verified work', sessionState: 'done', threadId: 'thread-2' });
});

test('Codex polling fails clearly after the recorded owner exits without a result', async () => {
  const { sessions, journal, task } = foreignSessionHarness({ status: 'running', sessionId: 'session-1', ownerPid: 2147483647 });

  const result = await pollCodexAppServerTask(sessions, journal, task);

  assert.equal(result.status, 'failed');
  assert.match(result.error, /host proprietário.*encerrou/i);
});

test('Codex polling keeps an orphan worker reserved after its owner host exits', async () => {
  const { sessions, journal, task } = foreignSessionHarness({ status: 'running', sessionId: 'session-1', ownerPid: 2147483647, workerPid: process.pid });
  const result = await pollCodexAppServerTask(sessions, journal, task);
  assert.equal(result.status, 'failed');
  assert.equal(result.sessionState, 'orphaned-process');
  assert.match(result.error, /Codex process .*still active/i);
});

test('Codex polling marks an exited owner and worker as resumable from the saved thread', async () => {
  const { sessions, journal, task } = foreignSessionHarness({ status: 'running', sessionId: 'session-1', ownerPid: 2147483647, workerPid: 2147483646, threadId: 'thread-1' });
  const result = await pollCodexAppServerTask(sessions, journal, task);
  assert.equal(result.status, 'failed');
  assert.equal(result.sessionState, 'owner-host-ended');
  assert.match(result.error, /resume the saved thread/i);
});

test('Codex polling records old owner sessions as uncertain when the worker PID was not persisted', async () => {
  const { sessions, journal, task } = foreignSessionHarness({ status: 'running', sessionId: 'session-1', ownerPid: 2147483647 });
  const result = await pollCodexAppServerTask(sessions, journal, task);
  assert.equal(result.sessionState, 'owner-host-ended-unverified');
  assert.ok(result.error.includes('encerrou'));
});

test('Claude polling in another VS Code window keeps a live owner session pending', async () => {
  const { sessions, journal, task } = foreignSessionHarness({ status: 'running', sessionId: 'session-1', ownerPid: process.pid });

  const result = await pollClaudeCodeTask(sessions, journal, task);

  assert.deepEqual(result, {
    status: 'pending', sessionState: 'busy', sessionDetail: 'Executando em outra janela do VS Code.'
  });
});

test('Claude polling identifies an orphan worker and allows recovery only after it exits', async () => {
  const active = foreignSessionHarness({ status: 'running', sessionId: 'session-1', ownerPid: 2147483647, workerPid: process.pid });
  const whileWorkerRuns = await pollClaudeCodeTask(active.sessions, active.journal, active.task);
  assert.equal(whileWorkerRuns.status, 'failed');
  assert.equal(whileWorkerRuns.sessionState, 'orphaned-process');
  assert.match(whileWorkerRuns.error, /Claude process .*still active/i);

  const exited = foreignSessionHarness({ status: 'running', sessionId: 'session-1', ownerPid: 2147483647, workerPid: 2147483646, threadId: 'claude-thread-1' });
  const afterBothExit = await pollClaudeCodeTask(exited.sessions, exited.journal, exited.task);
  assert.equal(afterBothExit.status, 'failed');
  assert.equal(afterBothExit.sessionState, 'owner-host-ended');
  assert.match(afterBothExit.error, /resume the saved session/i);
});

test('Claude polling marks legacy owner records without a worker PID as uncertain', async () => {
  const { sessions, journal, task } = foreignSessionHarness({ status: 'running', sessionId: 'session-1', ownerPid: 2147483647 });

  const result = await pollClaudeCodeTask(sessions, journal, task);

  assert.equal(result.sessionState, 'owner-host-ended-unverified');
  assert.match(result.error, /no worker PID/i);
});

test('separate Codex poller observes running and completed owner updates through the real task journal', async t => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-cross-window-codex-'));
  const project = path.join(storage, 'project');
  await fs.mkdir(project);
  t.after(() => fs.rm(storage, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const journal = new TaskJournal(path.join(storage, 'extension-storage'));
  const run = { id: 'run-1', title: 'Cross-window task', prompt: 'Build the feature' };
  const task = {
    runId: run.id, id: 'task-1', title: 'Implement feature', description: 'Bounded task', acceptanceCriteria: ['Works'],
    status: 'running', provider: 'codex', profileId: 'profile-1', model: 'gpt-test', effort: 'medium',
    executor: 'codex-app-server', attempts: 1, sessionId: 'session-1', threadId: 'thread-1', workerPid: process.pid,
    projectPath: project, worktreePath: project, history: []
  };
  await journal.record(project, run, task, 'session-started');
  const sessionsInSecondWindow = { poll: () => ({ status: 'unknown', code: 'SESSION_NOT_OWNED' }) };

  const whileOwnerRuns = await pollCodexAppServerTask(sessionsInSecondWindow, journal, task);
  assert.equal(whileOwnerRuns.status, 'pending', JSON.stringify(whileOwnerRuns));
  assert.equal(whileOwnerRuns.sessionState, 'busy');

  task.status = 'awaitingReview';
  task.result = 'Implemented and verified';
  task.history.push({ at: Date.now(), event: 'result', detail: task.result });
  await journal.record(project, run, task, 'poll-answered');
  const afterOwnerCompletes = await pollCodexAppServerTask(sessionsInSecondWindow, journal, task);

  assert.deepEqual(afterOwnerCompletes, {
    status: 'answered', result: task.result, sessionState: 'done', threadId: task.threadId
  });
});

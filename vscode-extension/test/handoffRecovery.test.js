'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { reconcileHandoffRecovery, restoreHandoffSession } = require('../src/handoffRecovery');

test('cancels a handoff left pending before claim without stopping the prior agent', () => {
  const run = { id: 'run-1', status: 'running', paused: false };
  const task = { id: 'task-1', status: 'running', provider: 'claude', sessionId: 'old-session', history: [] };
  const outcome = reconcileHandoffRecovery(run, task, [{
    id: 'handoff-1', runId: run.id, taskId: task.id, status: 'pending', fromSessionId: 'old-session'
  }], undefined);

  assert.equal(outcome.action, 'cancel-pending');
  assert.equal(outcome.handoffId, 'handoff-1');
  assert.equal(task.status, 'running');
  assert.equal(task.sessionId, 'old-session');
  assert.equal(task.history.at(-1).event, 'handoff-recovered-before-claim');
});

test('resumes a durable recipient assignment after the previous session was parked', () => {
  const run = { id: 'run-1', status: 'running', paused: false };
  const task = { id: 'task-1', status: 'running', provider: 'claude', sessionId: 'old-session', history: [] };
  const handoff = { id: 'handoff-1', runId: run.id, taskId: task.id, status: 'claimed', claimedBy: 'codex:codex-app-server:gpt-test:profile-1', context: 'Continue the task.' };
  const outcome = reconcileHandoffRecovery(run, task, [handoff], { latest: {
    handoffId: handoff.id, handoffRecipient: handoff.claimedBy, handoff: handoff.context,
    status: 'ready', provider: 'codex', profileId: 'profile-1', model: 'gpt-test', effort: 'low',
    executor: 'codex-app-server', sessionId: '', worktreePath: 'C:/work/task-1'
  } });

  assert.equal(outcome.action, 'resume-recipient');
  assert.equal(task.provider, 'codex');
  assert.equal(task.profileId, 'profile-1');
  assert.equal(task.executor, 'codex-app-server');
  assert.equal(task.sessionId, '');
  assert.equal(task.handoff, 'Continue the task.');
  assert.equal(task.worktreePath, 'C:/work/task-1');
  assert.equal(task.status, 'ready');
  assert.equal(run.status, 'approved');
  assert.equal(run.paused, false);
});

test('blocks an unjournaled claimed handoff instead of relaunching either agent', () => {
  const run = { id: 'run-1', status: 'running', paused: false };
  const task = { id: 'task-1', status: 'running', provider: 'claude', sessionId: 'old-session', history: [] };
  const outcome = reconcileHandoffRecovery(run, task, [{
    id: 'handoff-1', runId: run.id, taskId: task.id, status: 'claimed',
    claimedBy: 'codex:codex-app-server:gpt-test:profile-1', context: 'Continue safely.'
  }], { latest: { status: 'running', provider: 'claude', sessionId: 'old-session' } });

  assert.equal(outcome.action, 'inspect-uncertain-transfer');
  assert.equal(task.status, 'blocked');
  assert.equal(task.provider, 'claude');
  assert.equal(task.sessionId, 'old-session');
  assert.match(task.error, /não há registro durável de que a sessão anterior parou/);
  assert.equal(run.status, 'blocked');
  assert.equal(run.paused, true);
});

test('restores a journaled recipient assignment and blocks after a session-start receipt', () => {
  const run = { id: 'run-1', status: 'running', paused: false };
  const task = { id: 'task-1', status: 'running', provider: 'claude', sessionId: 'old-session', history: [] };
  const handoff = {
    id: 'handoff-1', runId: run.id, taskId: task.id, status: 'session-started',
    claimedBy: 'codex:codex-app-server:gpt-test:profile-1', sessionStartedFor: 'codex:codex-app-server:gpt-test:profile-1',
    sessionId: 'new-session', sessionStartedAt: 1234, context: 'Continue safely.'
  };
  const outcome = reconcileHandoffRecovery(run, task, [handoff], { latest: {
    handoffId: handoff.id, status: 'running', provider: 'codex', profileId: 'profile-1',
    model: 'gpt-test', effort: 'low', executor: 'codex-app-server', sessionId: 'new-session'
  } });

  assert.equal(outcome.action, 'inspect-recipient-session');
  assert.equal(task.provider, 'codex');
  assert.equal(task.sessionId, 'new-session');
  assert.equal(task.handoffReceipt.status, 'session-started');
  assert.equal(task.status, 'blocked');
  assert.equal(run.status, 'blocked');
  assert.equal(run.paused, true);
});

test('preserves a completed result already committed after a handoff', () => {
  const run = { id: 'run-1', status: 'running', paused: false, tasks: [] };
  const task = { id: 'task-1', status: 'running', history: [] };
  run.tasks.push(task);
  const handoff = {
    id: 'handoff-1', runId: run.id, taskId: task.id, status: 'session-started',
    sessionStartedFor: 'codex:codex-app-server:gpt-test:profile-1', sessionId: 'new-session', sessionStartedAt: 1234
  };
  const outcome = reconcileHandoffRecovery(run, task, [handoff], { latest: {
    handoffId: handoff.id, status: 'complete', provider: 'codex', sessionId: 'new-session',
    result: 'Criteria were reviewed and met.'
  } });

  assert.equal(outcome.action, 'preserve-persisted-result');
  assert.equal(task.status, 'complete');
  assert.equal(task.result, 'Criteria were reviewed and met.');
  assert.equal(task.error, undefined);
  assert.equal(run.status, 'complete');
  assert.equal(run.paused, false);
  const repeated = reconcileHandoffRecovery(run, task, [handoff], { latest: {
    handoffId: handoff.id, status: 'complete', provider: 'codex', sessionId: 'new-session',
    result: 'Criteria were reviewed and met.'
  } });
  assert.equal(repeated.changed, false);
  assert.equal(task.history.filter(item => item.event === 'handoff-result-recovered').length, 1);
});

test('preserves a handoff result awaiting user review after restart', () => {
  const run = { id: 'run-1', status: 'blocked', paused: false, tasks: [] };
  const task = { id: 'task-1', status: 'running', history: [] };
  run.tasks.push(task);
  const handoff = {
    id: 'handoff-1', runId: run.id, taskId: task.id, status: 'session-started',
    sessionStartedFor: 'codex:codex-app-server:gpt-test:profile-1', sessionId: 'new-session', sessionStartedAt: 1234
  };
  const outcome = reconcileHandoffRecovery(run, task, [handoff], { latest: {
    handoffId: handoff.id, status: 'awaitingReview', provider: 'codex', sessionId: 'new-session',
    result: 'The worker returned its answer.'
  } });

  assert.equal(outcome.action, 'preserve-persisted-result');
  assert.equal(task.status, 'awaitingReview');
  assert.equal(task.result, 'The worker returned its answer.');
  assert.equal(run.status, 'awaitingReview');
  assert.equal(run.paused, false);
});

test('restores a journaled recipient session and blocks an interrupted dispatch for review', () => {
  const task = { handoffId: 'handoff-1', status: 'starting', history: [] };
  const changed = restoreHandoffSession(task, {
    id: 'handoff-1', status: 'session-started', sessionStartedFor: 'claude:cli:model:profile-1',
    sessionId: 'session-42', sessionStartedAt: 1234
  });

  assert.equal(changed, true);
  assert.equal(task.sessionId, 'session-42');
  assert.equal(task.handoffRecipient, 'claude:cli:model:profile-1');
  assert.equal(task.handoffReceipt.at, 1234);
  assert.equal(task.status, 'blocked');
  assert.match(task.error, /resultado da tarefa não foi salvo/);
  assert.equal(task.history.filter(item => item.event === 'handoff-session-recovered').length, 1);
  assert.equal(restoreHandoffSession(task, {
    id: 'handoff-1', status: 'session-started', sessionStartedFor: 'claude:cli:model:profile-1',
    sessionId: 'session-42', sessionStartedAt: 1234
  }), false);
  assert.equal(task.history.filter(item => item.event === 'handoff-session-recovered').length, 1);
  assert.equal(restoreHandoffSession(task, {
    id: 'handoff-1', status: 'session-started', sessionStartedFor: 'claude:cli:model:profile-1',
    sessionId: 'session-42', sessionStartedAt: 1234
  }), false);
  assert.equal(task.history.filter(item => item.event === 'handoff-session-recovered').length, 1);
});

test('does not infer session creation from pending or merely claimed handoffs', () => {
  const task = { handoffId: 'handoff-1', status: 'starting' };
  assert.equal(restoreHandoffSession(task, { id: 'handoff-1', status: 'claimed' }), false);
  assert.equal(task.sessionId, undefined);
  assert.equal(task.status, 'starting');
});

test('refuses to attach a receipt from another handoff', () => {
  const task = { handoffId: 'handoff-1', status: 'starting' };
  assert.equal(restoreHandoffSession(task, { id: 'handoff-2', status: 'session-started', sessionId: 'session-42' }), false);
  assert.equal(task.sessionId, undefined);
});

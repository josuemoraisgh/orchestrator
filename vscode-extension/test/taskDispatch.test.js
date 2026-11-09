'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { requireTaskDispatch } = require('../src/taskDispatch');

test('failed task delivery parks a returned session and preserves the agent error', async () => {
  const calls = [];
  const started = {
    status: 'failed', error: 'Lich reported an unknown delivery state.',
    sessionId: 'session-1', sessionName: 'worker', projectPath: 'C:/project',
    worktreePath: 'C:/project/.worktrees/task', worktree: 'orchestrator/task'
  };

  await assert.rejects(
    requireTaskDispatch(started, async input => calls.push(input)),
    error => {
      assert.equal(error.message, started.error);
      assert.equal(error.code, 'ORCHESTRATOR_AGENT_START_FAILED');
      assert.equal(error.worktreePath, started.worktreePath);
      assert.equal(error.worktreeBranch, started.worktree);
      assert.equal(error.sessionId, undefined);
      return true;
    }
  );
  assert.deepEqual(calls, [{ session: 'session-1', projectPath: 'C:/project', worktreePath: started.worktreePath }]);
});

test('failed task delivery retains an unparked session identity for operator recovery', async () => {
  const started = { status: 'failed', error: 'Delivery failed.', sessionId: 'session-2', projectPath: 'C:/project' };

  await assert.rejects(
    requireTaskDispatch(started, async () => { throw new Error('provider refused stop'); }),
    error => {
      assert.equal(error.sessionId, 'session-2');
      assert.equal(error.sessionName, 'session-2');
      assert.match(error.message, /could not be parked: provider refused stop/);
      assert.equal(error.projectPath, 'C:/project');
      return true;
    }
  );
});

test('a stop result with stopped false is treated as an unparked session', async () => {
  await assert.rejects(
    requireTaskDispatch({ status: 'failed', error: 'Delivery failed.', sessionId: 'session-4' }, async () => ({ stopped: false, error: 'Session is not owned by this host.' })),
    error => {
      assert.equal(error.sessionId, 'session-4');
      assert.match(error.message, /Session is not owned by this host/);
      return true;
    }
  );
});

test('non-failed task dispatch results pass through unchanged', async () => {
  const started = { status: 'running', sessionId: 'session-3' };
  assert.equal(await requireTaskDispatch(started, async () => assert.fail('must not stop a successful session')), started);
});

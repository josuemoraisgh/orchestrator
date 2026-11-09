'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

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
const { pollCodexAppServerTask } = require('../src/extension');
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

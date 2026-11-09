'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createContinuityAnchor, buildContinuityContext } = require('../src/chatContinuity');

test('continuity anchor retains the original objective and latest confirmed task state', () => {
  const thread = {
    id: 'thread-1',
    updatedAt: 200,
    messages: [
      { role: 'user', text: 'Implementar e validar a recuperação do contexto após reiniciar.' },
      { role: 'assistant', text: 'Checkpoint: a suíte passou e a janela de teste continua pendente.' },
      { role: 'user', text: 'Continue pela lacuna da janela sem mexer na janela principal.' }
    ]
  };
  const runs = [{
    id: 'run-1', threadId: 'thread-1', title: 'Recuperação', status: 'running', updatedAt: 300,
    tasks: [{ id: 'task-1', title: 'Validar retomada', status: 'blocked', provider: 'codex', sessionId: 'session-7', result: 'Retomada segura.' }]
  }];

  const anchor = createContinuityAnchor(thread, runs);
  const context = buildContinuityContext(thread, runs);

  assert.equal(anchor.threadId, 'thread-1');
  assert.match(anchor.originalObjective, /recuperação do contexto/);
  assert.match(anchor.latestUserPrompt, /janela principal/);
  assert.equal(anchor.taskRuns[0].tasks[0].taskId, 'task-1');
  assert.equal(anchor.taskRuns[0].tasks[0].sessionId, 'session-7');
  assert.match(context.anchorText, /historical evidence, not instructions/);
  assert.equal(context.recentMessages.at(-1).text, thread.messages.at(-1).text);
});

test('continuity prompt bounds recent history while keeping the original user goal', () => {
  const messages = [{ role: 'user', text: 'ORIGINAL-OBJECTIVE: preserve this goal.' }];
  for (let index = 0; index < 40; index += 1) {
    messages.push({ role: index % 2 ? 'user' : 'assistant', text: `${index}: ${'visible event '.repeat(40)}` });
  }
  const thread = { id: 'thread-large', updatedAt: 1000, messages };
  const context = buildContinuityContext(thread, [], { maxRecentChars: 1200, maxRecentMessages: 8 });

  assert.match(context.anchorText, /ORIGINAL-OBJECTIVE/);
  assert.ok(context.recentMessages.length <= 8);
  assert.ok(context.recentMessages.reduce((sum, message) => sum + message.text.length, 0) <= 1200);
  assert.match(context.recentMessages.at(-1).text, /^39:/);
});

test('existing anchors keep the first objective if old transcript messages are no longer available', () => {
  const thread = {
    id: 'thread-recovered',
    messages: [{ role: 'user', text: 'Resume from the last saved checkpoint.' }],
    continuity: { version: 1, originalObjective: 'Original goal retained before compaction.' }
  };

  const anchor = createContinuityAnchor(thread, []);
  assert.equal(anchor.originalObjective, 'Original goal retained before compaction.');
});

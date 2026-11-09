'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeLichStartDelivery, normalizeLichWaitOutcome } = require('../src/lichDelivery');

test("start preserves Lich's distinct non-answer delivery states", () => {
  for (const status of ['unread', 'unanswered', 'undelivered', 'stopped', 'expired']) {
    const result = normalizeLichStartDelivery({ status, ticket: 'ticket-1' });
    assert.equal(result.status, 'blocked');
    assert.equal(result.deliveryStatus, status);
    assert.ok(result.error);
  }
});

test('start accepts only a verifiable answer or a pending ticket as active delivery', () => {
  assert.deepEqual(normalizeLichStartDelivery({ status: 'pending', ticket: 'ticket-1' }), {
    status: 'running', deliveryStatus: 'pending', ticket: 'ticket-1', answer: '', error: ''
  });
  assert.equal(normalizeLichStartDelivery({ status: 'pending' }).status, 'blocked');
  assert.equal(normalizeLichStartDelivery({ status: 'answered', answer: 'done' }).status, 'awaitingReview');
  assert.equal(normalizeLichStartDelivery({ status: 'answered' }).status, 'blocked');
  assert.equal(normalizeLichStartDelivery({ status: 'future-status' }).deliveryStatus, 'future-status');
});

test('wait trusts explicit structured delivery states ahead of exit-code fallbacks', () => {
  assert.deepEqual(normalizeLichWaitOutcome({ code: 0, stdout: '{"status":"unread"}' }), {
    status: 'failed', deliveryStatus: 'unread', stopped: false,
    error: 'A tarefa chegou à sessão, mas não há confirmação de que o agente a leu.'
  });
  assert.equal(normalizeLichWaitOutcome({ code: 2, stdout: '{"status":"unanswered"}' }).deliveryStatus, 'unanswered');
  assert.equal(normalizeLichWaitOutcome({ code: 2, stdout: '' }).status, 'pending');
  assert.equal(normalizeLichWaitOutcome({ code: 0, stdout: '{"status":"answered","answer":"ok"}' }).result, 'ok');
});

test('wait does not treat an unknown structured response as an answer', () => {
  const result = normalizeLichWaitOutcome({ code: 0, stdout: '{"status":"future-status"}' });
  assert.equal(result.status, 'failed');
  assert.equal(result.deliveryStatus, 'future-status');
  assert.match(result.error, /estado de entrega reconhecido/);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { modelAccessStatus, modelAccessLabel } = require('../src/modelAccess');

const model = { id: 'test-model' };

test('model access status distinguishes authorized, blocked, and first-consent states', () => {
  assert.equal(modelAccessStatus({ canSendRequest: () => true }, model), 'authorized');
  assert.equal(modelAccessStatus({ canSendRequest: () => false }, model), 'blocked');
  assert.equal(modelAccessStatus({ canSendRequest: () => undefined }, model), 'consent-required');
});

test('model access status fails closed to unknown when access information is absent or throws', () => {
  assert.equal(modelAccessStatus(undefined, model), 'unknown');
  assert.equal(modelAccessStatus({ canSendRequest: () => { throw new Error('not supported'); } }, model), 'unknown');
  assert.equal(modelAccessStatus({ canSendRequest: () => true }, undefined), 'unknown');
  assert.match(modelAccessLabel('consent-required'), /solicitar acesso/);
  assert.match(modelAccessLabel('blocked'), /não está autorizado/);
});

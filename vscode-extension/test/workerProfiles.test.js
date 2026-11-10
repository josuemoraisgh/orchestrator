'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { workerProfileRoutingOptions } = require('../src/workerProfiles');

test('worker profile routing exposes authentication state and per-profile limits', () => {
  const profiles = workerProfileRoutingOptions([
    { id: 'claude-a', name: 'Claude A', providerId: 'claude', authorized: true, maxParallel: 3 },
    { id: 'codex-b', name: 'Codex B', providerId: 'codex', authorized: true, maxParallel: 0 },
    { id: 'disabled', name: 'Disabled', providerId: 'claude', authorized: false, maxParallel: 2 },
    { id: 'unsupported', name: 'Other', providerId: 'gemini', authorized: true, maxParallel: 2 }
  ], {
    'profile:claude-a': { status: 'verified' }
  }, {
    'codex-b': { status: 'unavailable' }
  });

  assert.deepEqual(profiles, [
    { profileId: 'claude-a', name: 'Claude A', providerId: 'claude', authenticationStatus: 'verified', authenticationVerified: true, maxParallel: 3 },
    { profileId: 'codex-b', name: 'Codex B', providerId: 'codex', authenticationStatus: 'unavailable', authenticationVerified: false, maxParallel: 1 }
  ]);
});

test('worker profile routing marks unchecked accounts as unknown instead of ready', () => {
  const profiles = workerProfileRoutingOptions([
    { id: 'claude-new', providerId: 'claude', authorized: true }
  ]);

  assert.equal(profiles[0].authenticationStatus, 'unknown');
  assert.equal(profiles[0].authenticationVerified, false);
});

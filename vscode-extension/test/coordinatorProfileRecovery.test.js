'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { recoverConfiguredCoordinatorProfile } = require('../src/coordinatorProfileRecovery');

const providers = [{ id: 'claude', name: 'Claude', canCoordinateWithCli: true }];

test('recovers the configured profile only after verifying and confirming the current CLI login', async () => {
  const saved = [];
  const events = [];
  const result = await recoverConfiguredCoordinatorProfile({
    providerId: 'claude', profileId: 'selected-claude', profiles: [], providers,
    verifyCurrentLogin: async profile => { events.push(['verify', profile.id]); return { status: 'verified' }; },
    confirmCurrentLogin: async (provider, profile) => { events.push(['confirm', provider.id, profile.id]); return true; },
    saveProfiles: async profiles => { events.push(['save']); saved.push(...profiles); }
  });

  assert.equal(result.status, 'recovered');
  assert.equal(result.profile.id, 'selected-claude');
  assert.equal(result.profile.isolated, false);
  assert.equal(result.profile.authorized, true);
  assert.deepEqual(events.map(item => item[0]), ['verify', 'confirm', 'save']);
  assert.deepEqual(saved, [result.profile]);
});

test('does not confirm or persist when the current CLI login is not verified', async () => {
  let confirmed = false;
  let saved = false;
  const result = await recoverConfiguredCoordinatorProfile({
    providerId: 'claude', profileId: 'selected-claude', providers,
    verifyCurrentLogin: async () => ({ status: 'unverified', text: 'CLI login missing' }),
    confirmCurrentLogin: async () => { confirmed = true; return true; },
    saveProfiles: async () => { saved = true; }
  });

  assert.equal(result.status, 'unauthenticated');
  assert.equal(result.message, 'CLI login missing');
  assert.equal(confirmed, false);
  assert.equal(saved, false);
});

test('does not persist when the user declines to bind the current login', async () => {
  let saved = false;
  const result = await recoverConfiguredCoordinatorProfile({
    providerId: 'claude', profileId: 'selected-claude', providers,
    verifyCurrentLogin: async () => ({ status: 'verified' }),
    confirmCurrentLogin: async () => false,
    saveProfiles: async () => { saved = true; }
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(saved, false);
});

test('does not silently switch when another profile for the provider exists', async () => {
  let verified = false;
  const result = await recoverConfiguredCoordinatorProfile({
    providerId: 'claude', profileId: 'selected-claude',
    profiles: [{ id: 'other-claude', providerId: 'claude', authorized: true }], providers,
    verifyCurrentLogin: async () => { verified = true; return { status: 'verified' }; },
    confirmCurrentLogin: async () => true,
    saveProfiles: async () => assert.fail('must not replace or append to another account')
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(verified, false);
  assert.match(result.message, /evitar trocar de conta automaticamente/);
});

test('does not recover an ID that belongs to a different provider', async () => {
  const result = await recoverConfiguredCoordinatorProfile({
    providerId: 'claude', profileId: 'shared-id',
    profiles: [{ id: 'shared-id', providerId: 'codex', authorized: true }], providers
  });
  assert.equal(result.status, 'unavailable');
  assert.match(result.message, /outro provedor/);
});

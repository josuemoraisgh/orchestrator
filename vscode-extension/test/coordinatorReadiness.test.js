'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCoordinatorCli, resolveCoordinatorSettingsMode } = require('../src/coordinatorReadiness');

const providers = [
  { id: 'claude', name: 'Claude', canCoordinateWithCli: true, canCoordinateInOrchestratorChat: false },
  { id: 'codex', name: 'Codex', canCoordinateWithCli: true, canCoordinateInOrchestratorChat: false },
  { id: 'gemini', name: 'Gemini', canCoordinateWithCli: false }
];
const profiles = [
  { id: 'claude-main', providerId: 'claude', name: 'Claude principal', authorized: true },
  { id: 'claude-disabled', providerId: 'claude', name: 'Claude pausado', authorized: false },
  { id: 'codex-main', providerId: 'codex', name: 'Codex principal', authorized: true }
];

test('saving a CLI coordinator selection does not require a profile to be registered first', () => {
  const result = resolveCoordinatorSettingsMode('claude', 'old-claude-id', providers);
  assert.equal(result.mode, 'cli');
  assert.equal(result.selectedProvider, undefined);
  assert.equal(result.profileId, 'old-claude-id');
});

test('coordinator settings still reject a provider with no supported coordinator interface', () => {
  assert.throws(() => resolveCoordinatorSettingsMode('gemini', '', providers), /Escolha um modelo do VS Code/);
});

test('coordinator settings select a provider published by the VS Code Language Model API', () => {
  const modelProvider = { id: 'vscode:vendor', name: 'Vendor', canCoordinateInOrchestratorChat: true };
  const result = resolveCoordinatorSettingsMode(modelProvider.id, '', [...providers, modelProvider]);
  assert.equal(result.mode, 'vscode');
  assert.equal(result.selectedProvider, modelProvider);
  assert.equal(result.profileId, '');
});

test('CLI coordinator is ready only when the matching provider and authorized profile exist', () => {
  const result = resolveCoordinatorCli({ mode: 'cli', providerId: 'claude', profileId: 'claude-main' }, profiles, providers);
  assert.equal(result.ready, true);
  assert.equal(result.profile.name, 'Claude principal');
  assert.equal(result.provider.name, 'Claude');
  assert.equal(result.message, '');
  assert.equal(result.recoverable, false);
});

test('CLI coordinator exposes recovery only when the missing ID can safely bind the current provider login', () => {
  const recoverable = resolveCoordinatorCli({ mode: 'cli', providerId: 'claude', profileId: 'old-claude-id' }, [], providers);
  assert.equal(recoverable.ready, false);
  assert.equal(recoverable.recoverable, true);

  const anotherProviderProfile = resolveCoordinatorCli({ mode: 'cli', providerId: 'claude', profileId: 'old-claude-id' }, [profiles[2]], providers);
  assert.equal(anotherProviderProfile.recoverable, true);

  const existingProviderProfile = resolveCoordinatorCli({ mode: 'cli', providerId: 'claude', profileId: 'old-claude-id' }, [profiles[0]], providers);
  assert.equal(existingProviderProfile.recoverable, false);

  const occupiedId = resolveCoordinatorCli({ mode: 'cli', providerId: 'claude', profileId: 'codex-main' }, profiles, providers);
  assert.equal(occupiedId.recoverable, false);
});

test('CLI coordinator status reports a profile missing from the current VS Code profile', () => {
  const result = resolveCoordinatorCli({ mode: 'cli', providerId: 'claude', profileId: 'missing' }, profiles, providers);
  assert.equal(result.ready, false);
  assert.match(result.message, /não está cadastrado neste perfil do VS Code/);
});

test('CLI coordinator status distinguishes a disabled profile', () => {
  const result = resolveCoordinatorCli({ mode: 'cli', providerId: 'claude', profileId: 'claude-disabled' }, profiles, providers);
  assert.equal(result.ready, false);
  assert.match(result.message, /está desautorizado/);
});

test('CLI coordinator status rejects a profile registered for a different provider', () => {
  const result = resolveCoordinatorCli({ mode: 'cli', providerId: 'claude', profileId: 'codex-main' }, profiles, providers);
  assert.equal(result.ready, false);
  assert.match(result.message, /não está cadastrado/);
});

test('CLI coordinator status distinguishes no selected profile and unavailable CLI', () => {
  const noProfile = resolveCoordinatorCli({ mode: 'cli', providerId: 'claude' }, profiles, providers);
  assert.match(noProfile.message, /nenhum perfil foi selecionado/);

  const unavailable = resolveCoordinatorCli({ mode: 'cli', providerId: 'gemini', profileId: 'gemini-main' }, profiles, providers);
  assert.equal(unavailable.ready, false);
  assert.match(unavailable.message, /CLI compatível não está disponível/);
});

test('VS Code model coordinators are outside CLI readiness checks', () => {
  assert.deepEqual(resolveCoordinatorCli({ mode: 'vscode', providerId: 'claude' }, profiles, providers), {
    ready: false, recoverable: false, profile: undefined, provider: undefined, message: ''
  });
});

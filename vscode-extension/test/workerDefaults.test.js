'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveWorkerDefaults } = require('../src/workerDefaults');

test('worker defaults select any detected first-party or compatibility executor', () => {
  const providers = [
    { id: 'vscode:gemini', canRunInVscodeModel: true },
    { id: 'claude', canRunClaudeCode: true, canRunInLich: true, cliKind: 'claude' }
  ];
  assert.deepEqual(resolveWorkerDefaults(providers, { provider: 'claude', model: 'sonnet', effort: 'high' }), {
    provider: 'claude', model: 'sonnet', effort: 'high'
  });
  assert.deepEqual(resolveWorkerDefaults(providers, { provider: 'vscode:gemini' }), {
    provider: 'vscode:gemini', model: '', effort: ''
  });
});

test('worker defaults fall back to an available executor when the saved provider disappears', () => {
  assert.deepEqual(resolveWorkerDefaults([{ id: 'codex', canRunCodexAppServer: true }], { provider: 'missing', model: 'gpt-5-codex' }), {
    provider: 'codex', model: 'gpt-5-codex', effort: ''
  });
});

test('worker defaults reject unsupported generic effort on a VS Code-only model', () => {
  assert.throws(() => resolveWorkerDefaults([{ id: 'vscode:gemini', name: 'Gemini', canRunInVscodeModel: true }], { provider: 'vscode:gemini', effort: 'high' }), /does not expose a generic effort setting/);
});

test('compatibility executor limitations are enforced only when no native adapter exists', () => {
  assert.throws(() => resolveWorkerDefaults([{ id: 'crush', canRunInLich: true, cliKind: 'crush' }], { provider: 'crush', model: 'model-x' }), /does not accept --model/);
  assert.deepEqual(resolveWorkerDefaults([{ id: 'claude', canRunInLich: true, cliKind: 'claude', canRunClaudeCode: true }], { provider: 'claude', model: 'sonnet', effort: 'high' }), {
    provider: 'claude', model: 'sonnet', effort: 'high'
  });
});

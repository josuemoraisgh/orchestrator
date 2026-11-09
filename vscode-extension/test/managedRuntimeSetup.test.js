'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ensureManagedAiMemory } = require('../src/managedRuntimeSetup');

test('managed runtime setup starts and verifies AI Memory without a Lich runtime', async () => {
  let calls = 0;
  const progress = [];
  const connection = { version: '3.4.3', executable: 'C:/tools/ai-memory.exe', dataDirectory: 'C:/data' };
  const result = await ensureManagedAiMemory({ ensure: async () => { calls++; return connection; } }, { report: update => progress.push(update) });

  assert.equal(calls, 1);
  assert.deepEqual(result, connection);
  assert.deepEqual(progress, [{ message: 'AI Memory 3.4.3 ready', increment: 100 }]);
});

test('managed runtime setup fails closed when AI Memory cannot confirm its runtime', async () => {
  await assert.rejects(ensureManagedAiMemory({ ensure: async () => ({ version: '3.4.3' }) }), /did not confirm its runtime/);
  await assert.rejects(ensureManagedAiMemory(undefined), /runtime is unavailable/);
});

test('managed runtime status normalizes a v-prefixed release version', async () => {
  const progress = [];
  const result = await ensureManagedAiMemory({ ensure: async () => ({ version: 'v3.4.3', executable: 'ai-memory.exe' }) }, { report: update => progress.push(update) });
  assert.equal(result.version, '3.4.3');
  assert.equal(progress[0].message, 'AI Memory 3.4.3 ready');
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { verifyKnowledgeSourceFiles } = require('../src/aiMemorySources');

test('Git source provenance uses HEAD only for tracked and clean repository files', async () => {
  const calls = [];
  const runOutcome = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return { code: 0, stdout: 'abcdef1234567890' };
    if (args[1] === 'ls-files') return { code: 0, stdout: 'docs/architecture.md' };
    if (args[1] === 'status') return { code: 0, stdout: '' };
    throw new Error(`Unexpected Git call: ${args.join(' ')}`);
  };
  const sources = await verifyKnowledgeSourceFiles('C:/repo', ['docs\\architecture.md', 'docs/architecture.md'], runOutcome);
  assert.deepEqual(sources, [{ path: 'docs/architecture.md', commit: 'abcdef1234567890' }]);
  assert.ok(calls.some(args => args[0] === '--literal-pathspecs'));
});

test('source provenance rejects absolute paths, traversal, and unsupported filenames', async () => {
  const runOutcome = async () => ({ code: 0, stdout: 'abcdef1234567890' });
  for (const input of ['/root/file.md', 'C:/file.md', '../file.md', 'docs/../file.md', 'docs//file.md', 'docs/a\nsecret.md']) {
    await assert.rejects(verifyKnowledgeSourceFiles('repo', [input], runOutcome), /Invalid Git source path/);
  }
});

test('source provenance refuses untracked files or files with local changes', async () => {
  const untracked = async (_command, args) => args[0] === 'rev-parse'
    ? { code: 0, stdout: 'abcdef1234567' }
    : { code: 1, stdout: '' };
  await assert.rejects(verifyKnowledgeSourceFiles('repo', ['src/new.js'], untracked), /not tracked/);

  const dirty = async (_command, args) => {
    if (args[0] === 'rev-parse') return { code: 0, stdout: 'abcdef1234567' };
    if (args[1] === 'ls-files') return { code: 0, stdout: 'src/module.js' };
    return { code: 0, stdout: ' M src/module.js' };
  };
  await assert.rejects(verifyKnowledgeSourceFiles('repo', ['src/module.js'], dirty), /local changes/);
});

test('source provenance rejects more files than AI Memory accepts', async () => {
  const inputs = Array.from({ length: 17 }, (_value, index) => `src/file-${index}.js`);
  await assert.rejects(verifyKnowledgeSourceFiles('repo', inputs, async () => ({ code: 0, stdout: 'abcdef1234567' })), /16 source files/);
});

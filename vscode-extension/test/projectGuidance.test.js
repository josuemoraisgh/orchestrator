'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadProjectGuidance } = require('../src/projectGuidance');

test('loads project rules and skills in stable order while redacting credentials', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-guidance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.ai', 'specs'), { recursive: true });
  await fs.mkdir(path.join(root, '.ai', 'skills', 'build'), { recursive: true });
  await fs.mkdir(path.join(root, '.github', 'instructions'), { recursive: true });
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Rules\nUse the documented build workflow.\npassword="private value"');
  await fs.writeFile(path.join(root, '.ai', 'specs', 'PRODUCT.md'), '# Product\nCoordinate agents and preserve task context.');
  await fs.writeFile(path.join(root, '.ai', 'skills', 'build', 'SKILL.md'), '# Build skill\nRun the configured checks.');
  await fs.writeFile(path.join(root, '.github', 'instructions', 'review.instructions.md'), '# Review rules\nCheck the diff.');
  await fs.writeFile(path.join(root, '.env'), 'SECRET=do-not-read');

  const guidance = await loadProjectGuidance(root);
  assert.deepEqual(guidance.files, [
    'AGENTS.md', '.ai/specs/PRODUCT.md', '.ai/skills/build/SKILL.md', '.github/instructions/review.instructions.md'
  ]);
  assert.match(guidance.text, /Use the documented build workflow/);
  assert.match(guidance.text, /Coordinate agents and preserve task context/);
  assert.match(guidance.text, /Run the configured checks/);
  assert.match(guidance.text, /Check the diff/);
  assert.match(guidance.text, /password="\[REDACTED\]"/);
  assert.doesNotMatch(guidance.text, /private value|do-not-read/);
});

test('bounds project guidance and reports omitted content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-guidance-bound-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.ai', 'specs'), { recursive: true });
  await fs.writeFile(path.join(root, '.ai', 'specs', 'large.md'), 'x'.repeat(8000));
  const guidance = await loadProjectGuidance(root);
  assert.equal(guidance.truncated, true);
  assert.ok(guidance.text.length < 7000);
  assert.match(guidance.text, /Some project guidance files were omitted or truncated/);
});

test('does not follow a guidance symlink outside the workspace', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-guidance-link-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-guidance-outside-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, '.ai', 'skills'), { recursive: true });
  await fs.writeFile(path.join(outside, 'escape.md'), 'OUTSIDE_PRIVATE_GUIDANCE');
  try { await fs.symlink(outside, path.join(root, '.ai', 'skills', 'linked'), 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('This platform does not allow symlink creation in the test environment.');
    throw error;
  }
  const guidance = await loadProjectGuidance(root);
  assert.doesNotMatch(guidance.text, /OUTSIDE_PRIVATE_GUIDANCE/);
});

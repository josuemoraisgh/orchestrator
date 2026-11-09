'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveUpstreamDirectory } = require('../src/upstreamPaths');

async function workspaceFixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-upstreams-'));
  const workspace = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  await fs.mkdir(path.join(workspace, 'vendor', 'source'), { recursive: true });
  await fs.mkdir(outside);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, workspace, outside };
}

test('resolves an existing relative upstream directory inside the workspace', async t => {
  const { workspace } = await workspaceFixture(t);
  assert.equal(
    await resolveUpstreamDirectory(workspace, 'vendor/source'),
    await fs.realpath(path.join(workspace, 'vendor/source'))
  );
});

test('rejects absolute, empty, and traversing upstream paths', async t => {
  const { workspace, outside } = await workspaceFixture(t);
  await assert.rejects(resolveUpstreamDirectory(workspace, ''), /non-empty relative path/);
  await assert.rejects(resolveUpstreamDirectory(workspace, outside), /non-empty relative path/);
  await assert.rejects(resolveUpstreamDirectory(workspace, '../outside'), /escapes workspace/);
});

test('rejects an upstream symlink whose target is outside the workspace', async t => {
  const { workspace, outside } = await workspaceFixture(t);
  await fs.mkdir(path.join(outside, 'nested'));
  const link = path.join(workspace, 'vendor', 'external');
  await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveUpstreamDirectory(workspace, 'vendor/external/nested'), /resolves outside the workspace/);
});

test('rejects an upstream path that is a file', async t => {
  const { workspace } = await workspaceFixture(t);
  await fs.writeFile(path.join(workspace, 'vendor', 'source-file'), 'not a directory');
  await assert.rejects(resolveUpstreamDirectory(workspace, 'vendor/source-file'), /not a directory/);
});

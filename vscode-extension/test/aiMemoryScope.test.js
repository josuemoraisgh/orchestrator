'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { projectFromPath, resolveAiMemoryScope } = require('../src/aiMemoryScope');

test('path-derived AI Memory projects distinguish same-named local projects', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-memory-scope-'));
  try {
    const first = path.join(base, 'one', 'repo');
    const second = path.join(base, 'two', 'repo');
    await fs.mkdir(first, { recursive: true });
    await fs.mkdir(second, { recursive: true });

    const options = { homeDir: '', getRepoRoot: async () => '', getRemote: async () => '' };
    const firstScope = await resolveAiMemoryScope(first, options);
    const secondScope = await resolveAiMemoryScope(second, options);

    assert.notEqual(firstScope.project, secondScope.project);
    assert.match(firstScope.project, /^repo-[a-f0-9]{10}$/);
    assert.equal(firstScope.project, projectFromPath(first));
    assert.equal(firstScope.project, (await resolveAiMemoryScope(first, options)).project);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('configured and marker scopes keep their existing project names', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-memory-scope-'));
  try {
    const configuredRoot = path.join(base, 'configured');
    const markerRoot = path.join(base, 'marked');
    await fs.mkdir(configuredRoot);
    await fs.mkdir(markerRoot);
    await fs.writeFile(path.join(markerRoot, '.ai-memory.toml'), 'workspace = "team"\nproject = "legacy-project"\n');

    const common = { homeDir: '', getRepoRoot: async () => '', getRemote: async () => 'https://example.com/owner/repo.git' };
    assert.deepEqual(await resolveAiMemoryScope(configuredRoot, { ...common, config: { workspace: 'team', project: 'configured-project' } }), {
      workspace: 'team', project: 'configured-project', source: 'settings'
    });
    assert.deepEqual(await resolveAiMemoryScope(markerRoot, common), {
      workspace: 'team', project: 'legacy-project', source: path.join(markerRoot, '.ai-memory.toml')
    });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('remote-derived AI Memory project naming remains unchanged', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-memory-scope-'));
  try {
    const scope = await resolveAiMemoryScope(root, {
      homeDir: '', getRepoRoot: async () => '', getRemote: async () => 'https://github.com/owner/repo.git'
    });
    assert.equal(scope.project, 'owner-repo');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

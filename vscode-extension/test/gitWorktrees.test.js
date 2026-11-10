'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { GitWorktrees, parseWorktrees, normalizedPath, branchNameKey, includePatternMatches, isIncludedPath } = require('../src/gitWorktrees');

test('worktree path identity follows filesystem case sensitivity', () => {
  assert.equal(normalizedPath('C:\\Projects\\Orchestrator', 'win32'), 'c:/projects/orchestrator');
  assert.equal(normalizedPath('/home/user/Projects/Orchestrator', 'linux'), '/home/user/Projects/Orchestrator');
  assert.equal(normalizedPath('/home/user/Projects/Orchestrator', 'darwin'), '/home/user/Projects/Orchestrator');
});

test('worktree branch identity follows platform ref storage semantics', () => {
  assert.equal(branchNameKey('refs/heads/Feature/Task', 'win32'), 'feature/task');
  assert.equal(branchNameKey('refs/heads/Feature/Task', 'linux'), 'Feature/Task');
  assert.equal(branchNameKey('refs/heads/Feature/Task', 'darwin'), 'Feature/Task');
});

async function repoFixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-worktrees-'));
  const repo = path.join(base, 'repo');
  await fs.mkdir(repo);
  const git = args => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git(['init', '-q']);
  git(['config', 'user.email', 'orchestrator-test@example.invalid']);
  git(['config', 'user.name', 'Orchestrator Test']);
  await fs.writeFile(path.join(repo, 'tracked.txt'), 'baseline\n');
  git(['add', 'tracked.txt']);
  git(['commit', '-qm', 'baseline']);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, repo, storage: path.join(base, 'storage') };
}

test('first-party worktrees isolate task writes and verify checkout identity on resume', async t => {
  const { base, repo, storage } = await repoFixture(t);
  const worktrees = new GitWorktrees(storage);
  await fs.writeFile(path.join(repo, 'uncommitted.txt'), 'keep in main checkout');
  const checkout = await worktrees.open(repo, { runId: 'run-123', taskId: 'task-abc', attempt: 1 });
  assert.equal((await fs.readFile(path.join(checkout.path, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'baseline\n');
  await fs.writeFile(path.join(checkout.path, 'worker.txt'), 'isolated');
  assert.equal(await fs.readFile(path.join(repo, 'uncommitted.txt'), 'utf8'), 'keep in main checkout');
  await assert.rejects(fs.stat(path.join(repo, 'worker.txt')), { code: 'ENOENT' });
  const resumed = await worktrees.open(repo, { existingPath: checkout.path });
  assert.equal(resumed.path, checkout.path);
  assert.equal(resumed.branch, checkout.branch);
  assert.equal(resumed.reused, true);
  const entries = await worktrees.inspect(repo);
  assert.ok(entries.some(item => item.branch === `refs/heads/${checkout.branch}`));
  assert.ok(path.resolve(checkout.path).startsWith(path.resolve(base)));
});

test('worktree parser preserves paths with spaces and detached entries', () => {
  assert.deepEqual(parseWorktrees('worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/task path\nHEAD def\ndetached\n'), [
    { worktree: 'C:/repo', HEAD: 'abc', branch: 'refs/heads/main' },
    { worktree: 'C:/task path', HEAD: 'def', detached: true }
  ]);
});

test('worktree include patterns support anchored paths, globs, and ordered exclusions', () => {
  assert.equal(includePatternMatches('.env.local', '.env*'), true);
  assert.equal(includePatternMatches('config/dev.json', '/config/*.json'), true);
  assert.equal(includePatternMatches('nested/config/dev.json', '/config/*.json'), false);
  assert.equal(includePatternMatches('nested/config/dev.json', '**/config/*.json'), true);
  assert.equal(includePatternMatches('config/private/dev.json', 'config/'), true);
  assert.equal(isIncludedPath('secrets/dev.json', ['secrets/**', '!secrets/prod.json']), true);
  assert.equal(isIncludedPath('secrets/prod.json', ['secrets/**', '!secrets/prod.json']), false);
});

test('new worktrees copy only selected ignored regular files without overwriting tracked files', async t => {
  const { repo, storage } = await repoFixture(t);
  await fs.mkdir(path.join(repo, 'config'));
  await fs.writeFile(path.join(repo, '.gitignore'), '.env*\nconfig/*.local.json\nprivate/**\n');
  await fs.writeFile(path.join(repo, 'config', 'tracked.local.json'), 'tracked baseline');
  execFileSync('git', ['add', '.gitignore'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['add', '-f', 'config/tracked.local.json'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', 'ignore and tracked config'], { cwd: repo, stdio: 'ignore' });
  await fs.writeFile(path.join(repo, '.env.local'), 'TOKEN=local');
  await fs.mkdir(path.join(repo, 'config', 'nested'), { recursive: true });
  await fs.writeFile(path.join(repo, 'config', 'dev.local.json'), '{"mode":"dev"}');
  await fs.writeFile(path.join(repo, 'config', 'nested', 'skip.local.json'), '{"skip":true}');
  await fs.mkdir(path.join(repo, 'private'));
  await fs.writeFile(path.join(repo, 'private', 'prod.key'), 'must stay out');
  await fs.writeFile(path.join(repo, '.worktreeinclude'), '.env*\nconfig/*.local.json\n!config/prod.local.json\n');

  const checkout = await new GitWorktrees(storage).open(repo, { runId: 'run-include', taskId: 'task-include' });
  assert.equal(await fs.readFile(path.join(checkout.path, '.env.local'), 'utf8'), 'TOKEN=local');
  assert.equal(await fs.readFile(path.join(checkout.path, 'config', 'dev.local.json'), 'utf8'), '{"mode":"dev"}');
  assert.equal(await fs.readFile(path.join(checkout.path, 'config', 'tracked.local.json'), 'utf8'), 'tracked baseline');
  await assert.rejects(fs.stat(path.join(checkout.path, 'config', 'nested', 'skip.local.json')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(checkout.path, 'private', 'prod.key')), { code: 'ENOENT' });
  assert.deepEqual(checkout.includedFiles.sort(), ['.env.local', 'config/dev.local.json']);
});

test('new worktrees can start from a verified local base branch', async t => {
  const { repo, storage } = await repoFixture(t);
  execFileSync('git', ['switch', '-c', 'feature/base'], { cwd: repo, stdio: 'ignore' });
  await fs.writeFile(path.join(repo, 'base-only.txt'), 'from feature base');
  execFileSync('git', ['add', 'base-only.txt'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', 'feature base content'], { cwd: repo, stdio: 'ignore' });
  const worktrees = new GitWorktrees(storage);
  assert.ok((await worktrees.listBranches(repo)).includes('feature/base'));
  const checkout = await worktrees.open(repo, { runId: 'run-base', taskId: 'task-base', baseBranch: 'feature/base' });
  assert.equal(await fs.readFile(path.join(checkout.path, 'base-only.txt'), 'utf8'), 'from feature base');
  assert.equal(checkout.baseBranch, 'feature/base');
  await assert.rejects(
    worktrees.open(repo, { runId: 'run-missing-base', taskId: 'task-missing-base', baseBranch: 'does/not/exist' }),
    /branch base local does\/not\/exist/
  );
});

test('a retry seeds missing included files into its preserved worktree without overwriting existing values', async t => {
  const { repo, storage } = await repoFixture(t);
  await fs.writeFile(path.join(repo, '.gitignore'), '.env*\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', 'ignore local environment files'], { cwd: repo, stdio: 'ignore' });
  await fs.writeFile(path.join(repo, '.env.local'), 'source-v1');
  await fs.writeFile(path.join(repo, '.worktreeinclude'), '.env*\n');
  const worktrees = new GitWorktrees(storage);
  const checkout = await worktrees.open(repo, { runId: 'run-seed-retry', taskId: 'task-seed-retry' });
  await fs.writeFile(path.join(checkout.path, '.env.local'), 'worker-owned-value');
  await fs.writeFile(path.join(repo, '.env.local'), 'source-v2');
  await fs.writeFile(path.join(repo, '.env.extra'), 'new-local-value');

  const resumed = await worktrees.open(repo, {
    existingPath: checkout.path, seedIncludedFiles: true
  });
  assert.equal(resumed.reused, true);
  assert.equal(await fs.readFile(path.join(checkout.path, '.env.local'), 'utf8'), 'worker-owned-value');
  assert.equal(await fs.readFile(path.join(checkout.path, '.env.extra'), 'utf8'), 'new-local-value');
  assert.deepEqual(resumed.includedFiles, ['.env.extra']);
});

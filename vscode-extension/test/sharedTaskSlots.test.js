const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { SharedTaskSlots, normalizedPath } = require('../src/sharedTaskSlots');

test('project path identity follows filesystem case sensitivity', () => {
  assert.equal(normalizedPath('C:\\Projects\\Orchestrator', 'win32'), 'c:/projects/orchestrator');
  assert.equal(normalizedPath('/home/user/Projects/Orchestrator', 'linux'), '/home/user/Projects/Orchestrator');
  assert.equal(normalizedPath('/home/user/Projects/Orchestrator', 'darwin'), '/home/user/Projects/Orchestrator');
});

test('task reservations enforce configured concurrency per authorized profile', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-profile-slots-'));
  try {
    const slots = new SharedTaskSlots(path.join(directory, 'shared'), 'test-owner');
    const readSessions = async () => [{ id: 'session-1', state: 'busy', projectPath: directory }];
    const first = await slots.reserve(directory, 'run-1', 'task-1', 3, readSessions, {
      provider: 'codex', profileId: 'codex-work', profileLimit: 1, title: 'First task'
    });
    assert.equal(first.reserved, true);
    await slots.update(directory, 'run-1', 'task-1', { status: 'running', sessionId: 'session-1' });

    const sameProfile = await slots.reserve(directory, 'run-1', 'task-2', 3, readSessions, {
      provider: 'codex', profileId: 'codex-work', profileLimit: 1, title: 'Second task'
    });
    assert.deepEqual(sameProfile, {
      reserved: false, reason: 'profile-limit', profileId: 'codex-work', profileLimit: 1, activeForProfile: 1
    });

    const otherProfile = await slots.reserve(directory, 'run-1', 'task-3', 3, readSessions, {
      provider: 'codex', profileId: 'codex-personal', profileLimit: 1, title: 'Third task'
    });
    assert.equal(otherProfile.reserved, true);

    await slots.release(directory, 'run-1', 'task-1');
    const afterRelease = await slots.reserve(directory, 'run-1', 'task-2', 3, readSessions, {
      provider: 'codex', profileId: 'codex-work', profileLimit: 1, title: 'Second task'
    });
    assert.equal(afterRelease.reserved, true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test('profile concurrency reservations coordinate atomically across projects and VS Code windows', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-global-profile-slots-'));
  try {
    const sharedStorage = path.join(directory, 'shared');
    const firstProject = path.join(directory, 'project-one');
    const secondProject = path.join(directory, 'project-two');
    const firstWindow = new SharedTaskSlots(sharedStorage, 'window-one');
    const secondWindow = new SharedTaskSlots(sharedStorage, 'window-two');
    const sessions = async () => [];
    const execFile = promisify(cp.execFile);
    const modulePath = path.join(__dirname, '..', 'src', 'sharedTaskSlots.js');
    const reserveInHost = (ownerId, projectRoot, runId, taskId) => {
      const script = `const {SharedTaskSlots}=require(${JSON.stringify(modulePath)});new SharedTaskSlots(${JSON.stringify(sharedStorage)},${JSON.stringify(ownerId)}).reserve(${JSON.stringify(projectRoot)},${JSON.stringify(runId)},${JSON.stringify(taskId)},4,async()=>[],{profileId:'codex-work',profileLimit:1}).then(v=>process.stdout.write(JSON.stringify(v))).catch(e=>{console.error(e);process.exitCode=1})`;
      return execFile(process.execPath, ['-e', script], { windowsHide: true, maxBuffer: 1024 * 1024 })
        .then(result => JSON.parse(result.stdout));
    };
    const [first, second] = await Promise.all([
      reserveInHost('window-one', firstProject, 'run-a', 'task-a'),
      reserveInHost('window-two', secondProject, 'run-b', 'task-b')
    ]);
    assert.equal([first, second].filter(item => item.reserved).length, 1);
    assert.equal([first, second].find(item => !item.reserved)?.reason, 'profile-limit');

    if (first.reserved) {
      await firstWindow.release(firstProject, 'run-a', 'task-a');
      const next = await secondWindow.reserve(secondProject, 'run-b', 'task-b', 4, sessions, { profileId: 'codex-work', profileLimit: 1 });
      assert.equal(next.reserved, true);
    } else {
      await secondWindow.release(secondProject, 'run-b', 'task-b');
      const next = await firstWindow.reserve(firstProject, 'run-a', 'task-a', 4, sessions, { profileId: 'codex-work', profileLimit: 1 });
      assert.equal(next.reserved, true);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test('profile reservation is released across projects when the recorded worker process exits', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-profile-process-slots-'));
  let worker;
  try {
    const sharedStorage = path.join(directory, 'shared');
    const firstProject = path.join(directory, 'project-one');
    const secondProject = path.join(directory, 'project-two');
    const slots = new SharedTaskSlots(sharedStorage, 'test-owner');
    worker = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { windowsHide: true });
    await new Promise((resolve, reject) => {
      worker.once('spawn', resolve);
      worker.once('error', reject);
    });
    const first = await slots.reserve(firstProject, 'run-a', 'task-a', 4, async () => [], {
      profileId: 'codex-work', profileLimit: 1, workerPid: worker.pid
    });
    assert.equal(first.reserved, true);
    const exited = new Promise(resolve => worker.once('exit', resolve));
    worker.kill();
    await exited;
    worker = undefined;

    const next = await slots.reserve(secondProject, 'run-b', 'task-b', 4, async () => [], {
      profileId: 'codex-work', profileLimit: 1
    });
    assert.equal(next.reserved, true);
  } finally {
    if (worker && worker.exitCode === null) worker.kill();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

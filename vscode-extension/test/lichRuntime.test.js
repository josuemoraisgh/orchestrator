'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { startLichRuntime } = require('../src/lichRuntime');

function fakeRuntime() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.unreferenced = false;
  child.killed = false;
  child.unref = () => { child.unreferenced = true; };
  child.kill = () => { child.killed = true; child.exitCode = 1; };
  return child;
}

test('Lich startup waits for the documented version command to report a live backend', async () => {
  const child = fakeRuntime();
  let checks = 0;
  const result = await startLichRuntime('lich.exe', 'C:/project', {
    expectedVersion: 'v0.85.0',
    spawn: () => { process.nextTick(() => child.emit('spawn')); return child; },
    queryVersion: async () => ({ code: 0, stdout: JSON.stringify({ cli: '0.85.0', server: ++checks === 1 ? '' : '0.85.0' }) }),
    intervalMs: 1
  });

  assert.equal(checks, 2);
  assert.deepEqual(result, { version: '0.85.0', reused: false, restarted: false });
  assert.equal(child.unreferenced, true);
  assert.equal(child.killed, false);
});

test('Lich startup preserves an older backend when sessions are present', async () => {
  let started = false;
  let quit = false;
  await assert.rejects(startLichRuntime('lich.exe', 'C:/project', {
    expectedVersion: '0.86.0',
    spawn: () => { started = true; return fakeRuntime(); },
    queryVersion: async () => ({ code: 0, stdout: JSON.stringify({ cli: '0.86.0', server: '0.85.0' }) }),
    runCommand: async (_exe, args) => {
      if (args[0] === 'sessions') return { code: 0, stdout: JSON.stringify([{ id: 'active-session', state: 'busy' }]) };
      if (args[0] === 'quit') quit = true;
      return { code: 0, stdout: '' };
    }
  }), /0\.85\.0 is already running with 1 session/);
  assert.equal(started, false);
  assert.equal(quit, false);
});

test('Lich startup replaces an older backend only after an empty session list and verified shutdown', async () => {
  const child = fakeRuntime();
  let backendVersion = '0.85.0';
  let quit = false;
  const result = await startLichRuntime('lich.exe', 'C:/project', {
    expectedVersion: 'v0.86.0',
    spawn: () => { process.nextTick(() => { backendVersion = '0.86.0'; child.emit('spawn'); }); return child; },
    queryVersion: async () => ({ code: 0, stdout: JSON.stringify({ cli: '0.86.0', server: backendVersion }) }),
    runCommand: async (_exe, args) => {
      if (args[0] === 'sessions') return { code: 0, stdout: '[]' };
      if (args[0] === 'quit') { quit = true; backendVersion = ''; return { code: 0, stdout: 'Lich stopped.' }; }
      return { code: 1, stderr: 'unexpected command' };
    },
    intervalMs: 1
  });

  assert.equal(quit, true);
  assert.deepEqual(result, { version: '0.86.0', reused: false, restarted: true });
});

test('Lich startup reuses a server that already matches the pinned version', async () => {
  let started = false;
  const result = await startLichRuntime('lich.exe', 'C:/project', {
    expectedVersion: 'v0.86.0',
    spawn: () => { started = true; return fakeRuntime(); },
    queryVersion: async () => ({ code: 0, stdout: JSON.stringify({ cli: '0.86.0', server: '0.86.0' }) })
  });
  assert.deepEqual(result, { version: '0.86.0', reused: true, restarted: false });
  assert.equal(started, false);
});

test('concurrent Lich startup calls share a machine-wide lock', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-lich-lock-'));
  const lockPath = path.join(directory, 'runtime.lock');
  let backendVersion = '';
  let starts = 0;
  try {
    const options = {
      expectedVersion: '0.86.0',
      lockPath,
      spawn: () => {
        starts++;
        const child = fakeRuntime();
        process.nextTick(() => { backendVersion = '0.86.0'; child.emit('spawn'); });
        return child;
      },
      queryVersion: async () => ({ code: 0, stdout: JSON.stringify({ cli: '0.86.0', server: backendVersion }) }),
      intervalMs: 1
    };
    const results = await Promise.all([
      startLichRuntime('lich.exe', 'C:/project', options),
      startLichRuntime('lich.exe', 'C:/project', options)
    ]);
    assert.equal(starts, 1);
    assert.deepEqual(results.map(item => item.version), ['0.86.0', '0.86.0']);
    assert.deepEqual(results.map(item => item.reused).sort(), [false, true]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Lich startup stops its launched backend when readiness never arrives', async () => {
  const child = fakeRuntime();
  await assert.rejects(startLichRuntime('lich.exe', 'C:/project', {
    expectedVersion: '0.85.0',
    timeoutMs: 1000,
    spawn: () => { process.nextTick(() => child.emit('spawn')); return child; },
    queryVersion: async () => ({ code: 0, stdout: JSON.stringify({ cli: '0.85.0' }) }),
    intervalMs: 1
  }), /did not become ready/);
  assert.equal(child.killed, true);
});

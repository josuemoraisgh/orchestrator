'use strict';

const cp = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const lockfile = require('proper-lockfile');
const { setTimeout: delay } = require('node:timers/promises');

function runOutcome(executable, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(executable, args, { cwd, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function parseJsonOutput(result, label) {
  if (!result || result.code !== 0) {
    throw new Error(result?.stderr || result?.stdout || `${label} exited ${result?.code ?? 'without a status'}.`);
  }
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`${label} returned invalid JSON; the existing Lich server was left running.`); }
}

function serverVersionFrom(result) {
  if (!result || result.code !== 0) return '';
  const value = parseJsonOutput(result, 'lich version --json');
  return normalizeVersion(value?.server);
}

function sessionsFrom(result) {
  const value = parseJsonOutput(result, 'lich sessions --json');
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.sessions)) return value.sessions;
  throw new Error('lich sessions --json returned an unknown format; the existing server was left running.');
}

async function withRuntimeLock(lockPath, operation) {
  if (!lockPath) return operation();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try { await fs.writeFile(lockPath, '', { flag: 'a' }); }
  catch (error) { throw new Error(`Could not prepare the shared Lich runtime lock: ${error.message || error}`); }
  const release = await lockfile.lock(lockPath, {
    realpath: false,
    stale: 120000,
    update: 20000,
    retries: { retries: 80, minTimeout: 25, maxTimeout: 250 }
  });
  try { return await operation(); }
  finally { await release(); }
}

async function startLichRuntime(executable, cwd, options = {}) {
  const spawn = options.spawn || cp.spawn;
  const queryVersion = options.queryVersion || runOutcome;
  const runCommand = options.runCommand || runOutcome;
  const expectedVersion = normalizeVersion(options.expectedVersion);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 10000);
  const intervalMs = Math.max(0, Number(options.intervalMs) || 250);
  const lockPath = options.lockPath || '';

  return withRuntimeLock(lockPath, async () => {
    const initial = await queryVersion(executable, ['version', '--json'], cwd, Math.min(3000, timeoutMs));
    let existingVersion = serverVersionFrom(initial);
    let restarted = false;

    if (existingVersion && expectedVersion && existingVersion !== expectedVersion) {
      let sessions;
      try {
        sessions = sessionsFrom(await runCommand(executable, ['sessions', '--json'], cwd, Math.min(5000, timeoutMs)));
      } catch (error) {
        throw new Error(`Lich backend ${existingVersion} is already running, but its sessions could not be verified. It was left untouched; close or inspect that backend before retrying. (${error.message || error})`);
      }
      if (sessions.length) {
        throw new Error(`Lich backend ${existingVersion} is already running with ${sessions.length} session(s). They were preserved; finish or close them in Lich, then retry to switch to ${expectedVersion}.`);
      }

      const stopped = await runCommand(executable, ['quit'], cwd, Math.min(10000, timeoutMs));
      if (stopped?.code !== 0) {
        throw new Error(`Lich backend ${existingVersion} has no live sessions, but its supported quit command failed. It was left untouched; expected ${expectedVersion}.`);
      }

      const stopDeadline = Date.now() + timeoutMs;
      while (Date.now() < stopDeadline) {
        const check = await queryVersion(executable, ['version', '--json'], cwd, Math.max(1, Math.min(3000, stopDeadline - Date.now())));
        try { existingVersion = serverVersionFrom(check); }
        catch { existingVersion = ''; }
        if (!existingVersion) break;
        await delay(Math.min(intervalMs || 50, Math.max(0, stopDeadline - Date.now())));
      }
      if (existingVersion) {
        throw new Error(`Lich backend ${existingVersion} did not stop after the supported quit command; ${expectedVersion} was not started.`);
      }
      restarted = true;
    } else if (existingVersion && (!expectedVersion || existingVersion === expectedVersion)) {
      return { version: existingVersion, reused: true, restarted: false };
    }

    const runtime = spawn(executable, ['--no-window'], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false
    });
    await new Promise((resolve, reject) => {
      runtime.once('spawn', resolve);
      runtime.once('error', reject);
    });
    runtime.unref();

    const deadline = Date.now() + timeoutMs;
    let lastResult = 'the Lich CLI did not report a running backend';
    while (Date.now() < deadline) {
      let result;
      try {
        result = await queryVersion(executable, ['version', '--json'], cwd, Math.max(1, Math.min(3000, deadline - Date.now())));
      } catch (error) {
        lastResult = error.message || String(error);
        await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
        continue;
      }
      if (result.code === 0) {
        try {
          const info = JSON.parse(result.stdout);
          const serverVersion = normalizeVersion(info.server);
          if (serverVersion) {
            if (expectedVersion && serverVersion !== expectedVersion) {
              try { if (runtime.exitCode === null) runtime.kill(); } catch { /* Preserve the useful version mismatch. */ }
              throw new Error(`Lich backend version ${serverVersion} is responding; expected ${expectedVersion}.`);
            }
            return { version: serverVersion, reused: false, restarted };
          }
        } catch (error) {
          if (error.message.startsWith('Lich backend version ')) throw error;
          lastResult = 'the Lich version command returned invalid JSON';
        }
      } else {
        lastResult = result.stderr || result.stdout || `lich version exited ${result.code}`;
      }
      await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }

    try { if (runtime.exitCode === null) runtime.kill(); } catch { /* The runtime may have exited during the readiness check. */ }
    throw new Error(`Lich backend did not become ready within ${timeoutMs} ms: ${lastResult}`);
  });
}

module.exports = { startLichRuntime, withRuntimeLock };

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v(?=\d)/i, '');
}

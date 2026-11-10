'use strict';

const cp = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const lockfile = require('proper-lockfile');
const { pathIdentity } = require('./pathIdentity');

const LOCK_OPTIONS = { realpath: false, stale: 15000, update: 3000, retries: { retries: 80, minTimeout: 25, maxTimeout: 125 } };

function run(executable, args, cwd, timeout = 30000) {
  return new Promise((resolve, reject) => cp.execFile(executable, args, { cwd, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      error.message = (stderr || stdout || error.message || 'AI Memory command failed').trim();
      reject(error);
    } else resolve({ stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
  }));
}

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function processAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return false;
  try { process.kill(Number(pid), 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

class AiMemoryRuntime {
  constructor(storageRoot, getExecutable) {
    this.storageRoot = path.resolve(storageRoot);
    this.getExecutable = getExecutable;
    this.processes = new Map();
    this.directory = path.join(this.storageRoot, 'ai-memory-runtime');
    this.dataDirectory = path.join(this.directory, 'data');
    this.configPath = path.join(this.dataDirectory, 'config.toml');
    this.endpointPath = path.join(this.directory, 'endpoint.json');
  }

  async initialize(executable) {
    await fs.mkdir(this.dataDirectory, { recursive: true });
    try { await fs.access(this.configPath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await run(executable, ['--data-dir', this.dataDirectory, '--config', this.configPath, 'init'], this.directory, 60000);
    }
  }

  async healthy(port) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 700);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: controller.signal });
      if (!response.ok) return false;
      const body = await response.json();
      return body?.status === 'ok';
    } catch { return false; }
    finally { clearTimeout(timer); }
  }

  async waitForHealth(child, port) {
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      if (child.spawnError) throw new Error(`AI Memory server could not start: ${child.spawnError.message || child.spawnError}`);
      if (child.exitCode !== null) throw new Error(`AI Memory server exited with code ${child.exitCode} before it became ready.`);
      if (await this.healthy(port)) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    child.kill();
    throw new Error('AI Memory server did not become healthy on its private loopback endpoint.');
  }

  async ensure() {
    const executable = await this.getExecutable();
    await fs.mkdir(this.directory, { recursive: true });
    try { await fs.writeFile(this.endpointPath, '{}\n', { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const release = await lockfile.lock(this.endpointPath, LOCK_OPTIONS);
    try {
      await this.initialize(executable);
      let current;
      try { current = JSON.parse(await fs.readFile(this.endpointPath, 'utf8')); }
      catch { current = undefined; }
      if (current?.port && current?.dataDirectory && pathIdentity(current.dataDirectory) === pathIdentity(this.dataDirectory)
        && processAlive(current.pid) && await this.healthy(current.port)) {
        return { executable, dataDirectory: this.dataDirectory, configPath: this.configPath, url: `http://127.0.0.1:${current.port}`, version: current.version || 'unknown', ownerPid: current.pid };
      }

      const port = await freeLoopbackPort();
      const child = cp.spawn(executable, [
        '--data-dir', this.dataDirectory, '--config', this.configPath,
        'serve', '--transport', 'http', '--bind', `127.0.0.1:${port}`, '--no-watcher'
      ], { cwd: this.directory, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      const log = { stderr: '' };
      child.stderr.setEncoding('utf8').on('data', chunk => { log.stderr = (log.stderr + chunk).slice(-6000); });
      child.once('error', error => { log.error = error; child.spawnError = error; });
      child.once('exit', (code, signal) => {
        this.processes.delete(child.pid);
        log.exitCode = code;
        log.signal = signal;
      });
      this.processes.set(child.pid, child);
      await this.waitForHealth(child, port).catch(error => {
        child.kill();
        const detail = log.stderr.trim();
        throw new Error(`${error.message}${detail ? ` ${detail}` : ''}`);
      });
      const record = { pid: child.pid, port, version: path.basename(path.dirname(executable)), dataDirectory: this.dataDirectory, startedAt: Date.now() };
      const temporary = `${this.endpointPath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
      await fs.rename(temporary, this.endpointPath);
      return { executable, dataDirectory: this.dataDirectory, configPath: this.configPath, url: `http://127.0.0.1:${port}`, version: record.version, ownerPid: child.pid };
    } finally { await release(); }
  }

  async status() {
    let endpoint;
    try { endpoint = JSON.parse(await fs.readFile(this.endpointPath, 'utf8')); }
    catch { endpoint = undefined; }
    if (!endpoint?.port || !processAlive(endpoint.pid) || !(await this.healthy(endpoint.port))) return { status: 'stopped', version: endpoint?.version || '' };
    return { status: 'available', version: endpoint.version || 'unknown', pid: endpoint.pid, url: `http://127.0.0.1:${endpoint.port}` };
  }

  dispose() {
    for (const child of this.processes.values()) {
      try { child.kill(); } catch { /* Extension shutdown may race an already exited process. */ }
    }
    this.processes.clear();
  }
}

module.exports = { AiMemoryRuntime, freeLoopbackPort, processAlive };

'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

async function startServer(server) {
  const child = spawn(process.execPath, server.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(server.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  const pending = new Map();
  let nextId = 1;
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message); }
  });
  child.stderr.resume();
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${server.name} timed out on ${method}.`)); }, 15000);
    pending.set(id, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Orchestrator integration', version: '1' } });
  return {
    request,
    close: async () => {
      lines.close();
      child.stdin.end();
      if (child.exitCode === null) await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(() => { child.kill(); resolve(); }, 5000))
      ]);
    }
  };
}

async function main() {
  const projectGuidance = await fs.readFile(path.join(process.cwd(), 'AGENTS.md'), 'utf8');
  assert.match(projectGuidance, /WORKTREE_CHECKOUT_GUIDANCE/, 'worker starts with guidance from its actual checkout');
  assert.doesNotMatch(projectGuidance, /ROOT_CHECKOUT_GUIDANCE/, 'the original project-root version is not used for the isolated checkout');
  const promptLine = await new Promise((resolve, reject) => {
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    input.once('line', line => { input.close(); resolve(line); });
    input.once('error', reject);
  });
  const prompt = JSON.parse(promptLine);
  const promptText = prompt.message.content.map(part => part.text || '').join('\n');
  assert.match(promptText, /WORKTREE_CHECKOUT_GUIDANCE/, 'the task prompt includes guidance from its actual checkout');
  assert.doesNotMatch(promptText, /ROOT_CHECKOUT_GUIDANCE/, 'the task prompt excludes a stale project-root instruction');
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--mcp-config');
  assert.ok(configIndex >= 0, 'Claude session supplied the production MCP config');
  const config = JSON.parse(await fs.readFile(args[configIndex + 1], 'utf8'));
  const memoryServer = await startServer(config.mcpServers.orchestrator_memory);
  const permissionServer = await startServer(config.mcpServers.orchestrator_permissions);
  try {
    const available = await memoryServer.request('tools/list');
    const names = available.result.tools.map(tool => tool.name);
    assert.ok(names.includes('read_task_context'));
    assert.ok(names.includes('write_task_context'));
    const taskRead = await memoryServer.request('tools/call', { name: 'read_task_context', arguments: { target: 'task' } });
    assert.equal(taskRead.result.isError, undefined);
    const taskText = taskRead.result.content[0].text;
    assert.match(taskText, /Task-ID: run-/);
    const task = JSON.parse(taskText);
    assert.match(task.body, /approved sample change/);

    const outputPath = path.join(process.cwd(), 'src', 'worker-result.txt');
    const marker = process.env.ORCHESTRATOR_TEST_SUFFIX;
    assert.ok(marker, 'test worker suffix is set');
    const agentMarker = config.mcpServers.orchestrator_memory.env.ORCHESTRATOR_MEMORY_AGENT_MARKER;
    const body = `# Claude worker report\n\n${agentMarker}\n\nObjective: implement the approved sample change.\n\nCompleted work: wrote src/worker-result.txt.\n\nDecisions: used the isolated task worktree.\n\nFiles changed: src/worker-result.txt\n\nFailed attempts: none.\n\nOpen issues: none.\n\nNext steps: review the task diff.\n`;
    const memoryWrite = await memoryServer.request('tools/call', {
      name: 'write_task_context', arguments: { target: 'agent', body }
    });
    assert.equal(memoryWrite.result.isError, undefined, memoryWrite.result.content?.[0]?.text);
    assert.match(memoryWrite.result.content[0].text, /"verified":true/);

    const approval = await permissionServer.request('tools/call', {
      name: 'prompt', arguments: { tool_name: 'Write', input: { file_path: outputPath, content: `approved-${marker}\n` } }
    });
    const decision = JSON.parse(approval.result.content[0].text);
    assert.equal(decision.behavior, 'allow', decision.message);
    await fs.writeFile(outputPath, `approved-${marker}\n`, { flag: 'wx' });

    process.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'production-fixture-session' })}\n`);
    process.stdout.write(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Production dispatcher integration passed.' }] } })}\n`);
    process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Production dispatcher integration passed.', session_id: 'production-fixture-session' })}\n`);
  } finally {
    await Promise.all([memoryServer.close(), permissionServer.close()]);
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

'use strict';

// Exercises the production extension task dispatcher, real Git worktree,
// managed AI Memory runtime, Claude session runner, and scoped MCP bridges.
// The provider fixture is deterministic and makes exactly one approved write.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const Module = require('node:module');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { AiMemoryRuntime } = require('../src/aiMemoryRuntime');
const { callAiMemoryTool, listAiMemoryTools, readAiMemoryPage, toolResultText } = require('../src/aiMemoryMcp');
const { ClaudeCodeSessions } = require('../src/claudeCodeSessions');
const { GitWorktrees } = require('../src/gitWorktrees');
const { TaskJournal } = require('../src/taskJournal');

const memoryExecutable = process.env.ORCHESTRATOR_AI_MEMORY_BIN;
const vscodeState = { projectRoot: '', suffix: '', approved: [] };
const vscodeMock = {
  workspace: {
    isTrusted: true,
    get workspaceFolders() { return [{ uri: { fsPath: vscodeState.projectRoot } }]; }
  },
  extensions: { all: [] },
  lm: { tools: [], selectChatModels: async () => [] },
  window: {
    showWarningMessage: async message => {
      const detail = String(message);
      if (detail.includes('Write') && detail.includes('worker-result.txt')
          && detail.includes(`approved-${vscodeState.suffix}`)) {
        vscodeState.approved.push(detail);
        return 'Permitir uma vez';
      }
      return undefined;
    }
  }
};

const extensionPath = require.resolve('../src/extension');
const fixturePath = path.join(__dirname, '..', 'test-fixtures', 'productionClaudeWorker.js');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return vscodeMock;
  if (parent?.filename === extensionPath && request === './languageModels') {
    return { selectChatModels: async () => ({ models: [], timedOut: false }) };
  }
  if (parent?.filename === extensionPath && request === './coordinatorCli') {
    const actual = originalLoad.call(this, request, parent, isMain);
    return {
      ...actual,
      checkProfileAuthentication: async () => ({ status: 'verified', text: 'test provider profile' }),
      coordinatorInvocation: async () => ({ executable: process.execPath, prefixArgs: [fixturePath] }),
      profileEnvironment: () => ({ ...process.env })
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { startClaudeCodeTask } = require('../src/extension');
Module._load = originalLoad;

test('production Claude dispatcher composes an isolated Git checkout with verified shared memory', {
  skip: !memoryExecutable,
  timeout: 120000
}, async t => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-production-dispatch-'));
  const projectRoot = path.join(scratch, 'project');
  const storageRoot = path.join(scratch, 'extension-storage');
  const runtime = new AiMemoryRuntime(path.join(scratch, 'memory-runtime'), async () => memoryExecutable);
  const taskJournal = new TaskJournal(storageRoot);
  const worktrees = new GitWorktrees(storageRoot);
  const openWorktree = worktrees.open.bind(worktrees);
  const sessions = new ClaudeCodeSessions();
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;
  const originalTestSuffix = process.env.ORCHESTRATOR_TEST_SUFFIX;
  let worktreePath = '';
  let completedSession;

  t.after(async () => {
    if (completedSession) {
      const session = sessions.sessions.get(completedSession);
      if (session?.state === 'running') await sessions.stop(completedSession).catch(() => {});
      if (session?.state === 'running') await Promise.race([session.completion.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    const children = [...runtime.processes.values()];
    runtime.dispose();
    await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))));
    if (worktreePath) {
      const entries = cp.execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' });
      const canonicalTarget = path.resolve(worktreePath).replace(/\\/g, '/').toLowerCase();
      const registered = entries.split(/\r?\n/).some(line => line.startsWith('worktree ') && path.resolve(line.slice('worktree '.length)).replace(/\\/g, '/').toLowerCase() === canonicalTarget);
      if (registered) cp.execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: projectRoot, stdio: 'ignore' });
    }
    process.env.PATH = originalPath;
    if (originalPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = originalPathExt;
    if (originalTestSuffix === undefined) delete process.env.ORCHESTRATOR_TEST_SUFFIX;
    else process.env.ORCHESTRATOR_TEST_SUFFIX = originalTestSuffix;
    vscodeState.projectRoot = '';
    vscodeState.suffix = '';
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  await fs.mkdir(path.join(projectRoot, '.ai'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'AGENTS.md'), '# Root guidance\nROOT_CHECKOUT_GUIDANCE\n');
  await fs.writeFile(path.join(projectRoot, 'src', 'baseline.txt'), 'baseline\n');
  cp.execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  cp.execFileSync('git', ['config', 'user.email', 'orchestrator-test@example.invalid'], { cwd: projectRoot });
  cp.execFileSync('git', ['config', 'user.name', 'Orchestrator Integration Test'], { cwd: projectRoot });
  cp.execFileSync('git', ['add', '.'], { cwd: projectRoot });
  cp.execFileSync('git', ['commit', '-m', 'baseline'], { cwd: projectRoot, stdio: 'ignore' });

  const suffix = randomUUID().replaceAll('-', '').slice(0, 14);
  vscodeState.suffix = suffix;
  process.env.ORCHESTRATOR_TEST_SUFFIX = suffix;
  const scope = { workspace: 'default', project: `dispatch-${suffix}` };
  const taskPath = `orchestrator/tasks/run-${suffix}/task-1.md`;
  const taskMarker = `Task-ID: run-${suffix}/task-1`;
  const taskBody = `# Task continuity\n\n${taskMarker}\n\nObjective: implement the approved sample change.\n`;
  await fs.writeFile(path.join(projectRoot, '.ai', 'orchestrator.json'), JSON.stringify({
    build: null, upstreams: [], tools: { aiMemoryCommand: memoryExecutable },
    orchestration: { allowedProviders: ['claude'] },
    workerDefaults: { provider: 'claude', model: 'test-model', effort: 'low' },
    aiMemory: scope
  }, null, 2));

  const connection = await runtime.ensure();
  const tools = await listAiMemoryTools(connection.executable, projectRoot, connection);
  const writer = tools.find(tool => tool.name.endsWith('memory_write_page'));
  assert.ok(writer, 'pinned runtime exposes its supported page writer');
  const created = await callAiMemoryTool(connection.executable, projectRoot, writer.name, {
    ...scope, path: taskPath, title: 'Production dispatch integration', body: taskBody,
    tags: ['orchestrator', 'integration', 'task'], create_only: true
  }, connection);
  assert.equal(created.isError, false, toolResultText(created));
  const taskPageId = /"page_id"\s*:\s*"([^"]+)"/.exec(toolResultText(created))?.[1];
  assert.ok(taskPageId, toolResultText(created));

  const run = { id: `run-${suffix}`, title: 'Production dispatch', prompt: 'Create one isolated change.' };
  const task = {
    id: 'task-1', title: 'Write a result file', description: 'Write the exact approved result in the task checkout.',
    acceptanceCriteria: ['The result file exists only in the task worktree.'], dependsOn: [],
    status: 'running', attempts: 1, provider: 'claude', executor: 'claude-code-cli',
    profileId: 'default-claude-cli-profile', model: 'test-model', effort: 'low',
    projectPath: projectRoot, worktree: `orchestrator/run-${suffix}-task-1`,
    memory: { ...scope, status: 'coordinator-write-read-verified', projectId: '', taskPagePath: taskPath, taskMarker, pageId: taskPageId }
  };
  await taskJournal.record(projectRoot, { ...run, projectPath: projectRoot }, task, 'dispatch-start');

  const binDirectory = path.join(scratch, 'bin');
  await fs.mkdir(binDirectory);
  const fakeCliName = process.platform === 'win32' ? 'claude.cmd' : 'claude';
  await fs.writeFile(path.join(binDirectory, fakeCliName), '');
  process.env.PATH = `${binDirectory}${path.delimiter}${originalPath || ''}`;
  if (process.platform === 'win32' && !process.env.PATHEXT?.toLowerCase().includes('.cmd')) {
    process.env.PATHEXT = `${process.env.PATHEXT || '.EXE;.CMD;.BAT'};.CMD`;
  }
  vscodeState.projectRoot = projectRoot;
  worktrees.open = async (...args) => {
    const checkout = await openWorktree(...args);
    worktreePath = checkout.path;
    await fs.writeFile(path.join(checkout.path, 'AGENTS.md'), '# Worktree guidance\nWORKTREE_CHECKOUT_GUIDANCE\n');
    return checkout;
  };

  const opened = await startClaudeCodeTask({
    globalStorageUri: { fsPath: storageRoot },
    globalState: { get: (_key, fallback) => fallback }
  }, sessions, { root: projectRoot, runId: run.id, task }, taskJournal, worktrees, runtime);
  completedSession = opened.sessionId;
  worktreePath = opened.worktreePath;
  const session = sessions.sessions.get(opened.sessionId);
  assert.ok(session, 'production dispatch opened a Claude session');
  let timeout;
  try {
    await Promise.race([
      session.completion.promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Deterministic worker did not finish: ${session.state}; ${session.error || session.stderr}`)), 30000);
        timeout.unref?.();
      })
    ]);
  } finally { clearTimeout(timeout); }
  const final = session;
  assert.equal(final.state, 'answered', final.error);
  assert.match(final.result, /production dispatcher integration passed/i);

  assert.notEqual(path.resolve(worktreePath), path.resolve(projectRoot));
  assert.match(opened.worktree, new RegExp(`run-${suffix}`));
  assert.equal(await fs.readFile(path.join(projectRoot, 'src', 'baseline.txt'), 'utf8'), 'baseline\n');
  const expectedResult = path.join(worktreePath, 'src', 'worker-result.txt');
  assert.equal(await fs.readFile(expectedResult, 'utf8'), `approved-${suffix}\n`);
  assert.equal(vscodeState.approved.length, 1, 'the actual Claude permission bridge approved exactly one in-checkout write');
  assert.equal(opened.memory.contextReadVerified, true);
  assert.equal(opened.memory.status, 'coordinator-write-read-verified');
  assert.ok(opened.memory.contextPagesRead.some(page => page.path === taskPath));

  const attemptPath = opened.memory.agentPagePath;
  const attemptPage = await readAiMemoryPage(connection.executable, projectRoot, scope, attemptPath, 10000, connection);
  assert.ok(attemptPage.body.includes(opened.memory.agentMarker));
  assert.match(attemptPage.body, /files changed: src\/worker-result\.txt/i);
  const taskPage = await readAiMemoryPage(connection.executable, projectRoot, scope, taskPath, 10000, connection);
  assert.equal(taskPage.pageId, taskPageId, 'the worker did not overwrite the coordinator-owned task page');
});

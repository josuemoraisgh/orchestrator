'use strict';

// Opt-in provider integration. A real Claude coordinator creates a plan via
// the production chat handler; approval and scheduler dispatch through the
// production Claude task dispatcher into a Git worktree with managed AI
// Memory. Only one exact file write is approved. No VS Code window is launched.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const Module = require('node:module');
const test = require('node:test');
const { checkProfileAuthentication, runCoordinator } = require('../src/coordinatorCli');
const { ClaudeCodeSessions } = require('../src/claudeCodeSessions');
const { AiMemoryRuntime } = require('../src/aiMemoryRuntime');
const { callAiMemoryTool, listAiMemoryTools, readAiMemoryPage, toolResultText } = require('../src/aiMemoryMcp');
const { GitWorktrees } = require('../src/gitWorktrees');
const { TaskJournal } = require('../src/taskJournal');

const vscodeState = { projectRoot: '', approvedWrites: [] };
const vscodeMock = {
  workspace: { isTrusted: true, get workspaceFolders() { return [{ uri: { fsPath: vscodeState.projectRoot } }]; } },
  extensions: { all: [] },
  window: {
    showWarningMessage: async (message, _options, ...choices) => {
      const detail = String(message);
      if (detail.startsWith('Confirmar que os critérios')) return choices.includes('Concluir tarefa') ? 'Concluir tarefa' : undefined;
      const separator = detail.indexOf('\n\n');
      if (!detail.includes('usar Write') || separator < 0) return undefined;
      let args;
      try { args = JSON.parse(detail.slice(separator + 2)); } catch { return undefined; }
      const allowed = path.basename(String(args.file_path || '')) === 'workflow-result.txt'
        && String(args.content || '').trim() === 'LIVE_WORKFLOW_ACCEPTED'
        && vscodeState.approvedWrites.length === 0;
      if (allowed) vscodeState.approvedWrites.push({ filePath: String(args.file_path), content: String(args.content).trim() });
      return allowed ? 'Permitir uma vez' : undefined;
    }
  },
  lm: { tools: [], selectChatModels: async () => [] },
  CancellationTokenSource: class { constructor() { this.token = {}; } dispose() {} }
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return vscodeMock;
  return originalLoad.call(this, request, parent, isMain);
};
const { OrchestratorHomeView } = require('../src/orchestratorHomeView');
const { startClaudeCodeTask } = require('../src/extension');
Module._load = originalLoad;

const enabled = process.env.ORCHESTRATOR_LIVE_ORCHESTRATOR_WORKFLOW === '1'
  && Boolean(process.env.ORCHESTRATOR_CLAUDE_BIN)
  && Boolean(process.env.ORCHESTRATOR_AI_MEMORY_BIN);
const taskRunsKey = 'orchestratorAi.taskRuns';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('live coordinator plan stays pending until approval, then reaches the scheduler', {
  skip: !enabled,
  timeout: 300000
}, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-live-workflow-'));
  const project = path.join(temp, 'project');
  const extensionStorage = path.join(temp, 'extension-storage');
  const memoryProject = `live-workflow-${Date.now().toString(36)}`;
  await fs.mkdir(path.join(project, '.ai'), { recursive: true });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'baseline.txt'), 'baseline\n');
  await fs.writeFile(path.join(project, '.ai', 'orchestrator.json'), JSON.stringify({
    build: null, upstreams: [], tools: { aiMemoryCommand: process.env.ORCHESTRATOR_AI_MEMORY_BIN },
    orchestration: { mode: 'cli', providerId: 'claude', profileId: 'live-claude-workflow', allowedProviders: ['claude'], maxParallel: 1, maxAttempts: 2 },
    workerDefaults: { provider: 'claude', model: '', effort: '' },
    aiMemory: { workspace: 'default', project: memoryProject }
  }, null, 2));
  cp.execFileSync('git', ['init', '-b', 'main'], { cwd: project, stdio: 'ignore' });
  cp.execFileSync('git', ['config', 'user.email', 'orchestrator-live@example.invalid'], { cwd: project });
  cp.execFileSync('git', ['config', 'user.name', 'Orchestrator Live Test'], { cwd: project });
  cp.execFileSync('git', ['add', '.'], { cwd: project });
  cp.execFileSync('git', ['commit', '-m', 'baseline'], { cwd: project, stdio: 'ignore' });
  vscodeState.projectRoot = project;
  const profile = { id: 'live-claude-workflow', providerId: 'claude', name: 'Live Claude CLI', authorized: true };
  const provider = { id: 'claude', name: 'Claude', executablePath: process.env.ORCHESTRATOR_CLAUDE_BIN, canCoordinateWithCli: true };
  const auth = await checkProfileAuthentication(profile, provider, path.join(temp, 'profiles'), project);
  assert.equal(auth.status, 'verified', auth.text);

  const state = {
    workspace: project,
    config: {
      orchestration: { mode: 'cli', providerId: 'claude', profileId: profile.id, modelId: '', effort: '', allowedProviders: ['claude'], maxParallel: 1, maxAttempts: 2 },
      workerDefaults: { provider: 'claude', model: '', effort: '' }
    },
    coordinatorProfiles: [profile],
    options: { providers: [{
      id: 'claude', name: 'Claude', executablePath: provider.executablePath,
      canCoordinateWithCli: true, canRunClaudeCode: true,
      canRunCodexAppServer: false, canRunInVscodeModel: false, canRunInLich: false, workerModels: []
    }] }
  };
  const values = new Map([
    ['orchestratorAi.chatThreads', [{ id: 'live-thread', title: 'Nova conversa', updatedAt: Date.now(), messages: [] }]],
    ['orchestratorAi.activeThread', 'live-thread'],
    [taskRunsKey, []]
  ]);
  const workspaceState = {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    update: async (key, value) => { values.set(key, value); }
  };
  const startedTasks = [];
  const journalEvents = [];
  const messages = [];
  const workerSessions = new ClaudeCodeSessions();
  const taskJournal = new TaskJournal(extensionStorage);
  const worktrees = new GitWorktrees(extensionStorage);
  const memoryRuntime = new AiMemoryRuntime(extensionStorage, async () => process.env.ORCHESTRATOR_AI_MEMORY_BIN);
  const memoryConnection = await memoryRuntime.ensure();
  const memoryTools = await listAiMemoryTools(memoryConnection.executable, project, memoryConnection);
  const memoryWriter = memoryTools.find(tool => tool.name.endsWith('memory_write_page'));
  assert.ok(memoryWriter, 'the pinned AI Memory runtime provides the coordinator page writer');
  const memoryBootstrap = await callAiMemoryTool(memoryConnection.executable, project, memoryWriter.name, {
    workspace: 'default', project: memoryProject, path: 'orchestrator/integration-bootstrap.md',
    title: 'Live production workflow integration', body: '# Live integration\n\nPrepare the project memory scope.\n',
    tags: ['orchestrator', 'integration'], create_only: true
  }, memoryConnection);
  assert.equal(memoryBootstrap.isError, false, toolResultText(memoryBootstrap));
  const extensionContext = {
    globalStorageUri: { fsPath: extensionStorage },
    globalState: { get: (key, fallback) => key === 'orchestratorAi.coordinatorProfiles' ? [profile] : fallback }
  };
  const context = { workspaceState };
  const view = Object.create(OrchestratorHomeView.prototype);
  Object.assign(view, {
    context,
    getState: async () => state,
    view: { webview: { postMessage: async message => { messages.push(message); } } },
    threadKey: 'orchestratorAi.chatThreads',
    activeKey: 'orchestratorAi.activeThread',
    coordinatorProfileAuth: {},
    memoryToolsByRoot: new Map(),
    schedulingRuns: new Map(),
    rescheduleRuns: new Set(),
    schedulingQueue: Promise.resolve(),
    refreshState: async () => {},
    memoryToolsByRoot: new Map(),
    releaseCompletedCheckoutSessions: async () => {},
    settlePendingDispatchAbort: async () => false,
    sharedTaskSlots: {
      ownerId: 'live-workflow-test',
      active: 0,
      register: async () => {},
      reserve: async () => ({ reserved: true }),
      release: async () => {},
      update: async () => {},
      snapshot: async () => ({ active: 0, externalActive: 0, uncertainExternal: 0, leases: [] })
    },
    taskActions: {
      checkCoordinatorProfile: async () => auth,
      runCoordinator: (selectedProfile, selectedProvider, prompt, model, effort) =>
        runCoordinator(selectedProfile, selectedProvider, path.join(temp, 'profiles'), project, prompt, model, effort),
      canUseWorktree: async () => false,
      listBranches: async root => worktrees.listBranches(root),
      listSessions: async () => [],
      recordTaskJournal: async (root, run, task, event) => {
        journalEvents.push({ taskId: task.id, event });
        return taskJournal.record(root, run, task, event);
      },
      start: async input => {
        startedTasks.push(input.task);
        return startClaudeCodeTask(extensionContext, workerSessions, input, taskJournal, worktrees, memoryRuntime);
      },
      poll: task => workerSessions.poll(task.sessionId),
      inspectChanges: async (_projectPath, worktreePath) => {
        const output = cp.execFileSync('git', ['status', '--short'], { cwd: worktreePath, encoding: 'utf8' });
        const files = output.split(/\r?\n/).filter(Boolean).map(line => ({ code: line.slice(0, 2).trim() || '??', path: line.slice(3) }));
        return { verified: true, clean: files.length === 0, files, totalFiles: files.length };
      },
      stop: input => workerSessions.stop(input.session),
      listTaskHandoffs: async () => [],
      resolveMemoryScope: async () => ({ workspace: 'default', project: memoryProject, source: 'live-integration' }),
      listMemoryTools: async root => listAiMemoryTools(memoryConnection.executable, root, memoryConnection),
      callMemoryTool: async (root, name, input) => callAiMemoryTool(memoryConnection.executable, root, name, input, memoryConnection)
    }
  });

  t.after(async () => {
    await Promise.all([...workerSessions.sessions.keys()].map(id => workerSessions.stop(id).catch(() => {})));
    workerSessions.dispose();
    const children = [...memoryRuntime.processes.values()];
    memoryRuntime.dispose();
    await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))));
    vscodeState.projectRoot = '';
    vscodeState.approvedWrites = [];
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  await view.sendMessage('This is a request to perform work, not a question. Return exactly mode="plan" with one Claude task only. The task must create exactly one file named workflow-result.txt in its task checkout with the exact content LIVE_WORKFLOW_ACCEPTED using the Write tool. Do not answer in mode="answer" and do not start any agent now.');
  let runs = workspaceState.get(taskRunsKey, []);
  assert.equal(runs.length, 1, JSON.stringify({ messages, thread: workspaceState.get('orchestratorAi.chatThreads', []) }));
  assert.equal(runs[0].status, 'awaitingApproval');
  assert.equal(startedTasks.length, 0, 'a real provider plan must not dispatch before explicit user approval');
  assert.equal(runs[0].tasks.length, 1);
  Object.assign(runs[0].tasks[0], {
    provider: 'claude', executor: 'claude-code-cli', worktree: 'orchestrator/live-workflow-task',
    title: 'Write the approved workflow result',
    description: 'Create exactly one file named workflow-result.txt in your task checkout with the exact content LIVE_WORKFLOW_ACCEPTED using the Write tool. Do not modify other files.',
    acceptanceCriteria: ['workflow-result.txt contains exactly LIVE_WORKFLOW_ACCEPTED.']
  });

  await view.approvePlan(runs[0].id, JSON.stringify({ title: runs[0].title, tasks: runs[0].tasks }));
  runs = workspaceState.get(taskRunsKey, []);
  assert.equal(startedTasks.length, 1, 'approval must pass the validated plan into the task scheduler');
  assert.equal(runs[0].tasks[0].status, 'running');
  assert.ok(runs[0].tasks[0].sessionId);
  assert.equal(runs[0].tasks[0].executor, 'claude-code-cli');
  assert.ok(journalEvents.some(event => event.event === 'plan-approved'));
  assert.ok(journalEvents.some(event => event.event === 'session-started'));
  assert.ok(messages.some(message => message.type === 'busy' && message.value === false));

  const workerId = runs[0].tasks[0].sessionId;
  const worktreePath = runs[0].tasks[0].worktreePath;
  assert.ok(worktreePath && path.resolve(worktreePath) !== path.resolve(project));
  const deadline = Date.now() + 120000;
  let workerResult;
  while (Date.now() < deadline) {
    const outcome = workerSessions.poll(workerId);
    if (outcome.status === 'answered') { workerResult = outcome; break; }
    if (outcome.status === 'failed') throw new Error(`Worker failed: ${outcome.error}`);
    await delay(250);
  }
  assert.ok(workerResult, 'real Claude worker must finish within the bounded test window');
  assert.match(workerResult.result, /LIVE_WORKFLOW_ACCEPTED/);
  assert.equal(vscodeState.approvedWrites.length, 1);
  assert.equal(path.resolve(vscodeState.approvedWrites[0].filePath), path.join(worktreePath, 'workflow-result.txt'));
  assert.equal(await fs.readFile(path.join(worktreePath, 'workflow-result.txt'), 'utf8'), 'LIVE_WORKFLOW_ACCEPTED');
  assert.equal(await fs.readFile(path.join(project, 'src', 'baseline.txt'), 'utf8'), 'baseline\n');
  assert.equal(runs[0].tasks[0].memory.contextReadVerified, true);
  assert.equal(runs[0].tasks[0].memory.status, 'coordinator-write-read-verified');

  await view.pollTasks(true);
  runs = workspaceState.get(taskRunsKey, []);
  assert.equal(runs[0].tasks[0].status, 'awaitingReview');
  assert.match(runs[0].tasks[0].result, /LIVE_WORKFLOW_ACCEPTED/);
  await view.reviewTask(runs[0].id, runs[0].tasks[0].id, true);
  runs = workspaceState.get(taskRunsKey, []);
  assert.equal(runs[0].tasks[0].status, 'complete');
  assert.equal(runs[0].status, 'complete');
  const attemptPage = await readAiMemoryPage(memoryConnection.executable, project, {
    workspace: 'default', project: memoryProject, projectId: runs[0].tasks[0].memory.projectId
  }, runs[0].tasks[0].memory.agentPagePath, 12000, memoryConnection);
  assert.ok(attemptPage.body.includes(runs[0].tasks[0].memory.agentMarker));
  assert.match(attemptPage.body, /workflow-result\.txt/);
});

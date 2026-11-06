const vscode = require('vscode');
const cp = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { randomUUID } = require('node:crypto');
const yauzl = require('yauzl');
const { OrchestratorSettingsView } = require('./settingsView');

const bundledSkills = path.resolve(__dirname, '..', 'skills');
const releaseManifestPath = path.resolve(__dirname, '..', 'upstream-releases.json');

function workspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Abra uma pasta de projeto antes de usar o Orquestrador.');
  return folder.uri.fsPath;
}

function run(executable, args, cwd, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(executable, args, { cwd, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      const result = { code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code === 0) resolve(result);
      else reject(new Error(`${executable} ${args.join(' ')} exited ${result.code}\n${result.stderr || result.stdout}`));
    });
  });
}

function download(url, maxBytes = 512 * 1024 * 1024) {
  return fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'production-orchestrator-vscode' } })
    .then(async response => {
      if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > maxBytes) throw new Error(`Release asset exceeds size limit: ${url}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error(`Release asset exceeds size limit: ${url}`);
      return buffer;
    });
}

function extractZipSafely(zipPath, destination, maxExpandedBytes = 1024 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error) return reject(error);
      let expanded = 0;
      const root = path.resolve(destination);
      const rejectZip = reason => { zip.close(); reject(new Error(reason)); };
      zip.readEntry();
      zip.on('entry', entry => {
        const normalized = entry.fileName.replace(/\\/g, '/');
        if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
          return rejectZip(`Unsafe archive entry: ${entry.fileName}`);
        }
        expanded += Number(entry.uncompressedSize || 0);
        if (expanded > maxExpandedBytes) return rejectZip('Release archive expands beyond the allowed size.');
        const target = path.resolve(root, ...normalized.split('/'));
        const relative = path.relative(root, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return rejectZip(`Unsafe archive path: ${entry.fileName}`);
        if (normalized.endsWith('/')) {
          fs.mkdir(target, { recursive: true }).then(() => zip.readEntry(), rejectZip);
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return rejectZip(streamError.message);
          fs.mkdir(path.dirname(target), { recursive: true }).then(() => {
            const chunks = [];
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('error', rejectZip);
            stream.on('end', async () => {
              try {
                await fs.writeFile(target, Buffer.concat(chunks), { flag: 'wx', mode: (entry.externalFileAttributes >>> 16) & 0o777 || 0o644 });
                zip.readEntry();
              } catch (writeError) { rejectZip(writeError.message); }
            });
          }, rejectZip);
        });
      });
      zip.on('end', resolve);
      zip.on('error', reject);
    });
  });
}

async function releaseManifest() {
  return JSON.parse(await fs.readFile(releaseManifestPath, 'utf8'));
}

async function installedToolPath(context, toolName, version) {
  const home = path.join(context.globalStorageUri.fsPath, 'tools', toolName, version);
  return findFile(home, toolName === 'lich' ? 'lich.exe' : 'ai-memory.exe').catch(() => undefined);
}

async function toolExecutable(context, toolName, fallback) {
  const defaultCommand = toolName === 'lich' ? 'lich' : 'ai-memory';
  if (fallback && fallback !== defaultCommand) return fallback;
  const manifest = await releaseManifest();
  const key = toolName === 'lich' ? 'lich' : 'aiMemory';
  return await installedToolPath(context, toolName, manifest[key].version) || fallback;
}

async function installPinnedTool(context, toolName, entry) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('O instalador automático inicial suporta Windows x64. Os assets de outros sistemas ainda precisam ser adicionados ao release manifest.');
  }
  const home = path.join(context.globalStorageUri.fsPath, 'tools', toolName, entry.version);
  const binName = toolName === 'lich' ? 'lich.exe' : 'ai-memory.exe';
  const existing = await findFile(home, binName).catch(() => undefined);
  if (existing) return existing;

  const archive = await download(entry.url);
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  if (digest !== entry.sha256.toLowerCase()) throw new Error(`${toolName} SHA-256 mismatch; refusing to install the release asset.`);
  await fs.mkdir(home, { recursive: true });
  const archivePath = path.join(home, 'release.zip');
  await fs.writeFile(archivePath, archive, { flag: 'wx' }).catch(async error => {
    if (error.code !== 'EEXIST') throw error;
    await fs.rm(archivePath);
    await fs.writeFile(archivePath, archive, { flag: 'wx' });
  });
  const staging = `${home}.staging-${Date.now()}`;
  await fs.mkdir(staging, { recursive: true });
  try {
    await extractZipSafely(archivePath, staging);
    const found = await findFile(staging, binName);
    if (!found) throw new Error(`${toolName} archive does not contain ${binName}.`);
    await fs.rm(home, { recursive: true, force: true });
    await fs.rename(staging, home);
    await fs.rm(archivePath, { force: true });
    return path.join(home, path.relative(staging, found));
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function findFile(root, filename) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return candidate;
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, filename);
      if (nested) return nested;
    }
  }
  return undefined;
}

function result(value) {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);
}

function confirmInvocation(title, message, invocationMessage) {
  return {
    invocationMessage,
    confirmationMessages: { title, message }
  };
}

async function initializeWorkspace() {
  const root = workspaceRoot();
  const ai = path.join(root, '.ai');
  try {
    const existing = await fs.stat(ai);
    return {
      created: false,
      message: existing.isDirectory()
        ? 'A pasta .ai já existe. O Orquestrador não alterou nenhum arquivo.'
        : 'Já existe um item chamado .ai que não é uma pasta. O Orquestrador não alterou nenhum arquivo.'
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const staging = path.join(root, `.ai.orchestrator-init-${randomUUID()}`);
  const readme = `# Project AI workspace\n\n- \`specs/\`: project-specific requirements, architecture, and acceptance gates.\n- \`skills/\`: reusable procedures for agents working in this project.\n- Keep project decisions here; personal preferences belong in the user's ai-memory profile.\n`;
  const specsReadme = `# Project specifications\n\nStore product requirements, architecture decisions, production procedures, and acceptance gates for this project here. Keep each specification scoped and link it from the project's instructions when it is mandatory.\n`;
  try {
    await fs.mkdir(path.join(staging, 'specs'), { recursive: true });
    await fs.mkdir(path.join(staging, 'skills'), { recursive: true });
    await fs.writeFile(path.join(staging, 'README.md'), readme, { flag: 'wx' });
    await fs.writeFile(path.join(staging, 'specs', 'README.md'), specsReadme, { flag: 'wx' });
    const names = await fs.readdir(bundledSkills, { withFileTypes: true });
    for (const entry of names) {
      if (!entry.isDirectory()) continue;
      const source = path.join(bundledSkills, entry.name, 'SKILL.md');
      const target = path.join(staging, 'skills', entry.name, 'SKILL.md');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
    }
    await fs.writeFile(path.join(staging, 'orchestrator.json'), `${JSON.stringify({ build: null, upstreams: [], tools: {} }, null, 2)}\n`, { flag: 'wx' });
    try {
      await fs.rename(staging, ai);
      return { created: true, message: `Projeto preparado em ${ai} com specs, skills e configuração inicial.` };
    } catch (error) {
      if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
        await fs.rm(staging, { recursive: true, force: true });
        return { created: false, message: 'A pasta .ai foi criada por outra ação. Nenhum arquivo existente foi alterado.' };
      }
      throw error;
    }
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function checkTools(context) {
  const root = workspaceRoot();
  const projectConfig = await readProjectConfigOptional();
  const lich = await toolExecutable(context, 'lich', projectConfig.tools?.lichCommand || 'lich');
  const memory = await toolExecutable(context, 'ai-memory', projectConfig.tools?.aiMemoryCommand || 'ai-memory');
  const checks = await Promise.allSettled([
    run(lich, ['version', '--json'], root, 10000),
    run(memory, ['status'], root, 15000)
  ]);
  const label = (name, item) => item.status === 'fulfilled'
    ? `${name}: available\n${item.value.stdout || item.value.stderr}`
    : `${name}: unavailable\n${String(item.reason?.message || item.reason)}`;
  return `${label('lich', checks[0])}\n\n${label('ai-memory', checks[1])}`;
}

async function installDependencies(context) {
  const manifest = await releaseManifest();
  const lichPath = await installPinnedTool(context, 'lich', manifest.lich.windowsX64);
  const memoryPath = await installPinnedTool(context, 'ai-memory', manifest.aiMemory.windowsX64);
  const lichProcess = cp.spawn(lichPath, [], { cwd: workspaceRootOrStorage(context), detached: true, stdio: 'ignore', windowsHide: false });
  lichProcess.unref();
  const setupCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || context.globalStorageUri.fsPath;
  const setup = await run(memoryPath, ['setup', '--yes'], setupCwd, 180000);
  return `Installed official releases:\n- lich ${manifest.lich.version}: ${lichPath}\n- ai-memory ${manifest.aiMemory.version}: ${memoryPath}\n\nLich was started. Reload VS Code if the ai-memory MCP tools do not appear in Chat.\n\nai-memory setup:\n${setup.stdout || '(no stdout)'}${setup.stderr ? `\n${setup.stderr}` : ''}`;
}

function workspaceRootOrStorage(context) {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || context.globalStorageUri.fsPath;
}

async function listLichSessions(context) {
  const root = workspaceRoot();
  const config = await readProjectConfigOptional();
  const executable = await toolExecutable(context, 'lich', config.tools?.lichCommand || 'lich');
  const response = await run(executable, ['sessions', '--json'], root, 15000);
  return response.stdout || '[]';
}

async function delegateWithLich(context, input) {
  const root = workspaceRoot();
  const task = String(input.task || '').trim();
  const provider = String(input.provider || '').trim();
  if (!task || !provider) throw new Error('Informe task e provider.');
  if (task.length > 7000) throw new Error('A tarefa excede o limite de 7000 caracteres.');
  const config = await readProjectConfigOptional();
  const executable = await toolExecutable(context, 'lich', config.tools?.lichCommand || 'lich');
  const args = ['open', '--project', root, '--kind', provider, '--prompt', task, '--json'];
  if (input.worktree) args.splice(args.length - 1, 0, '--worktree', String(input.worktree));
  const response = await run(executable, args, root, 60000);
  return response.stdout;
}

async function readProjectConfig() {
  const file = path.join(workspaceRoot(), '.ai', 'orchestrator.json');
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Use “Preparar projeto (.ai)” no painel do Orquestrador e defina build/upstreams em Configurações.');
    throw new Error(`Invalid .ai/orchestrator.json: ${error.message}`);
  }
}

async function readProjectConfigOptional() {
  try { return await readProjectConfig(); }
  catch (error) {
    if (error.message.startsWith('Use ')) return { build: null, upstreams: [], tools: {} };
    throw error;
  }
}

async function saveProjectSettings(settings) {
  const root = workspaceRoot();
  const ai = path.join(root, '.ai');
  const stat = await fs.stat(ai).catch(() => undefined);
  if (!stat?.isDirectory()) throw new Error('Use “Preparar projeto (.ai)” antes de salvar as configurações.');

  const build = settings.build && String(settings.build.command || '').trim()
    ? {
        command: String(settings.build.command).trim(),
        args: Array.isArray(settings.build.args) ? settings.build.args.map(String) : [],
        cwd: String(settings.build.cwd || '.').trim() || '.',
        timeoutMs: Math.max(1000, Number(settings.build.timeoutMs) || 1800000)
      }
    : null;
  if (build) {
    const buildCwd = path.resolve(root, build.cwd);
    const relative = path.relative(root, buildCwd);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('A pasta do build precisa permanecer dentro do projeto.');
    }
  }

  const upstreams = Array.isArray(settings.upstreams) ? settings.upstreams.map(item => ({
    path: String(item.path || '').trim(),
    remote: String(item.remote || '').trim(),
    branch: String(item.branch || 'main').trim() || 'main'
  })).filter(item => item.path || item.remote) : [];
  for (const item of upstreams) {
    if (!item.path || !item.remote) throw new Error('Cada upstream precisa de uma pasta relativa e um remote Git.');
    if (path.isAbsolute(item.path)) throw new Error(`A pasta upstream deve ser relativa ao projeto: ${item.path}`);
    const target = path.resolve(root, item.path);
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`A pasta upstream precisa permanecer dentro do projeto: ${item.path}`);
    }
  }
  const tools = {
    lichCommand: String(settings.tools?.lichCommand || '').trim(),
    aiMemoryCommand: String(settings.tools?.aiMemoryCommand || '').trim()
  };
  const next = { build, upstreams, tools };
  const target = path.join(ai, 'orchestrator.json');
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(temporary, target);
}

async function syncUpstreams() {
  const root = workspaceRoot();
  const config = await readProjectConfig();
  const upstreams = Array.isArray(config.upstreams) ? config.upstreams : [];
  const report = [];
  for (const item of upstreams) {
    if (!item || typeof item.path !== 'string' || typeof item.remote !== 'string') {
      throw new Error('Each upstream requires path and remote fields.');
    }
    const target = path.resolve(root, item.path);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Upstream path escapes workspace: ${item.path}`);
    const branch = String(item.branch || 'main');
    const dirty = await run('git', ['status', '--porcelain'], target, 15000);
    if (dirty.stdout) throw new Error(`Refusing to sync dirty upstream ${item.path}; preserve and resolve its local changes first.`);
    const remoteUrl = await run('git', ['remote', 'get-url', item.remote], target, 15000);
    if (!remoteUrl.stdout) throw new Error(`Remote ${item.remote} is not configured in ${item.path}.`);
    await run('git', ['fetch', '--prune', item.remote, branch], target, 120000);
    await run('git', ['merge', '--ff-only', `${item.remote}/${branch}`], target, 120000);
    const head = await run('git', ['rev-parse', 'HEAD'], target, 15000);
    report.push(`${item.path}: ${head.stdout}`);
  }
  return upstreams.length ? report.join('\n') : 'No upstreams are configured; nothing was changed.';
}

async function runConfiguredBuild() {
  const root = workspaceRoot();
  const config = await readProjectConfig();
  const build = config.build;
  if (!build || typeof build.command !== 'string' || !Array.isArray(build.args)) {
    throw new Error('Defina o comando de build em Orquestrador → Configurações antes de compilar.');
  }
  const synced = await syncUpstreams();
  const cwd = path.resolve(root, build.cwd || '.');
  if (cwd !== root && !cwd.startsWith(root + path.sep)) throw new Error('Configured build.cwd must stay inside the workspace.');
  const response = await run(build.command, build.args.map(String), cwd, Number(build.timeoutMs) || 1800000);
  return `Upstream sync:\n${synced}\n\nBuild output:\n${response.stdout || '(no stdout)'}${response.stderr ? `\n\n${response.stderr}` : ''}`;
}

function registerTool(context, name, handler, prepare) {
  context.subscriptions.push(vscode.lm.registerTool(name, {
    invoke: async options => {
      try { return result(await handler(context, options.input || {})); }
      catch (error) { return result(`ERROR: ${error.message || error}`); }
    },
    ...(prepare ? { prepareInvocation: options => prepare(options.input || {}) } : {})
  }));
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('productionOrchestrator.initializeWorkspace', async () => {
    try { vscode.window.showInformationMessage((await initializeWorkspace()).message); }
    catch (error) { vscode.window.showErrorMessage(error.message || String(error)); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('productionOrchestrator.checkTools', async () => {
    try { vscode.window.showInformationMessage(await checkTools(context), { modal: true }); }
    catch (error) { vscode.window.showErrorMessage(error.message || String(error)); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('productionOrchestrator.installDependencies', async () => {
    const choice = await vscode.window.showWarningMessage('Install the official lich and ai-memory releases into VS Code user storage and run ai-memory setup?', { modal: true }, 'Install / update');
    if (choice !== 'Install / update') return;
    try { vscode.window.showInformationMessage(await installDependencies(context)); }
    catch (error) { vscode.window.showErrorMessage(error.message || String(error)); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('productionOrchestrator.openChat', async () => {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: 'Use the Orquestrador agent to inspect this project and report its production workflow.' });
  }));
  context.subscriptions.push(vscode.commands.registerCommand('productionOrchestrator.openSettings', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.productionOrchestrator');
  }));

  const settingsView = new OrchestratorSettingsView(context, {
    initializeWorkspace,
    saveSettings: saveProjectSettings,
    checkTools: () => checkTools(context),
    installDependencies: () => installDependencies(context)
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('productionOrchestrator.settings', settingsView));

  registerTool(context, 'productionOrchestrator.initialize_workspace', async () => (await initializeWorkspace()).message);
  registerTool(context, 'productionOrchestrator.check_tools', ctx => checkTools(ctx));
  registerTool(context, 'productionOrchestrator.install_dependencies', ctx => installDependencies(ctx), () => confirmInvocation(
    'Install or update lich and ai-memory?', 'Download the exact stable releases pinned in this extension build, verify SHA-256, install them in VS Code user storage, and run ai-memory setup for this user.', 'Installing verified orchestration tools'
  ));
  registerTool(context, 'productionOrchestrator.list_lich_sessions', ctx => listLichSessions(ctx));
  registerTool(context, 'productionOrchestrator.delegate_lich_task', (ctx, input) => delegateWithLich(ctx, input), input => confirmInvocation(
    'Start a lich agent session?', `Delegate this task to ${input.provider || 'the selected provider'} in the current workspace?\n\n${String(input.task || '').slice(0, 500)}`,
    `Delegating to ${input.provider || 'lich'}`
  ));
  registerTool(context, 'productionOrchestrator.sync_upstreams', syncUpstreams, () => confirmInvocation(
    'Update project upstreams?', 'Fetch and fast-forward only the repositories declared in .ai/orchestrator.json. Dirty repositories stop the operation.', 'Synchronizing project upstreams'
  ));
  registerTool(context, 'productionOrchestrator.run_build', runConfiguredBuild, () => confirmInvocation(
    'Synchronize and build this project?', 'The configured upstream repositories will be fast-forwarded, then the configured build command will run.', 'Syncing upstreams and building'
  ));

  setTimeout(async () => {
    try {
      const manifest = await releaseManifest();
      const [lich, memory] = await Promise.all([
        installedToolPath(context, 'lich', manifest.lich.version),
        installedToolPath(context, 'ai-memory', manifest.aiMemory.version)
      ]);
      if (lich && memory) return;
      vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Installing verified Orquestrador tools' }, async () => {
        try {
          const report = await installDependencies(context);
          vscode.window.showInformationMessage(`Orquestrador tools installed: lich ${manifest.lich.version}, ai-memory ${manifest.aiMemory.version}.`);
          console.log(report);
        } catch (error) {
          vscode.window.showErrorMessage(`Could not install Orquestrador tools: ${error.message || error}`);
        }
      });
    } catch (error) {
      vscode.window.showWarningMessage(`Orchestrator dependency setup is unavailable: ${error.message || error}`);
    }
  }, 2500);
}

function deactivate() {}

module.exports = { activate, deactivate };

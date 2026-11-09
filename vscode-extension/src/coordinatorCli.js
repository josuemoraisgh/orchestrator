const cp = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function profileHome(profile, storageRoot) {
  if (!profile?.isolated) return '';
  const id = String(profile.id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('O identificador do perfil do coordenador é inválido.');
  }
  return path.join(storageRoot, 'coordinator-profiles', id);
}

function profileEnvironment(profile, storageRoot) {
  const home = profileHome(profile, storageRoot);
  if (!home) return { ...process.env };
  const env = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_IDENTITY_TOKEN_FILE', 'OPENAI_FEDERATION_RULE_ID', 'OPENAI_WORKLOAD_IDENTITY_CONTEXT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[key];
  env[profile.providerId === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'] = home;
  return env;
}

async function prepareProfileHome(profile, storageRoot) {
  const home = profileHome(profile, storageRoot);
  if (!home) return;
  await fs.mkdir(home, { recursive: true });
  if (profile.providerId !== 'codex') return;
  const configPath = path.join(home, 'config.toml');
  const config = await fs.readFile(configPath, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (config === undefined) {
    await fs.writeFile(configPath, 'cli_auth_credentials_store = "file"\n', { encoding: 'utf8', flag: 'wx' });
  } else {
    const activeLines = config.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    const onlyFileStore = activeLines.length === 1 && /^cli_auth_credentials_store\s*=\s*["']file["'](?:\s+#.*)?$/.test(activeLines[0]);
    if (onlyFileStore) return;
    throw new Error('This isolated Codex profile must use cli_auth_credentials_store = "file". The existing configuration was preserved.');
  }
}

async function removeTempDirectory(directory) {
  const root = path.resolve(os.tmpdir());
  const target = path.resolve(directory);
  const relative = path.relative(root, target);
  if (path.basename(target).startsWith('orchestrator-coordinator-') && relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
    await fs.rm(target, { recursive: true, force: true });
  }
}

async function findNodeExecutable() {
  const extensions = process.platform === 'win32'
    ? [...new Set([...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';'), '.EXE'])]
    : [''];
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory.replace(/^"|"$/g, ''), `node${extension}`);
      try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch { /* Try the next PATH entry. */ }
    }
  }
  return '';
}

async function coordinatorInvocation(profile, provider) {
  const executable = String(provider?.executablePath || '');
  if (!executable) throw new Error('CLI do coordenador não encontrada.');
  if (process.platform !== 'win32' || !/\.(?:ps1|cmd|bat)$/i.test(executable)) return { executable, prefixArgs: [] };

  const npmRoot = path.join(path.dirname(executable), 'node_modules');
  if (profile.providerId === 'claude') {
    const native = path.join(npmRoot, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    try { if ((await fs.stat(native)).isFile()) return { executable: native, prefixArgs: [] }; } catch { /* Not the standard npm shim. */ }
  }
  if (profile.providerId === 'codex') {
    const script = path.join(npmRoot, '@openai', 'codex', 'bin', 'codex.js');
    try {
      if ((await fs.stat(script)).isFile()) {
        const node = await findNodeExecutable();
        if (node) return { executable: node, prefixArgs: [script] };
      }
    } catch { /* Not the standard npm shim. */ }
  }
  throw new Error(`${provider.name} usa um wrapper Windows sem executável nativo resolvível. Configure o caminho do binário oficial diretamente.`);
}

function parseCodexModelCatalog(output) {
  let catalog;
  try { catalog = JSON.parse(String(output || '').trim()); }
  catch { throw new Error('Codex CLI returned an invalid model catalog.'); }
  if (!Array.isArray(catalog?.models)) throw new Error('Codex CLI returned no model catalog.');
  return catalog.models
    .filter(model => model?.visibility === 'list' && model.supported_in_api === true && typeof model.slug === 'string' && model.slug.trim())
    .map(model => ({
      id: model.slug.trim(),
      name: typeof model.display_name === 'string' && model.display_name.trim() ? model.display_name.trim() : model.slug.trim(),
      defaultEffort: typeof model.default_reasoning_level === 'string' ? model.default_reasoning_level : '',
      efforts: Array.isArray(model.supported_reasoning_levels)
        ? model.supported_reasoning_levels.map(item => String(item?.effort || '').trim()).filter(Boolean)
        : []
    }));
}

async function listCodexModelCatalog(provider, env = process.env) {
  if (!provider?.executablePath) throw new Error('Codex CLI is not available.');
  const invocation = await coordinatorInvocation({ providerId: 'codex' }, provider);
  const result = await run(invocation.executable, [...invocation.prefixArgs, 'debug', 'models'], os.tmpdir(), env, undefined, 20000, 1000000);
  if (result.code !== 0) throw new Error('Codex CLI could not load its model catalog.');
  return parseCodexModelCatalog(result.stdout);
}

function resolveCodexModelSelection(models, requestedModel = '', requestedEffort = '') {
  if (!Array.isArray(models) || models.length === 0) throw new Error('A CLI do Codex não anunciou modelos disponíveis para esta conta.');
  const requested = String(requestedModel || '').trim();
  const selected = requested ? models.find(item => item.id === requested) : models[0];
  if (!selected) {
    const available = models.map(item => item.id).slice(0, 12).join(', ');
    throw new Error(`O modelo Codex “${requested}” não está disponível neste perfil. Modelos anunciados: ${available}.`);
  }
  const requestedLevel = String(requestedEffort || '').trim();
  if (requestedLevel && !selected.efforts.includes(requestedLevel)) {
    throw new Error(`O esforço “${requestedLevel}” não é suportado pelo modelo Codex “${selected.id}”. Opções: ${selected.efforts.join(', ') || 'nenhuma'}.`);
  }
  return { model: selected.id, effort: requestedLevel || selected.defaultEffort || '' };
}

function run(executable, args, cwd, env, input, timeoutMs = 180000, maxStdout = 200000) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(executable, args, { cwd, env, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error('O agente coordenador excedeu o tempo limite.'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', chunk => { if (stdout.length < maxStdout) stdout += chunk.slice(0, maxStdout - stdout.length); });
    child.stderr.setEncoding('utf8').on('data', chunk => { if (stderr.length < 12000) stderr += chunk.slice(0, 12000 - stderr.length); });
    child.on('error', error => finish(reject, error));
    child.on('exit', code => finish(resolve, { code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function checkProfileAuthentication(profile, provider, storageRoot, cwd) {
  if (!profile || !provider?.executablePath || !['claude', 'codex'].includes(profile.providerId)) {
    return { status: 'unavailable', checkedAt: Date.now(), text: 'CLI de coordenador indisponível.' };
  }
  const env = profileEnvironment(profile, storageRoot);
  await prepareProfileHome(profile, storageRoot);
  const invocation = await coordinatorInvocation(profile, provider).catch(() => undefined);
  if (!invocation) return { status: 'unavailable', checkedAt: Date.now(), text: `${provider.name}: nao foi possivel resolver o executavel deste perfil.` };
  const args = profile.providerId === 'claude' ? ['auth', 'status'] : ['login', 'status'];
  const result = await run(invocation.executable, [...invocation.prefixArgs, ...args], cwd, env, undefined, 15000).catch(() => undefined);
  if (!result) return { status: 'unverified', checkedAt: Date.now(), text: `${provider.name}: não foi possível confirmar a autenticação deste perfil.` };
  if (result.code === 0) {
    if (profile.providerId === 'claude') {
      try {
        const status = JSON.parse(result.stdout);
        if (status.loggedIn !== true) return { status: 'missing', checkedAt: Date.now(), text: `${provider.name}: este perfil não está autenticado.` };
        if (profile.isolated && (!status.configDirectory || path.resolve(status.configDirectory).toLowerCase() !== path.resolve(profileHome(profile, storageRoot)).toLowerCase())) {
          return { status: 'unverified', checkedAt: Date.now(), text: `${provider.name}: a CLI não confirmou o diretório de autenticação isolado deste perfil.` };
        }
      } catch { return { status: 'unverified', checkedAt: Date.now(), text: `${provider.name}: a CLI não confirmou o estado deste perfil.` }; }
    } else if (!/logged\s+in|authenticated/i.test(`${result.stdout}\n${result.stderr}`)) {
      return { status: 'unverified', checkedAt: Date.now(), text: `${provider.name}: a CLI não retornou um estado de autenticação reconhecível.` };
    }
    return { status: 'verified', checkedAt: Date.now(), text: `${provider.name}: autenticação deste perfil confirmada pela CLI. Dados da conta não foram exibidos.` };
  }
  if (result.code === 1) return { status: 'missing', checkedAt: Date.now(), text: `${provider.name}: este perfil não está autenticado.` };
  return { status: 'unverified', checkedAt: Date.now(), text: `${provider.name}: não foi possível confirmar a autenticação deste perfil.` };
}

async function runCoordinator(profile, provider, storageRoot, cwd, prompt, model, effort) {
  if (!profile || !provider?.executablePath || !['claude', 'codex'].includes(profile.providerId)) throw new Error('Perfil CLI do coordenador indisponível.');
  const invocation = await coordinatorInvocation(profile, provider);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-coordinator-'));
  const schemaPath = path.join(tempRoot, 'response-schema.json');
  const answerPath = path.join(tempRoot, 'response.json');
  const schema = {
    type: 'object', additionalProperties: false, required: ['mode', 'answer', 'plan', 'handoff'],
    properties: {
      mode: { type: 'string', enum: ['answer', 'plan', 'handoff'] },
      answer: { type: ['string', 'null'] },
      handoff: {
        type: ['object', 'null'], additionalProperties: false,
        required: ['runId', 'taskId', 'provider', 'executor', 'profileId', 'model', 'effort', 'context'],
        properties: {
          runId: { type: 'string', minLength: 1, maxLength: 120 }, taskId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
          provider: { type: 'string', minLength: 1, maxLength: 120 },
          executor: { type: 'string', enum: ['vscode-model', 'codex-app-server', 'claude-code-cli', 'lich-cli'] },
          profileId: { type: 'string', maxLength: 120 }, model: { type: 'string', maxLength: 160 }, effort: { type: 'string', maxLength: 40 },
          context: { type: 'string', minLength: 1, maxLength: 5000 }
        }
      },
      plan: {
        type: ['object', 'null'], additionalProperties: false, required: ['title', 'tasks'],
        properties: {
          title: { type: 'string' },
          tasks: {
            type: 'array', minItems: 1, maxItems: 12,
            items: {
              type: 'object', additionalProperties: false,
              required: ['id', 'title', 'description', 'acceptanceCriteria', 'dependsOn', 'provider', 'profileId', 'executor', 'model', 'effort', 'worktree', 'base', 'estimatedCostUsd'],
              properties: {
                id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
                acceptanceCriteria: { type: 'array', items: { type: 'string' } },
                dependsOn: { type: 'array', items: { type: 'string' } },
                provider: { type: 'string' }, profileId: { type: 'string' }, executor: { type: 'string', enum: ['auto', 'vscode-model', 'codex-app-server', 'claude-code-cli', 'lich-cli'] }, model: { type: 'string' }, effort: { type: 'string' }, worktree: { type: 'string' }, base: { type: 'string' },
                estimatedCostUsd: { type: ['number', 'null'] }
              }
            }
          }
        }
      }
    }
  };
  await fs.writeFile(schemaPath, JSON.stringify(schema), 'utf8');
  try {
    const env = profileEnvironment(profile, storageRoot);
    await prepareProfileHome(profile, storageRoot);
    const codexSelection = profile.providerId === 'codex'
      ? resolveCodexModelSelection(await listCodexModelCatalog(provider, env), model, effort)
      : { model, effort };
    const args = profile.providerId === 'codex'
      ? ['exec', '--sandbox', 'read-only', '--ignore-user-config', '--skip-git-repo-check', ...(profile.isolated ? ['--config', 'cli_auth_credentials_store=file'] : []), '--output-schema', schemaPath, '--output-last-message', answerPath, ...(codexSelection.model ? ['--model', codexSelection.model] : []), ...(codexSelection.effort ? ['--config', `model_reasoning_effort=${codexSelection.effort}`] : []), '-']
      : ['-p', '--restricted', '--tools', 'Read,Glob,Grep', '--disallowedTools', 'mcp__*', '--permission-mode', 'plan', '--permission-prompts', 'none', '--output-format', 'json', '--json-schema', JSON.stringify(schema), ...(codexSelection.model ? ['--model', codexSelection.model] : []), ...(codexSelection.effort ? ['--effort', codexSelection.effort] : []), prompt];
    const result = await run(invocation.executable, [...invocation.prefixArgs, ...args], cwd, env, profile.providerId === 'codex' ? prompt : undefined);
    if (result.code !== 0) {
      const detail = result.stderr
        ? ` Detalhe: ${result.stderr.replace(/\b(?:sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+)\b/g, '[credencial ocultada]').slice(0, 800)}`
        : '';
      throw new Error(`${provider.name} CLI terminou com código ${result.code}. Confira a autenticação, o modelo e a configuração da CLI.${detail}`);
    }
    if (profile.providerId === 'codex') return await fs.readFile(answerPath, 'utf8');
    let response;
    try { response = JSON.parse(result.stdout); }
    catch { throw new Error('Claude CLI não retornou a resposta estruturada esperada.'); }
    const text = typeof response.result === 'string' ? response.result : response.structured_output;
    if (typeof text === 'string') return text;
    if (text && typeof text === 'object') return JSON.stringify(text);
    throw new Error('Claude CLI não incluiu a resposta estruturada.');
  } finally {
    await removeTempDirectory(tempRoot).catch(() => {});
  }
}

module.exports = { checkProfileAuthentication, coordinatorInvocation, listCodexModelCatalog, parseCodexModelCatalog, prepareProfileHome, profileEnvironment, profileHome, resolveCodexModelSelection, runCoordinator };

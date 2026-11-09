'use strict';

const cp = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { redactSensitiveText } = require('./secretRedaction');

const MAX_LINE_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30000;
const TASK_MEMORY_TOOL_DESCRIPTIONS = new Map([
  ['read_task_context', 'Read the verified shared AI Memory page for this task or this agent attempt. Page paths and project scope are fixed by Orchestrator.'],
  ['write_task_context', 'Update only this agent attempt page in the official AI Memory runtime. The path and project scope are fixed; include a complete continuity update and preserve the required agent marker. The coordinator owns the shared task page.']
]);

function memoryToolElicitationResponse(params, memoryBridge) {
  const metadata = params?._meta && typeof params._meta === 'object' && !Array.isArray(params._meta) ? params._meta : {};
  const toolDescription = typeof metadata.tool_description === 'string' ? metadata.tool_description : '';
  const describedTool = [...TASK_MEMORY_TOOL_DESCRIPTIONS].find(([, description]) => description === toolDescription)?.[0] || '';
  const toolName = String(metadata.tool_name || metadata.toolName || describedTool);
  const properties = params?.requestedSchema?.properties;
  const safeSchema = params?.requestedSchema?.type === 'object'
    && properties && typeof properties === 'object' && !Array.isArray(properties)
    && Object.keys(properties).length === 0
    && (!Array.isArray(params.requestedSchema.required) || params.requestedSchema.required.length === 0);
  const approved = Boolean(memoryBridge?.executable && memoryBridge?.connection?.url)
    && params?.serverName === 'orchestrator_memory'
    && params?.mode === 'form'
    && metadata.codex_approval_kind === 'mcp_tool_call'
    && TASK_MEMORY_TOOL_DESCRIPTIONS.has(toolName)
    && safeSchema;
  return { action: approved ? 'accept' : 'decline', content: approved ? {} : null, _meta: null };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(', ')}]`;
}

function safeDiagnostic(value) {
  return redactSensitiveText(value, 2000)
    .replace(/\[REDACTED CREDENTIAL\]/g, '[credential redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);
}

function lifecycleEvent(method, params, threadId) {
  if (method === 'turn/plan/updated') {
    const plan = params?.plan;
    const steps = Array.isArray(plan) ? plan.length : Array.isArray(plan?.steps) ? plan.steps.length : undefined;
    return {
      type: 'codex-plan-updated',
      threadId,
      summary: `Codex updated the plan${Number.isInteger(steps) ? ` (${steps} steps)` : ''}.`.slice(0, 200)
    };
  }

  const item = params?.item || {};
  const itemType = String(item.type || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80) || 'unknown';
  const phase = method === 'item/started' ? 'started' : 'completed';
  const status = typeof item.status === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(item.status) ? item.status : '';
  const exitCode = Number.isInteger(item.exitCode) ? item.exitCode : undefined;
  const details = [status && `status ${status}`, exitCode !== undefined && `exit code ${exitCode}`].filter(Boolean);
  return {
    type: `codex-item-${phase}`,
    threadId,
    toolName: itemType,
    summary: `Codex ${phase} ${itemType}${details.length ? ` (${details.join(', ')})` : ''}.`.slice(0, 200)
  };
}

function failureMessage(session, fallback) {
  const diagnostic = String(session.stderr || '').split(/\r?\n/)
    .map(line => safeDiagnostic(line))
    .filter(line => /(unsupported|not supported|model_not_found|invalid model|authentication failed|not logged in|login required)/i.test(line))
    .at(-1);
  return diagnostic ? `${fallback} Detalhe da CLI: ${diagnostic}` : fallback;
}

function memoryConfigArgs(memoryBridge, nodeExecutable) {
  if (!memoryBridge?.connection?.url || !memoryBridge.executable || !nodeExecutable) return [];
  const useElectronNode = Boolean(process.versions.electron) && require('node:path').resolve(nodeExecutable).toLowerCase() === require('node:path').resolve(process.execPath).toLowerCase();
  const entrypoint = require('node:path').join(__dirname, 'claudeAiMemoryMcpServer.js');
  const args = [...(useElectronNode ? ['--ms-enable-electron-run-as-node'] : []), entrypoint];
  const env = {
    ...(useElectronNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    ORCHESTRATOR_MEMORY_EXECUTABLE: memoryBridge.executable,
    ORCHESTRATOR_MEMORY_PROJECT_PATH: memoryBridge.projectPath,
    ORCHESTRATOR_MEMORY_DATA_DIRECTORY: memoryBridge.connection.dataDirectory,
    ORCHESTRATOR_MEMORY_CONFIG_PATH: memoryBridge.connection.configPath,
    ORCHESTRATOR_MEMORY_URL: memoryBridge.connection.url,
    ORCHESTRATOR_MEMORY_WORKSPACE: memoryBridge.scope.workspace,
    ORCHESTRATOR_MEMORY_PROJECT: memoryBridge.scope.project || '',
    ORCHESTRATOR_MEMORY_PROJECT_ID: memoryBridge.scope.projectId || '',
    ORCHESTRATOR_MEMORY_TASK_PATH: memoryBridge.taskPath,
    ORCHESTRATOR_MEMORY_AGENT_PATH: memoryBridge.agentPath,
    ORCHESTRATOR_MEMORY_TASK_MARKER: memoryBridge.taskMarker,
    ORCHESTRATOR_MEMORY_AGENT_MARKER: memoryBridge.agentMarker,
    ORCHESTRATOR_MEMORY_TASK_PAGE_ID: memoryBridge.taskPageId,
    ORCHESTRATOR_MEMORY_AGENT_PAGE_ID: memoryBridge.agentPageId || ''
  };
  const prefix = 'mcp_servers.orchestrator_memory';
  return [
    // A task must use only its verified, task-scoped memory bridge; do not
    // inherit unrelated MCP servers from the user's global Codex config.
    '-c', 'mcp_servers={}',
    '-c', `${prefix}.enabled=true`,
    '-c', `${prefix}.command=${tomlString(nodeExecutable)}`,
    '-c', `${prefix}.args=${tomlArray(args)}`,
    '-c', `${prefix}.cwd=${tomlString(memoryBridge.projectPath)}`,
    ...Object.entries(env).map(([key, value]) => ['-c', `${prefix}.env.${key}=${tomlString(value)}`]).flat()
  ];
}

class CodexAppServerSessions {
  constructor(options = {}) {
    this.spawn = options.spawn || cp.spawn;
    this.sessions = new Map();
  }

  async start(request) {
    if (!request?.executable) throw new Error('A CLI oficial do Codex não foi localizada.');
    if (!request?.cwd) throw new Error('O checkout da tarefa não foi informado.');
    const id = `orchestrator-codex-${randomUUID()}`;
    const child = this.spawn(request.executable, [...(request.prefixArgs || []), ...memoryConfigArgs(request.memoryBridge, request.nodeExecutable), 'app-server', '--listen', 'stdio://'], {
      cwd: request.cwd,
      env: request.env || process.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const session = {
      id, child, request, state: 'starting', threadId: '', turnId: '', result: '', error: '', progress: '', stderr: '',
      pending: new Map(), sequence: 0, buffer: '', exited: deferred(), completion: deferred(), cancellationRequested: false
    };
    this.sessions.set(id, session);
    this.attach(session);
    session.runPromise = this.run(session);
    session.runPromise.catch(() => {});
    const startupTimeoutMs = Number.isSafeInteger(request.startupTimeoutMs) && request.startupTimeoutMs > 0
      ? Math.min(request.startupTimeoutMs, 5 * 60 * 1000)
      : 90000;
    let startupTimer;
    try {
      await Promise.race([
        session.started.promise,
        session.completion.promise.then(() => {
          if (session.state !== 'answered') throw new Error(session.error || 'Codex terminou antes de iniciar a tarefa.');
        }),
        new Promise((resolve, reject) => {
          startupTimer = setTimeout(() => {
            const error = new Error(`Codex app-server não iniciou a tarefa em ${Math.round(startupTimeoutMs / 1000)} segundos.`);
            this.fail(session, error);
            child.kill();
            reject(error);
          }, startupTimeoutMs);
        })
      ]);
    } finally {
      clearTimeout(startupTimer);
    }
    return { id, sessionName: `Codex · ${request.title || 'Tarefa'}`, threadId: session.threadId, processId: child.pid };
  }

  attach(session) {
    const { child } = session;
    session.started = deferred();
    child.stdout.setEncoding('utf8').on('data', chunk => this.read(session, chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => {
      if (session.stderr.length < 12000) session.stderr += chunk.slice(0, 12000 - session.stderr.length);
    });
    child.on('error', error => this.fail(session, error));
    child.on('exit', (code, signal) => {
      session.exitCode = code;
      session.exitSignal = signal;
      session.exited.resolve({ code, signal });
      if (session.state === 'running' || session.state === 'starting') {
        this.fail(session, new Error(`Codex app-server encerrou antes de concluir (código ${code ?? 'n/a'}).`));
      }
    });
  }

  read(session, chunk) {
    session.buffer += chunk;
    if (Buffer.byteLength(session.buffer, 'utf8') > MAX_LINE_BYTES && !session.buffer.includes('\n')) {
      this.fail(session, new Error('Codex app-server excedeu o limite de uma mensagem JSON.'));
      session.child.kill();
      return;
    }
    let newline;
    while ((newline = session.buffer.indexOf('\n')) >= 0) {
      const line = session.buffer.slice(0, newline).trim();
      session.buffer = session.buffer.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        this.fail(session, new Error('Codex app-server excedeu o limite de uma mensagem JSON.'));
        session.child.kill();
        return;
      }
      let message;
      try { message = JSON.parse(line); }
      catch { this.fail(session, new Error('Codex app-server enviou uma mensagem JSON inválida.')); session.child.kill(); return; }
      void this.receive(session, message).catch(error => this.fail(session, error));
    }
  }

  send(session, value) {
    if (session.child.killed || session.child.stdin.destroyed) throw new Error('A conexão com Codex app-server foi encerrada.');
    session.child.stdin.write(JSON.stringify(value) + '\n');
  }

  async call(session, method, params) {
    const id = ++session.sequence;
    const wait = deferred();
    const timer = setTimeout(() => {
      session.pending.delete(id);
      wait.reject(new Error(`Codex app-server não respondeu a ${method} em ${REQUEST_TIMEOUT_MS / 1000} segundos.`));
    }, REQUEST_TIMEOUT_MS);
    session.pending.set(id, { ...wait, timer, method });
    try { this.send(session, { method, id, params }); }
    catch (error) { clearTimeout(timer); session.pending.delete(id); throw error; }
    return wait.promise;
  }

  async receive(session, message) {
    if (Object.hasOwn(message, 'id') && !message.method) {
      const pending = session.pending.get(message.id);
      if (!pending) return;
      session.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || `Codex app-server falhou em ${pending.method}.`));
      else pending.resolve(message.result);
      return;
    }
    if (Object.hasOwn(message, 'id') && message.method) {
      await this.handleServerRequest(session, message);
      return;
    }
    if (!message.method) return;
    const params = message.params || {};
    if (message.method === 'item/agentMessage/delta') {
      session.result += String(params.delta || '');
      session.progress = session.result.slice(-1200);
      await session.request.onEvent?.({ type: 'assistant-delta', content: String(params.delta || ''), threadId: params.threadId || session.threadId });
    } else if (message.method === 'item/started' || message.method === 'item/completed' || message.method === 'turn/plan/updated') {
      const event = lifecycleEvent(message.method, params, session.threadId);
      session.progress = event.summary;
      // Keep the journal useful for handoffs without copying commands, file contents,
      // tool arguments, output, or hidden reasoning from app-server items.
      await session.request.onEvent?.(event);
    } else if (message.method === 'turn/completed') {
      const status = params.turn?.status;
      if (status === 'completed') {
        session.state = 'answered';
        session.turnId = params.turn?.id || session.turnId;
        session.completion.resolve();
        const closeTimer = setTimeout(() => session.child.kill(), 250);
        closeTimer.unref?.();
      } else {
        const fallback = status === 'interrupted' ? 'A tarefa Codex foi interrompida.' : 'Codex não concluiu o turno com sucesso.';
        this.fail(session, new Error(failureMessage(session, fallback)));
      }
    } else if (message.method === 'error') {
      this.fail(session, new Error(safeDiagnostic(params.message) || failureMessage(session, 'Codex app-server reportou um erro.')));
    }
  }

  async handleServerRequest(session, message) {
    const method = message.method;
    let result;
    try {
      if (method === 'item/tool/requestUserInput') {
        const answers = typeof session.request.answerUserInput === 'function'
          ? await session.request.answerUserInput(message.params?.questions || [])
          : {};
        result = { answers: answers || {} };
      } else if (method === 'mcpServer/elicitation/request') {
        result = memoryToolElicitationResponse(message.params, session.request.memoryBridge);
        const elicitationMeta = message.params?._meta && typeof message.params._meta === 'object' ? message.params._meta : {};
        const toolDescription = typeof elicitationMeta.tool_description === 'string' ? elicitationMeta.tool_description : '';
        const describedTool = [...TASK_MEMORY_TOOL_DESCRIPTIONS].find(([, description]) => description === toolDescription)?.[0] || '';
        await session.request.onEvent?.({
          type: 'codex-mcp-tool-approval',
          serverName: String(message.params?.serverName || '').slice(0, 100),
          toolName: String(elicitationMeta.tool_name || elicitationMeta.toolName || describedTool).slice(0, 120),
          decision: result.action
        });
      }
      const allowed = result ? false : method !== 'item/permissions/requestApproval' && typeof session.request.approveRequest === 'function'
        ? await session.request.approveRequest({ method, params: message.params || {} })
        : false;
      if (result) {
        // The request was answered using the typed question response above.
      } else if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
        result = method === 'execCommandApproval'
          ? { decision: allowed ? 'approved' : { denied: { rejection: 'Denied by the Orchestrator user.' } } }
          : { decision: allowed ? 'accept' : 'decline' };
      } else if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
        result = method === 'applyPatchApproval'
          ? { decision: allowed ? 'approved' : { denied: { rejection: 'Denied by the Orchestrator user.' } } }
          : { decision: allowed ? 'accept' : 'decline' };
      } else if (method === 'item/permissions/requestApproval') {
        result = { permissions: {}, scope: 'turn' };
      } else {
        result = {};
      }
    } catch (error) {
      result = method === 'item/permissions/requestApproval'
        ? { permissions: {}, scope: 'turn' }
        : method === 'mcpServer/elicitation/request'
          ? { action: 'decline', content: null, _meta: null }
          : {};
      await session.request.onEvent?.({ type: 'approval-error', content: error.message || String(error) });
    }
    this.send(session, { id: message.id, result });
  }

  async run(session) {
    const { request } = session;
    try {
      await this.call(session, 'initialize', {
        clientInfo: { name: 'orchestrator_ai', title: 'Orchestrator-AI', version: request.version || '0.1.0' },
        capabilities: null
      });
      this.send(session, { method: 'initialized', params: {} });
      if (request.threadId) {
        const resumed = await this.call(session, 'thread/resume', {
          threadId: request.threadId, cwd: request.cwd,
          ...(request.model ? { model: request.model } : {}),
          approvalPolicy: 'on-request', sandbox: 'workspace-write'
        });
        session.threadId = resumed.thread.id;
      } else {
        const started = await this.call(session, 'thread/start', {
          cwd: request.cwd,
          ...(request.model ? { model: request.model } : {}),
          approvalPolicy: 'on-request', sandbox: 'workspace-write'
        });
        session.threadId = started.thread.id;
      }
      if (request.memoryBridge) await this.verifyMemoryBridge(session);
      session.state = 'running';
      const response = await this.call(session, 'turn/start', {
        threadId: session.threadId,
        input: [{ type: 'text', text: request.prompt, text_elements: [] }],
        cwd: request.cwd,
        approvalPolicy: 'on-request',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: [request.cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
        ...(request.model ? { model: request.model } : {}),
        ...(request.effort ? { effort: request.effort } : {})
      });
      session.turnId = response.turn?.id || '';
      session.started.resolve();
    } catch (error) {
      this.fail(session, error);
      session.started.reject(error);
      session.child.kill();
    }
  }

  async verifyMemoryBridge(session) {
    const deadline = Date.now() + 15000;
    let lastStatus;
    do {
      const result = await this.call(session, 'mcpServerStatus/list', {
        threadId: session.threadId,
        serverName: 'orchestrator_memory',
        detail: 'toolsAndAuthOnly'
      });
      const server = (result?.data || []).find(item => item.name === 'orchestrator_memory');
      lastStatus = server?.runtimeStatus || server?.toolsError || 'not available';
      const names = Object.keys(server?.tools || {});
      if (server?.runtimeStatus === 'connected' && names.includes('read_task_context') && names.includes('write_task_context')) return;
      if (server?.runtimeStatus === 'failed' || server?.runtimeStatus === 'disabled') break;
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    throw new Error(`A ponte MCP do AI Memory do Codex não foi confirmada (estado: ${lastStatus}). O turno não foi iniciado com memória compartilhada não verificada.`);
  }

  fail(session, error) {
    if (['answered', 'failed', 'stopped'].includes(session.state)) return;
    session.state = session.cancellationRequested ? 'stopped' : 'failed';
    session.error = error?.message || String(error);
    session.completion.resolve();
    for (const [id, pending] of session.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      session.pending.delete(id);
    }
  }

  poll(id) {
    const session = this.sessions.get(id);
    if (!session) return { status: 'unknown', code: 'SESSION_NOT_OWNED', error: 'Sessão Codex não está disponível neste host.' };
    if (session.state === 'starting' || session.state === 'running') return { status: 'pending', sessionState: session.state === 'starting' ? 'starting' : 'busy', sessionDetail: session.progress };
    if (session.state === 'answered') return { status: 'answered', result: session.result, sessionState: 'done', threadId: session.threadId, turnId: session.turnId };
    return { status: 'failed', stopped: session.state === 'stopped', error: session.error, sessionState: session.state };
  }

  async stop(id) {
    const session = this.sessions.get(id);
    if (!session) return { stopped: false, error: 'Sessão Codex não está disponível neste host.' };
    if (session.state === 'running') {
      session.cancellationRequested = true;
      try { await this.call(session, 'turn/interrupt', { threadId: session.threadId, turnId: session.turnId }); }
      catch { session.child.kill(); }
      if (session.state === 'stopped') return { stopped: true, sessionState: session.state };
      let timeout;
      const completed = await Promise.race([
        session.completion.promise.then(() => true),
        new Promise(resolve => { timeout = setTimeout(() => resolve(false), 5000); })
      ]);
      clearTimeout(timeout);
      if (!completed) session.child.kill();
      if (session.state === 'running') this.fail(session, new Error('Tarefa Codex interrompida pelo usuário.'));
    }
    return { stopped: session.state === 'stopped', sessionState: session.state };
  }

  activeSessions(projectRoot) {
    return [...this.sessions.values()].filter(session => ['starting', 'running'].includes(session.state) && session.request.cwd === projectRoot)
      .map(session => ({ id: session.id, projectPath: session.request.cwd, path: session.request.cwd, state: session.state === 'starting' ? 'starting' : 'busy', detail: session.progress, label: `Codex · ${session.request.title || 'Tarefa'}` }));
  }

  dispose() {
    for (const session of this.sessions.values()) {
      if (['starting', 'running'].includes(session.state)) session.child.kill();
    }
  }
}

module.exports = { CodexAppServerSessions, memoryConfigArgs, memoryToolElicitationResponse };

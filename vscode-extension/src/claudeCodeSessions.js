const cp = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClaudePermissionServer } = require('./claudePermissionServer');
const { pathIdentity } = require('./pathIdentity');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function safeText(value, max = 6000) {
  return String(value || '').replace(/\b(?:sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+)\b/g, '[credential redacted]').slice(0, max);
}

class ClaudeCodeSessions {
  constructor(options = {}) {
    this.spawn = options.spawn || cp.spawn;
    this.sessions = new Map();
  }

  async start(request) {
    if (!request.executable || !request.root || !request.prompt) throw new Error('A CLI Claude, checkout, and task prompt are required.');
    const id = `orchestrator-claude-${crypto.randomUUID()}`;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-claude-'));
    const approvals = await createClaudePermissionServer({ root: request.root, requestApproval: request.requestApproval });
    const configPath = path.join(directory, 'mcp.json');
    const nodeExecutable = request.nodeExecutable || process.execPath;
    const useElectronNode = Boolean(process.versions.electron) && pathIdentity(nodeExecutable) === pathIdentity(process.execPath);
    const config = {
      mcpServers: {
        orchestrator_permissions: {
          command: nodeExecutable,
          args: [...(useElectronNode ? ['--ms-enable-electron-run-as-node'] : []), path.join(__dirname, 'claudePermissionMcpServer.js')],
          env: { ...(useElectronNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}), ORCHESTRATOR_PERMISSION_URL: approvals.url, ORCHESTRATOR_PERMISSION_TOKEN: approvals.token }
        }
      }
    };
    if (request.memoryBridge?.executable && request.memoryBridge.connection?.url) {
      config.mcpServers.orchestrator_memory = {
        command: nodeExecutable,
        args: [...(useElectronNode ? ['--ms-enable-electron-run-as-node'] : []), path.join(__dirname, 'claudeAiMemoryMcpServer.js')],
        env: {
          ...(useElectronNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
          ORCHESTRATOR_MEMORY_EXECUTABLE: request.memoryBridge.executable,
          ORCHESTRATOR_MEMORY_PROJECT_PATH: request.memoryBridge.projectPath,
          ORCHESTRATOR_MEMORY_DATA_DIRECTORY: request.memoryBridge.connection.dataDirectory,
          ORCHESTRATOR_MEMORY_CONFIG_PATH: request.memoryBridge.connection.configPath,
          ORCHESTRATOR_MEMORY_URL: request.memoryBridge.connection.url,
          ORCHESTRATOR_MEMORY_WORKSPACE: request.memoryBridge.scope.workspace,
          ORCHESTRATOR_MEMORY_PROJECT: request.memoryBridge.scope.project || '',
          ORCHESTRATOR_MEMORY_PROJECT_ID: request.memoryBridge.scope.projectId || '',
          ORCHESTRATOR_MEMORY_TASK_PATH: request.memoryBridge.taskPath,
          ORCHESTRATOR_MEMORY_AGENT_PATH: request.memoryBridge.agentPath,
          ORCHESTRATOR_MEMORY_TASK_MARKER: request.memoryBridge.taskMarker,
          ORCHESTRATOR_MEMORY_AGENT_MARKER: request.memoryBridge.agentMarker,
          ORCHESTRATOR_MEMORY_TASK_PAGE_ID: request.memoryBridge.taskPageId,
          ORCHESTRATOR_MEMORY_AGENT_PAGE_ID: request.memoryBridge.agentPageId || ''
        }
      };
    }
    await fs.writeFile(configPath, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
    const args = [
      ...(request.prefixArgs || []), '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', 'Read,Edit,Write,Glob,Grep,Bash',
      ...(request.memoryBridge ? [
        '--allowedTools',
        'mcp__orchestrator_memory__read_task_context',
        'mcp__orchestrator_memory__write_task_context'
      ] : []),
      '--strict-mcp-config', '--mcp-config', configPath,
      '--permission-prompt-tool', 'mcp__orchestrator_permissions__prompt',
      '--permission-mode', 'default',
      ...(request.model ? ['--model', request.model] : []),
      ...(request.effort ? ['--effort', request.effort] : []),
      ...(request.sessionId ? ['--resume', request.sessionId] : [])
    ];
    const env = { ...process.env, ...(request.env || {}) };
    if (useElectronNode) env.ELECTRON_RUN_AS_NODE = '1';
    else delete env.ELECTRON_RUN_AS_NODE;
    let child;
    try {
      child = this.spawn(request.executable, args, { cwd: request.root, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      await approvals.close().catch(() => {});
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const session = {
      id, child, directory, approvals, state: 'running', result: '', error: '', progress: '', stderr: '',
      providerSessionId: request.sessionId || '', model: request.model, effort: request.effort || '',
      startedAt: Date.now(), started: deferred(), completion: deferred(), buffer: '', request
    };
    this.sessions.set(id, session);
    child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: request.prompt }] } }) + '\n');
    child.stdout.setEncoding('utf8').on('data', chunk => this.read(session, chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => {
      session.stderr = safeText(session.stderr + chunk, 12000);
      session.updatedAt = Date.now();
    });
    child.on('error', error => this.finish(session, 'failed', String(error.message || error)));
    child.on('close', (code, signal) => {
      if (['running', 'stopping'].includes(session.state)) {
        if (session.state === 'stopping') {
          this.finish(session, 'stopped', 'Tarefa interrompida no Orchestrator.');
          return;
        }
        const detail = session.stderr.trim() || `Claude Code terminou sem evento final (código ${code ?? 'n/a'}${signal ? `, sinal ${signal}` : ''}).`;
        this.finish(session, code === 0 && session.result ? 'answered' : 'failed', code === 0 && session.result ? '' : detail);
      }
    });
    let startupTimer;
    await Promise.race([session.started.promise, new Promise(resolve => { startupTimer = setTimeout(resolve, 8000); })]);
    clearTimeout(startupTimer);
    return { id, sessionName: `Claude · ${request.title || 'Tarefa'}`, state: session.state, startedAt: session.startedAt, providerSessionId: session.providerSessionId, processId: child.pid };
  }

  read(session, chunk) {
    session.buffer += chunk;
    while (true) {
      const newline = session.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = session.buffer.slice(0, newline).trim();
      session.buffer = session.buffer.slice(newline + 1);
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      session.updatedAt = Date.now();
      if (typeof event.session_id === 'string') {
        session.providerSessionId = event.session_id;
        session.started.resolve();
      }
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const part of event.message.content) {
          if (part.type === 'text' && part.text) {
            const text = safeText(part.text);
            session.progress = text.slice(-1000);
            this.record(session, { type: 'assistant-message', actor: 'claude', content: text });
          } else if (part.type === 'tool_use') {
            session.progress = `Claude usando ${String(part.name || 'ferramenta').slice(0, 80)}`;
            this.record(session, { type: 'tool-call', actor: 'claude', toolName: String(part.name || '').slice(0, 120), summary: safeText(JSON.stringify(part.input || {}), 1000) });
          }
        }
      }
      if (event.type === 'stream_event') {
        const delta = event.event?.delta?.text;
        if (typeof delta === 'string' && delta) session.progress = safeText(session.progress + delta, 1000);
      }
      if (event.type === 'result') {
        if (typeof event.session_id === 'string') session.providerSessionId = event.session_id;
        if (event.is_error || String(event.subtype || '').startsWith('error')) this.finish(session, 'failed', safeText(event.result || 'Claude Code informou erro.'), event);
        else this.finish(session, 'answered', '', event);
      }
      this.record(session, { type: 'provider-event', actor: 'claude', providerSessionId: session.providerSessionId, summary: safeText(JSON.stringify({ type: event.type, subtype: event.subtype, session_id: event.session_id, tool_use_id: event.tool_use_id, cost_usd: event.total_cost_usd }), 1000) });
    }
  }

  record(session, event) {
    try {
      Promise.resolve(session.request.onEvent?.(event)).catch(error => { session.journalError = safeText(error.message || error, 500); });
    } catch (error) { session.journalError = safeText(error.message || error, 500); }
  }

  finish(session, state, error = '', resultEvent = undefined) {
    if (!['running', 'stopping'].includes(session.state)) return;
    session.state = state;
    session.error = safeText(error, 3000);
    session.result = state === 'answered' ? safeText(resultEvent?.result || '', 24000) : '';
    if (typeof resultEvent?.session_id === 'string') session.providerSessionId = resultEvent.session_id;
    session.completion.resolve();
    session.started.resolve();
    void this.cleanup(session);
  }

  async cleanup(session) {
    await session.approvals.close().catch(() => {});
    await fs.rm(session.directory, { recursive: true, force: true }).catch(() => {});
  }

  poll(id) {
    const session = this.sessions.get(id);
    if (!session) return { status: 'unknown', code: 'SESSION_NOT_OWNED', error: 'A sessão Claude pertence a outro host ou não está disponível.' };
    if (session.state === 'running') return { status: 'pending', sessionState: 'busy', sessionDetail: session.progress, providerSessionId: session.providerSessionId };
    if (session.state === 'answered') return { status: 'answered', result: session.result, sessionState: 'done', providerSessionId: session.providerSessionId, model: session.model, effort: session.effort };
    return { status: 'failed', stopped: session.state === 'stopped', error: session.error || 'A sessão Claude falhou.', sessionState: session.state, providerSessionId: session.providerSessionId };
  }

  async stop(id) {
    const session = this.sessions.get(id);
    if (!session) return { stopped: false, error: 'Sessão Claude indisponível neste host.' };
    if (session.state === 'running') {
      session.state = 'stopping';
      session.child.kill();
      await session.completion.promise;
      if (session.state === 'failed') session.state = 'stopped';
      await this.cleanup(session);
    }
    return { stopped: session.state === 'stopped', sessionState: session.state };
  }

  activeSessions(root) {
    const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    const target = normalize(root);
    return [...this.sessions.values()].filter(session => ['running', 'stopping'].includes(session.state) && normalize(session.request.root) === target)
      .map(session => ({ id: session.id, projectPath: session.request.root, path: session.request.root, state: session.state === 'stopping' ? 'stopping' : 'busy', detail: session.progress, label: session.request.title || 'Claude Code' }));
  }

  dispose() {
    for (const session of this.sessions.values()) if (session.state === 'running') session.child.kill();
  }
}

module.exports = { ClaudeCodeSessions };

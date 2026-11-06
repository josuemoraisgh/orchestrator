const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

class OrchestratorSettingsView {
  constructor(context, actions) {
    this.context = context;
    this.actions = actions;
    this.view = undefined;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(message => this.onMessage(message));
    void this.refresh();
  }

  async getState() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return { workspace: '', hasWorkspace: false, aiExists: false, config: defaultConfig(), tools: {} };
    const root = folder.uri.fsPath;
    const aiPath = path.join(root, '.ai');
    let aiExists = false;
    let aiIsDirectory = false;
    try {
      const stat = await fs.stat(aiPath);
      aiExists = true;
      aiIsDirectory = stat.isDirectory();
    } catch { /* .ai is absent. */ }

    let config = defaultConfig();
    if (aiIsDirectory) {
      try { config = { ...defaultConfig(), ...JSON.parse(await fs.readFile(path.join(aiPath, 'orchestrator.json'), 'utf8')) }; }
      catch (error) { if (error.code !== 'ENOENT') config = { ...config, configError: error.message }; }
    }
    return {
      workspace: root,
      hasWorkspace: true,
      aiExists,
      aiIsDirectory,
      config,
      tools: config.tools || {}
    };
  }

  async refresh() {
    if (this.view) await this.view.webview.postMessage({ type: 'state', state: await this.getState() });
  }

  async onMessage(message) {
    try {
      if (message.type === 'load') return await this.refresh();
      if (message.type === 'save') {
        await this.actions.saveSettings(message.settings);
        await this.refresh();
        return this.send({ type: 'notice', level: 'success', text: 'Configurações salvas.' });
      }
      if (message.type === 'initialize') {
        const outcome = await this.actions.initializeWorkspace();
        await this.refresh();
        return this.send({ type: 'notice', level: outcome.created ? 'success' : 'info', text: outcome.message });
      }
      if (message.type === 'checkTools') {
        const text = await this.actions.checkTools();
        return this.send({ type: 'notice', level: 'info', text });
      }
      if (message.type === 'installDependencies') {
        const choice = await vscode.window.showWarningMessage(
          'Instalar/atualizar lich e ai-memory e configurar a integração do ai-memory para este usuário?',
          { modal: true }, 'Instalar'
        );
        if (choice !== 'Instalar') return;
        const text = await this.actions.installDependencies();
        await this.refresh();
        return this.send({ type: 'notice', level: 'success', text });
      }
      if (message.type === 'openChat') {
        await vscode.commands.executeCommand('productionOrchestrator.openChat');
      }
    } catch (error) {
      this.send({ type: 'notice', level: 'error', text: error.message || String(error) });
    }
  }

  send(message) {
    return this.view?.webview.postMessage(message);
  }

  html(webview) {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orquestrador</title>
  <style>
    :root { color-scheme: light dark; }
    body { padding: 0 14px 18px; color: var(--vscode-foreground); font: var(--vscode-font-weight) var(--vscode-font-size)/1.5 var(--vscode-font-family); }
    h2 { margin: 15px 0 5px; font-size: 1.15em; }
    h3 { margin: 18px 0 8px; font-size: 1em; }
    p { color: var(--vscode-descriptionForeground); }
    label { display: block; margin: 10px 0 4px; font-size: 0.92em; }
    input, textarea { box-sizing: border-box; width: 100%; padding: 6px 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
    textarea { min-height: 70px; resize: vertical; }
    button { margin: 8px 5px 0 0; padding: 6px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:disabled { opacity: .55; cursor: default; }
    .section { margin: 14px 0; padding: 0 0 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    .path { overflow-wrap: anywhere; font-size: .85em; }
    .status { margin: 8px 0; padding: 7px 9px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--vscode-textBlockQuote-background); }
    .status.error { color: var(--vscode-errorForeground); }
    .status.success { color: var(--vscode-testing-iconPassed); }
    .upstream { margin: 10px 0; padding: 9px; border: 1px solid var(--vscode-panel-border); }
    .upstream button { margin-top: 6px; }
    .hint { font-size: .83em; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <h2>Orquestrador</h2>
  <p id="workspace" class="path">Abrindo projeto…</p>

  <section class="section">
    <h3>Projeto</h3>
    <p id="aiStatus">Verificando a pasta .ai…</p>
    <button id="initialize">Preparar projeto (.ai)</button>
    <p class="hint">Cria specs, skills e a configuração inicial somente quando .ai ainda não existe.</p>
  </section>

  <section class="section">
    <h3>Build</h3>
    <label for="buildCommand">Comando</label>
    <input id="buildCommand" placeholder="npm">
    <label for="buildArgs">Argumentos — um por linha</label>
    <textarea id="buildArgs" placeholder="run\nbuild"></textarea>
    <label for="buildCwd">Pasta de execução, relativa ao projeto</label>
    <input id="buildCwd" value=".">
    <label for="buildTimeout">Tempo limite (segundos)</label>
    <input id="buildTimeout" type="number" min="1" value="1800">
  </section>

  <section class="section">
    <h3>Fontes upstream</h3>
    <p class="hint">Essas fontes serão atualizadas por fast-forward antes do build. Árvores sujas ou divergentes interrompem o processo.</p>
    <div id="upstreams"></div>
    <button id="addUpstream" class="secondary">Adicionar upstream</button>
  </section>

  <section class="section">
    <h3>Ferramentas</h3>
    <label for="lichCommand">Executável lich (opcional)</label>
    <input id="lichCommand" placeholder="lich">
    <label for="aiMemoryCommand">Executável ai-memory (opcional)</label>
    <input id="aiMemoryCommand" placeholder="ai-memory">
    <button id="checkTools" class="secondary">Verificar ferramentas</button>
    <button id="installDependencies" class="secondary">Instalar / atualizar lich e ai-memory</button>
  </section>

  <button id="save">Salvar configurações</button>
  <button id="openChat" class="secondary">Abrir Orquestrador no Chat</button>
  <div id="notice" class="status" hidden></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const byId = id => document.getElementById(id);
    let state;
    function showNotice(message) {
      const box = byId('notice');
      box.hidden = false;
      box.textContent = message.text || '';
      box.className = 'status ' + (message.level || 'info');
    }
    function addUpstream(item = {}) {
      const row = document.createElement('div');
      row.className = 'upstream';
      for (const [key, label, placeholder] of [
        ['path', 'Pasta relativa', 'vendor/source'],
        ['remote', 'Remote Git', 'origin'],
        ['branch', 'Branch', 'main']
      ]) {
        const caption = document.createElement('label');
        caption.textContent = label;
        const input = document.createElement('input');
        input.dataset.field = key;
        input.value = item[key] || '';
        input.placeholder = placeholder;
        row.append(caption, input);
      }
      const remove = document.createElement('button');
      remove.textContent = 'Remover';
      remove.className = 'secondary';
      remove.addEventListener('click', () => row.remove());
      row.append(remove);
      byId('upstreams').append(row);
    }
    function load(stateValue) {
      state = stateValue;
      byId('workspace').textContent = state.hasWorkspace ? state.workspace : 'Abra uma pasta de projeto para configurar o Orquestrador.';
      byId('aiStatus').textContent = state.aiExists
        ? state.aiIsDirectory ? '.ai já existe. A preparação não alterará esta pasta.' : 'Existe um item chamado .ai que não é pasta. Nada será alterado.'
        : 'A pasta .ai ainda não existe.';
      if (state.config?.configError) showNotice({ level: 'error', text: `Não foi possível ler .ai/orchestrator.json: ${state.config.configError}` });
      byId('initialize').disabled = !state.hasWorkspace || state.aiExists;
      byId('save').disabled = !state.hasWorkspace || !state.aiIsDirectory;
      const config = state.config || {};
      const build = config.build || {};
      byId('buildCommand').value = build.command || '';
      byId('buildArgs').value = Array.isArray(build.args) ? build.args.join('\\n') : '';
      byId('buildCwd').value = build.cwd || '.';
      byId('buildTimeout').value = Math.max(1, Math.round((build.timeoutMs || 1800000) / 1000));
      byId('lichCommand').value = state.tools.lichCommand || 'lich';
      byId('aiMemoryCommand').value = state.tools.aiMemoryCommand || 'ai-memory';
      byId('upstreams').replaceChildren();
      for (const item of config.upstreams || []) addUpstream(item);
    }
    byId('addUpstream').addEventListener('click', () => addUpstream());
    byId('initialize').addEventListener('click', () => vscode.postMessage({ type: 'initialize' }));
    byId('checkTools').addEventListener('click', () => vscode.postMessage({ type: 'checkTools' }));
    byId('installDependencies').addEventListener('click', () => vscode.postMessage({ type: 'installDependencies' }));
    byId('openChat').addEventListener('click', () => vscode.postMessage({ type: 'openChat' }));
    byId('save').addEventListener('click', () => {
      const command = byId('buildCommand').value.trim();
      const args = byId('buildArgs').value.split('\\n').map(value => value.trim()).filter(Boolean);
      const upstreams = [...byId('upstreams').querySelectorAll('.upstream')].map(row => Object.fromEntries(
        [...row.querySelectorAll('input')].map(input => [input.dataset.field, input.value.trim()])
      )).filter(item => item.path || item.remote || item.branch);
      vscode.postMessage({ type: 'save', settings: {
        build: command ? { command, args, cwd: byId('buildCwd').value.trim() || '.', timeoutMs: Math.max(1, Number(byId('buildTimeout').value) || 1800) * 1000 } : null,
        upstreams,
        tools: { lichCommand: byId('lichCommand').value.trim(), aiMemoryCommand: byId('aiMemoryCommand').value.trim() }
      }});
    });
    window.addEventListener('message', event => {
      if (event.data.type === 'state') load(event.data.state);
      if (event.data.type === 'notice') showNotice(event.data);
    });
    vscode.postMessage({ type: 'load' });
  </script>
</body>
</html>`;
  }
}

function defaultConfig() {
  return { build: null, upstreams: [] };
}

module.exports = { OrchestratorSettingsView };

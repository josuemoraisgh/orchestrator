const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWebviewSecurity } = require('./webviewSecurity');

class OrchestratorSettingsView {
  constructor(context, actions) {
    this.context = context;
    this.actions = actions;
    this.panel = undefined;
    this.authStatuses = {};
    this.loadedKnowledgePages = new Map();
    this.workspaceGeneration = 0;
    this.modelListener = vscode.lm.onDidChangeChatModels(() => {
      void this.refreshProviders();
    });
    this.modelAccessListener = vscode.lm.accessInformation?.onDidChange?.(() => {
      void this.refreshProviders();
    });
    this.trustListener = vscode.workspace.onDidGrantWorkspaceTrust?.(() => { void this.refresh(); });
    this.workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders?.(() => this.onWorkspaceChanged());
  }

  async openPanel() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      await this.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'orchestratorAi.settings',
      'Orquestrador: Configurações',
      vscode.ViewColumn.Beside,
      { enableScripts: false, retainContextWhenHidden: true }
    );
    this.panel = panel;
    // Apply the CSP-bearing document before enabling scripts for this panel.
    panel.webview.html = this.html(panel.webview);
    panel.webview.options = { enableScripts: true };
    panel.webview.onDidReceiveMessage(message => this.onMessage(message));
    panel.onDidDispose(() => { if (this.panel === panel) this.panel = undefined; });
    void this.refresh();
  }

  dispose() {
    this.modelListener?.dispose();
    this.modelAccessListener?.dispose();
    this.trustListener?.dispose();
    this.workspaceListener?.dispose();
    this.panel?.dispose();
  }

  onWorkspaceChanged() {
    this.workspaceGeneration++;
    this.loadedKnowledgePages.clear();
    void this.refresh();
  }

  async getState() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return {
      workspace: '', hasWorkspace: false, workspaceTrusted: vscode.workspace.isTrusted, aiExists: false, config: defaultConfig(), tools: {},
      options: await this.actions.listOptions(),
      releaseVersions: this.actions.getReleaseVersions ? await this.actions.getReleaseVersions().catch(() => ({})) : {}
    };
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
      workspaceTrusted: vscode.workspace.isTrusted,
      aiExists,
      aiIsDirectory,
      config,
      tools: config.tools || {},
      releaseVersions: this.actions.getReleaseVersions ? await this.actions.getReleaseVersions().catch(() => ({})) : {},
      authStatuses: this.authStatuses,
      coordinatorProfiles: this.actions.listCoordinatorProfiles ? await this.actions.listCoordinatorProfiles() : [],
      memoryScope: await this.actions.resolveMemoryScope(root, config).catch(error => ({ workspace: '', project: '', source: error.message })),
      options: await this.actions.listOptions()
    };
  }

  async refresh() {
    const panel = this.panel;
    if (!panel) return;
    let timer;
    try {
      const state = await Promise.race([
        this.getState(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('A leitura das configurações excedeu 15 segundos. Reabra Configurações para tentar novamente.')), 15000);
        })
      ]);
      if (this.panel === panel) await panel.webview.postMessage({ type: 'state', state });
    } catch (error) {
      if (this.panel === panel) await panel.webview.postMessage({
        type: 'stateError',
        workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        text: error.message || String(error)
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async refreshProviders() {
    const panel = this.panel;
    if (!panel) return;
    try {
      const options = await this.actions.listOptions();
      if (this.panel === panel) await panel.webview.postMessage({ type: 'providers', options });
    } catch (error) {
      if (this.panel === panel) await panel.webview.postMessage({ type: 'providerError', text: error.message || String(error) });
    }
  }

  async onMessage(message) {
    try {
      if (message.type === 'load') return await this.refresh();
      if (message.type === 'listCoordinatorModels') {
        const profileId = String(message.profileId || '');
        const result = this.actions.listCoordinatorModels
          ? await this.actions.listCoordinatorModels(profileId)
          : { models: [], status: 'unavailable', message: 'Model catalog unavailable.' };
        return this.send({ type: 'coordinatorModels', profileId, requestId: message.requestId, ...result });
      }
      if (!vscode.workspace.isTrusted && ['loadKnowledgeSearchFilters', 'searchKnowledge', 'createKnowledgePage', 'loadKnowledgePage', 'patchKnowledgePage', 'updateKnowledgeMetadata'].includes(message.type)) {
        throw new Error('Confie neste workspace para acessar a memória durável do projeto.');
      }
      if (!vscode.workspace.isTrusted && ['save', 'connectProvider', 'connectWorkerProvider', 'createCoordinatorProfile', 'connectCoordinatorProfile', 'authorizeCoordinatorProfile', 'setCoordinatorProfileConcurrency', 'renameCoordinatorProfile', 'removeCoordinatorProfile', 'initialize', 'installDependencies'].includes(message.type)) {
        throw new Error('Confie neste workspace no VS Code para alterar configurações do projeto, autenticar perfis ou instalar ferramentas.');
      }
      if (message.type === 'loadKnowledgeSearchFilters') {
        const result = await this.actions.knowledgeSearchCapabilities();
        return this.send({ type: 'knowledgeSearchFilters', filters: result.filters || [], limit: result.limit || null });
      }
      if (message.type === 'searchKnowledge') {
        const result = await this.actions.searchKnowledge(String(message.query || ''), message.filters || {}, message.limit);
        return this.send({ type: 'knowledgeSearchResult', requestId: message.requestId, scope: result.scope, text: result.text, limit: result.limit, filters: result.appliedFilters || [] });
      }
      if (message.type === 'createKnowledgePage') {
        const result = await this.actions.createKnowledgePage({
          path: message.path, body: message.body, tags: String(message.tags || '').split(','),
          tier: String(message.tier || ''), pinned: message.pinned === true,
          kind: String(message.kind || ''), sourceFiles: String(message.sourceFiles || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
        });
        await this.refresh();
        return this.send({ type: 'knowledgePageCreated', path: result.page.path, pageId: result.page.pageId, scope: result.scope });
      }
      if (message.type === 'loadKnowledgePage') {
        const workspaceGeneration = this.workspaceGeneration || 0;
        const result = await this.actions.loadKnowledgePage(String(message.path || ''));
        if (workspaceGeneration !== (this.workspaceGeneration || 0)) {
          throw new Error('O projeto mudou durante o carregamento da página. Carregue-a novamente no workspace atual.');
        }
        const pageToken = crypto.randomUUID();
        this.loadedKnowledgePages.set(pageToken, result);
        while (this.loadedKnowledgePages.size > 20) this.loadedKnowledgePages.delete(this.loadedKnowledgePages.keys().next().value);
        return this.send({ type: 'knowledgePageLoaded', requestId: message.requestId, pageToken, scope: result.scope, page: result.page });
      }
      if (message.type === 'patchKnowledgePage') {
        const pageToken = String(message.pageToken || '');
        const loaded = this.loadedKnowledgePages.get(pageToken);
        if (!loaded) throw new Error('A página carregada expirou. Carregue-a novamente antes de editar.');
        try {
          const result = await this.actions.patchKnowledgePage(loaded, message.edit || {});
          const nextToken = crypto.randomUUID();
          this.loadedKnowledgePages.set(nextToken, result);
          await this.refresh();
          return this.send({ type: 'knowledgePagePatched', pageToken: nextToken, scope: result.scope, page: result.page });
        } finally { this.loadedKnowledgePages.delete(pageToken); }
      }
      if (message.type === 'updateKnowledgeMetadata') {
        const pageToken = String(message.pageToken || '');
        const loaded = this.loadedKnowledgePages.get(pageToken);
        if (!loaded) throw new Error('A página carregada expirou. Carregue-a novamente antes de editar.');
        try {
          const changes = message.changes && typeof message.changes === 'object' ? message.changes : {};
          const result = await this.actions.updateKnowledgeMetadata(loaded, changes);
          const nextToken = crypto.randomUUID();
          this.loadedKnowledgePages.set(nextToken, result);
          await this.refresh();
          return this.send({ type: 'knowledgeMetadataUpdated', pageToken: nextToken, scope: result.scope, page: result.page });
        } finally { this.loadedKnowledgePages.delete(pageToken); }
      }
      if (message.type === 'save') {
        await this.actions.saveSettings(message.settings);
        await this.refresh();
        return this.send({ type: 'notice', level: 'success', text: 'Configurações salvas. O perfil Orquestrador Configurado foi atualizado em .github/agents/.' });
      }
      if (message.type === 'connectProvider') {
        const text = await this.actions.connectProvider(message.providerId);
        await this.refresh();
        return this.send({ type: 'notice', level: 'info', text });
      }
      if (message.type === 'connectWorkerProvider') {
        const providerId = String(message.providerId || '');
        const text = await this.actions.connectProvider(providerId);
        this.authStatuses[providerId] = { status: 'unverified', text: 'Fluxo aberto; verifique a autenticação da CLI.' };
        await this.refresh();
        return this.send({ type: 'notice', level: 'info', text });
      }
      if (message.type === 'checkWorkerAuthentication') {
        const providerId = String(message.providerId || '');
        const result = await this.actions.checkProviderAuthentication(providerId);
        this.authStatuses[providerId] = result;
        await this.refresh();
        return this.send({ type: 'notice', level: result.status === 'verified' ? 'success' : 'info', text: result.text });
      }
      if (message.type === 'createCoordinatorProfile') {
        const providerId = String(message.providerId || '');
        const name = await vscode.window.showInputBox({ prompt: 'Nome reconhecível para este perfil de coordenador', placeHolder: providerId === 'claude' ? 'Claude pessoal' : 'Codex trabalho', validateInput: value => String(value || '').trim() ? undefined : 'Informe um nome.' });
        if (!name) return;
        const profile = await this.actions.createCoordinatorProfile(providerId, name, Boolean(message.isolated));
        await this.refresh();
        return this.send({ type: 'notice', level: 'success', text: `Perfil “${profile.name}” adicionado. Use “Login oficial” para autenticar este perfil.` });
      }
      if (message.type === 'connectCoordinatorProfile') {
        const text = await this.actions.connectCoordinatorProfile(String(message.profileId || ''));
        return this.send({ type: 'notice', level: 'info', text });
      }
      if (message.type === 'checkCoordinatorProfile') {
        const profileId = String(message.profileId || '');
        this.authStatuses[`profile:${profileId}`] = await this.actions.checkCoordinatorProfile(profileId);
        await this.refresh();
        return this.send({ type: 'notice', level: this.authStatuses[`profile:${profileId}`].status === 'verified' ? 'success' : 'info', text: this.authStatuses[`profile:${profileId}`].text });
      }
      if (message.type === 'authorizeCoordinatorProfile') {
        await this.actions.updateCoordinatorProfile(String(message.profileId || ''), { authorized: Boolean(message.authorized) });
        await this.refresh();
        return;
      }
      if (message.type === 'setCoordinatorProfileConcurrency') {
        await this.actions.updateCoordinatorProfile(String(message.profileId || ''), { maxParallel: Number(message.maxParallel) });
        await this.refresh();
        return;
      }
      if (message.type === 'renameCoordinatorProfile') {
        const current = (await this.actions.listCoordinatorProfiles()).find(item => item.id === String(message.profileId || ''));
        if (!current) throw new Error('Perfil do coordenador não encontrado.');
        const name = await vscode.window.showInputBox({ value: current.name, prompt: 'Renomear perfil do coordenador', validateInput: value => String(value || '').trim() ? undefined : 'Informe um nome.' });
        if (!name) return;
        await this.actions.updateCoordinatorProfile(current.id, { name });
        await this.refresh();
        return;
      }
      if (message.type === 'removeCoordinatorProfile') {
        const choice = await vscode.window.showWarningMessage('Remover este perfil do Orquestrador? Os dados de autenticação da CLI serão preservados na pasta de armazenamento do perfil.', { modal: true }, 'Remover');
        if (choice !== 'Remover') return;
        await this.actions.removeCoordinatorProfile(String(message.profileId || ''));
        await this.refresh();
        return this.send({ type: 'notice', level: 'info', text: 'Perfil removido da lista. Os dados locais de autenticação foram preservados.' });
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
          'Instalar ou iniciar o runtime privado do AI Memory? O adaptador de compatibilidade Lich é opcional e não será instalado.',
          { modal: true }, 'Instalar / iniciar'
        );
        if (choice !== 'Instalar / iniciar') return;
        const text = await this.actions.installDependencies();
        await this.refresh();
        return this.send({ type: 'notice', level: 'success', text });
      }
    } catch (error) {
      if (['loadKnowledgeSearchFilters', 'searchKnowledge', 'createKnowledgePage', 'loadKnowledgePage', 'patchKnowledgePage', 'updateKnowledgeMetadata'].includes(message?.type)) {
        await this.send({ type: 'knowledgeOperationError', operation: message.type, requestId: message.requestId, text: error.message || String(error) });
      }
      this.send({ type: 'notice', level: 'error', text: error.message || String(error) });
    }
  }

  send(message) {
    return this.panel?.webview.postMessage(message);
  }

  html(webview) {
    const { nonce, csp } = createWebviewSecurity(webview);
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orquestrador</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body { padding: 0 14px 18px; color: var(--vscode-foreground); font: var(--vscode-font-weight) var(--vscode-font-size)/1.5 var(--vscode-font-family); }
    h2 { margin: 15px 0 5px; font-size: 1.15em; }
    h3 { margin: 18px 0 8px; font-size: 1em; }
    p { color: var(--vscode-descriptionForeground); }
    label { display: block; margin: 10px 0 4px; font-size: 0.92em; }
    input, textarea { box-sizing: border-box; width: 100%; padding: 6px 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
    textarea { min-height: 70px; resize: vertical; }
    input[type="checkbox"] { width: auto; }
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
    select { box-sizing: border-box; width: 100%; padding: 6px 8px; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border, transparent); }
    .agent-list { max-height: 210px; overflow: auto; border: 1px solid var(--vscode-panel-border); padding: 4px 8px; }
    .agent-option { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 7px; align-items: start; padding: 5px 0; border-bottom: 1px solid var(--vscode-panel-border); }
    .agent-option:last-child { border-bottom: 0; }
    .agent-option input { width: auto; margin-top: 4px; }
    .profile-concurrency { display: grid; gap: 2px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .profile-concurrency input { width: 54px; }
    #allowedWorkers .agent-option { grid-template-columns: auto minmax(0, 1fr); }
    .agent-name { font-weight: 600; }
    .agent-meta { display: block; color: var(--vscode-descriptionForeground); font-size: .82em; overflow-wrap: anywhere; }
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
    <h3>Provedor do Orquestrador</h3>
    <p class="hint">Use um modelo publicado pela API do VS Code ou um perfil local da CLI Claude/Codex. Os chats de outras extensões continuam independentes; credenciais privadas deles não são copiadas.</p>
    <label for="orchestratorProvider">Agente / provedor</label>
    <select id="orchestratorProvider"></select>
    <p id="providerStatus" class="hint"></p>
    <button id="connectProvider" class="secondary">Conectar / abrir login</button>
    <div id="cliProfileSettings" hidden>
      <label for="coordinatorProfileProvider">Provedor do perfil CLI</label>
      <select id="coordinatorProfileProvider"></select>
      <div><button id="addExistingCoordinatorProfile" class="secondary">Adicionar login CLI existente</button><button id="addIsolatedCoordinatorProfile" class="secondary">Adicionar perfil isolado</button></div>
      <p class="hint">Login existente usa a configuração atual da CLI. Perfis Claude isolados usam diretórios separados, confirmados pelo caminho reportado pela CLI. Perfis Codex usam CODEX_HOME e o armazenamento oficial file, separado por auth.json do perfil; esse arquivo é mantido pela CLI, e não criptografado pelo Orquestrador.</p>
      <div id="coordinatorProfiles" class="agent-list"></div>
      <label for="coordinatorProfile">Perfil ativo do coordenador</label>
      <select id="coordinatorProfile"></select>
      <label for="orchestratorEffort">Esforço do coordenador</label>
      <select id="orchestratorEffort"><option value="">Padrão do agente</option><option value="low">Baixo</option><option value="medium">Médio</option><option value="high">Alto</option><option value="xhigh">Extra alto</option><option value="max">Máximo</option></select>
      <p id="workerCompatibilityStatus" class="hint">O perfil selecionado é usado pelo coordenador. Perfis Codex autorizados também podem ser escolhidos por tarefa executada pelo Codex app-server; outros workers usam os mecanismos próprios do executor listado.</p>
    </div>
    <label for="orchestratorModel">Modelo padrão</label>
    <input id="orchestratorModel" list="orchestratorModels" placeholder="Escolha um modelo disponível ou informe o ID">
    <datalist id="orchestratorModels"></datalist>
    <p id="coordinatorModelStatus" class="hint"></p>
    <p class="hint">Para um provedor VS Code, escolha um modelo publicado na lista. Para Claude/Codex CLI, informe o ID de modelo aceito pela CLI; o esforço aparece acima. A autenticação CLI é verificada antes de cada solicitação.</p>
    <label for="workerProvider">Agente trabalhador padrão</label>
    <select id="workerProvider"></select>
    <div>
      <button id="checkWorkerAuth" class="secondary">Verificar autenticação da CLI</button>
      <button id="connectWorker" class="secondary">Abrir fluxo oficial de login</button>
    </div>
    <p id="workerAuthStatus" class="hint">A autenticação da CLI ainda não foi verificada.</p>
    <label for="workerModel">Modelo padrão das tarefas do agente</label>
    <input id="workerModel" placeholder="Padrão do agente">
    <label for="workerEffort">Esforço padrão das tarefas do agente</label>
    <select id="workerEffort">
      <option value="">Padrão do agente</option><option value="minimal">Mínimo</option>
      <option value="low">Baixo</option><option value="medium">Médio</option>
      <option value="high">Alto</option><option value="xhigh">Extra alto</option><option value="max">Máximo</option>
    </select>
    <p class="hint">Estes padrões se aplicam às tarefas do agente quando o plano não definir modelo ou esforço próprios. A disponibilidade de cada opção depende do agente selecionado.</p>
    <label>Agentes trabalhadores permitidos pelo coordenador</label>
    <div id="allowedWorkers" class="agent-list"></div>
    <p class="hint">Somente CLIs detectadas e compatíveis com o executor legado aparecem aqui. As conversas nativas de outros provedores permanecem independentes.</p>
    <label for="maxParallel">Máximo de tarefas paralelas</label>
    <input id="maxParallel" type="number" min="1" max="8" value="2">
    <label for="maxAttempts">Máximo de tentativas por tarefa (inclui a primeira)</label>
    <input id="maxAttempts" type="number" min="1" max="5" value="3">
    <label for="budgetLimitUsd">Orçamento estimado máximo por plano (USD; 0 desativa)</label>
    <input id="budgetLimitUsd" type="number" min="0" max="100000" step="0.01" value="0">
    <p class="hint">Quando ativo, cada tarefa precisa de uma estimativa por tentativa. O Orquestrador bloqueia novas reservas se o total estimado atingir o limite. Isso não é cobrança real nem monitoramento de cota do provedor.</p>
  </section>

  <section class="section">
    <h3>Escopo do AI Memory</h3>
    <p id="memoryScopeStatus" class="hint"></p>
    <label for="memoryWorkspace">Workspace</label>
    <input id="memoryWorkspace" placeholder="Detectado automaticamente ou default">
    <label for="memoryProject">Projeto</label>
    <input id="memoryProject" placeholder="Detectado automaticamente">
    <p class="hint">Deixe vazio para usar o escopo de .ai-memory.toml ou o escopo padrão derivado do repositório. A extensão envia workspace e project explicitamente para evitar que tarefas paralelas gravem na memória ativa de outra sessão.</p>
  </section>

  <section class="section">
    <h3>Conhecimento durável do AI Memory</h3>
    <p class="hint">Pesquise no escopo deste projeto ou crie uma nova página. A gravação usa a ferramenta oficial com create-only e confirma o conteúdo por leitura; uma página existente nunca será substituída.</p>
    <label for="memoryKnowledgeQuery">Pesquisar no AI Memory</label>
    <input id="memoryKnowledgeQuery" placeholder="Decisões, arquitetura, regras..."><button id="memoryKnowledgeSearch" class="secondary">Pesquisar</button>
    <div id="memoryKnowledgeLimitRow" data-limit hidden><label for="memoryKnowledgeLimit">Máximo de páginas retornadas</label><input id="memoryKnowledgeLimit" type="number" min="1" max="100" value="8"></div>
    <div id="memoryKnowledgeFilterRows" hidden>
      <div data-filter="tier"><label for="memoryKnowledgeFilterTier">Categoria</label><select id="memoryKnowledgeFilterTier"><option value="">Todas</option><option value="semantic">Semântica</option><option value="procedural">Procedural</option><option value="episodic">Episódica</option><option value="working">Em andamento</option></select></div>
      <div data-filter="kind"><label for="memoryKnowledgeFilterKind">Tipo semântico</label><input id="memoryKnowledgeFilterKind" placeholder="decision, rule, architecture"></div>
      <div data-filter="path_prefix"><label for="memoryKnowledgeFilterPath">Prefixo de caminho</label><input id="memoryKnowledgeFilterPath" placeholder="docs/architecture"></div>
      <div data-filter="tag"><label for="memoryKnowledgeFilterTag">Tag exata</label><input id="memoryKnowledgeFilterTag" placeholder="architecture"></div>
      <div data-filter="pin_first"><label><input id="memoryKnowledgeFilterPinned" type="checkbox"> Incluir páginas fixadas antes dos resultados</label></div>
      <div data-filter="include_superseded"><label><input id="memoryKnowledgeFilterSuperseded" type="checkbox"> Incluir versões substituídas</label></div>
      <div data-filter="explain"><label><input id="memoryKnowledgeFilterExplain" type="checkbox"> Exibir detalhes de ranking</label></div>
    </div>
    <pre id="memoryKnowledgeResults" class="status" aria-live="polite">Nenhuma pesquisa realizada.</pre>
    <label for="memoryKnowledgePath">Criar página em caminho relativo (.md)</label>
    <input id="memoryKnowledgePath" placeholder="orchestrator/knowledge/decisions.md">
    <label for="memoryKnowledgeBody">Conteúdo Markdown</label>
    <textarea id="memoryKnowledgeBody" placeholder="# Decisão&#10;&#10;Contexto, decisão e consequências..."></textarea>
    <label for="memoryKnowledgeTags">Tags (separadas por vírgula)</label>
    <input id="memoryKnowledgeTags" placeholder="architecture, decision">
    <label for="memoryKnowledgeTier">Nível de durabilidade</label>
    <select id="memoryKnowledgeTier">
      <option value="semantic">Semântico (padrão)</option>
      <option value="procedural">Procedural</option>
      <option value="episodic">Episódico</option>
      <option value="working">Em andamento</option>
    </select>
    <label><input id="memoryKnowledgePinned" type="checkbox"> Fixar página para impedir decaimento automático</label>
    <label for="memoryKnowledgeKind">Tipo semântico (opcional)</label>
    <input id="memoryKnowledgeKind" placeholder="decision, rule, architecture">
    <label for="memoryKnowledgeSources">Arquivos fonte rastreados e sem alterações (um caminho por linha)</label>
    <textarea id="memoryKnowledgeSources" placeholder="src/module.js&#10;docs/architecture.md"></textarea>
    <button id="memoryKnowledgeCreate">Criar página durável</button>
    <p id="memoryKnowledgeStatus" class="hint" aria-live="polite"></p>
  </section>

  <section class="section">
    <h3>Editar conhecimento do AI Memory</h3>
    <h4>Editar página existente</h4>
    <label for="memoryKnowledgeEditPath">Caminho relativo da página (.md)</label>
    <input id="memoryKnowledgeEditPath" placeholder="decisions/architecture.md">
    <button id="memoryKnowledgeLoad" class="secondary">Carregar página</button>
    <p id="memoryKnowledgeEditStatus" class="hint" aria-live="polite"></p>
    <div id="memoryKnowledgeEditor" hidden>
      <pre id="memoryKnowledgeCurrent" class="status"></pre>
      <label for="memoryKnowledgeOperation">Alteração</label>
      <select id="memoryKnowledgeOperation">
        <option value="append_end">Acrescentar ao final</option>
        <option value="append_section">Acrescentar a uma seção</option>
        <option value="add_section">Adicionar uma nova seção</option>
        <option value="replace_section">Substituir uma seção</option>
      </select>
      <label id="memoryKnowledgeAnchorLabel" for="memoryKnowledgeAnchor">Seção âncora</label>
      <select id="memoryKnowledgeAnchor"></select>
      <label for="memoryKnowledgeEditContent">Conteúdo da alteração</label>
      <textarea id="memoryKnowledgeEditContent" placeholder="O conteúdo será aplicado somente à versão carregada."></textarea>
      <button id="memoryKnowledgeApply">Aplicar alteração condicional</button>
      <h4>Metadados duráveis</h4>
      <label for="memoryKnowledgeEditTier">Categoria de memória</label>
      <select id="memoryKnowledgeEditTier">
        <option value="">Sem categoria</option><option value="semantic">Semântica</option><option value="procedural">Procedural</option><option value="episodic">Episódica</option><option value="working">Temporária</option>
      </select>
      <label for="memoryKnowledgeEditKind">Tipo</label>
      <input id="memoryKnowledgeEditKind" placeholder="decision, rule, architecture">
      <label for="memoryKnowledgeEditTags">Tags (separadas por vírgula)</label>
      <input id="memoryKnowledgeEditTags" placeholder="architecture, decision">
      <label><input id="memoryKnowledgeEditPinned" type="checkbox"> Fixar esta página</label>
      <button id="memoryKnowledgeSaveMetadata" class="secondary">Salvar metadados condicionalmente</button>
    </div>
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
    <button id="installDependencies" class="secondary">Instalar / iniciar AI Memory</button>
  </section>

  <button id="save">Salvar configurações</button>
  <div id="notice" class="status" hidden></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const byId = id => document.getElementById(id);
    let state;
    let coordinatorModelRequest = 0;
    let knowledgeRequest = 0;
    let knowledgePageLoadRequest = 0;
    let knowledgeSearchFilters = [];
    let knowledgeSearchLimit;
    let loadedKnowledgePage;
    function renderKnowledgePage(pageToken, page, scope) {
      loadedKnowledgePage = { pageToken, page, workspace: state?.workspace || '' };
      byId('memoryKnowledgeEditPath').value = page.path;
      byId('memoryKnowledgeEditor').hidden = false;
      byId('memoryKnowledgeCurrent').textContent = (page.title || page.path) + '\\nVersão ' + page.pageId + '\\n\\n' + page.body;
      const metadata = page.frontmatter || {};
      byId('memoryKnowledgeEditTier').value = metadata.tier || '';
      byId('memoryKnowledgeEditKind').value = metadata.kind || '';
      byId('memoryKnowledgeEditTags').value = Array.isArray(metadata.tags) ? metadata.tags.join(', ') : '';
      byId('memoryKnowledgeEditPinned').checked = metadata.pinned === true;
      byId('memoryKnowledgeSaveMetadata').disabled = false;
      byId('memoryKnowledgeEditStatus').textContent = 'Página carregada em ' + scope.workspace + '/' + scope.project + '. A gravação usa a versão ' + page.pageId + ' como precondição; se outra sessão alterá-la, o AI Memory recusará a edição.';
      const anchor = byId('memoryKnowledgeAnchor');
      anchor.replaceChildren();
      for (const section of page.sections || []) anchor.append(new Option('#'.repeat(section.level || 2) + ' ' + section.anchor, section.anchor));
      updateKnowledgeOperation();
      if (state.hasWorkspace && state.workspaceTrusted) vscode.postMessage({ type: 'loadKnowledgeSearchFilters' });
    }
    function updateKnowledgeOperation() {
      const operation = byId('memoryKnowledgeOperation').value;
      const needsAnchor = operation !== 'append_end';
      byId('memoryKnowledgeAnchorLabel').hidden = !needsAnchor;
      byId('memoryKnowledgeAnchor').hidden = !needsAnchor;
      byId('memoryKnowledgeApply').disabled = !loadedKnowledgePage || (needsAnchor && !byId('memoryKnowledgeAnchor').value);
      byId('memoryKnowledgeSaveMetadata').disabled = !loadedKnowledgePage;
    }
    function selectedProvider() {
      return (state.options?.providers || []).find(provider => provider.id === byId('orchestratorProvider').value);
    }
    function populateProviderOptions(config) {
      const select = byId('orchestratorProvider');
      select.replaceChildren();
      for (const provider of state.options?.providers || []) {
        if (!provider.canCoordinateInOrchestratorChat && !provider.canCoordinateWithCli) continue;
        select.append(new Option(provider.name + (provider.canCoordinateWithCli ? ' — CLI' : ' — VS Code'), provider.id));
      }
      select.value = config.providerId || '';
      if (!select.value && select.options.length) select.value = select.options[0].value;
      if (!select.options.length) select.append(new Option('Nenhum coordenador compatível detectado', ''));
    }
    function populateAllowedWorkers(orchestration) {
      const root = byId('allowedWorkers');
      root.replaceChildren();
      const candidates = (state.options?.providers || []).filter(provider => (provider.canRunInLich && provider.cliKind) || provider.canRunInVscodeModel || provider.canRunCodexAppServer || provider.canRunClaudeCode);
      const configured = Array.isArray(orchestration.allowedProviders) ? orchestration.allowedProviders : candidates.map(provider => provider.id);
      if (!candidates.length) {
        const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = 'Nenhum agente com interface de execução compatível foi detectado.'; root.append(empty); return;
      }
      for (const provider of candidates) {
        const label = document.createElement('label'); label.className = 'agent-option';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.provider = provider.id; checkbox.checked = configured.includes(provider.id);
        const text = document.createElement('span'); text.innerHTML = '<span class="agent-name"></span><span class="agent-meta"></span>';
        text.querySelector('.agent-name').textContent = provider.name;
        text.querySelector('.agent-meta').textContent = provider.source + (provider.canRunInVscodeModel ? ' · Pode executar tarefas pela API de modelos do VS Code' : provider.canRunCodexAppServer ? ' · Sessões próprias pelo Codex app-server' : provider.canRunClaudeCode ? ' · Sessões próprias Claude Code com aprovações do Orchestrator' : ' · CLI de compatibilidade opcional');
        label.append(checkbox, text); root.append(label);
      }
    }
    function populateWorkerProviders(workerDefaults) {
      const select = byId('workerProvider');
      select.replaceChildren();
      const candidates = (state.options?.providers || []).filter(provider => (provider.canRunInLich && provider.cliKind) || provider.canRunInVscodeModel || provider.canRunCodexAppServer || provider.canRunClaudeCode);
      for (const provider of candidates) {
        const executor = provider.canRunClaudeCode ? 'Claude CLI' : provider.canRunCodexAppServer ? 'Codex app-server' : provider.canRunInVscodeModel ? 'VS Code' : 'CLI compatível';
        select.append(new Option(provider.name + ' — ' + executor, provider.id));
      }
      const selected = candidates.find(provider => provider.id === workerDefaults.provider) || candidates[0];
      if (selected) select.value = selected.id;
      if (!candidates.length) select.append(new Option('Nenhum agente compatível detectado', ''));
      const auth = state.authStatuses?.[selected?.id];
      byId('checkWorkerAuth').disabled = !selected?.executable;
      byId('connectWorker').disabled = !selected;
      byId('workerAuthStatus').textContent = auth?.text || selected?.source || 'A autenticação ainda não foi verificada.';
      byId('workerModel').value = workerDefaults.model || '';
      byId('workerEffort').value = workerDefaults.effort || '';
      byId('workerModel').disabled = !selected;
      byId('workerEffort').disabled = !selected || (!selected.canRunInLich && !selected.canRunCodexAppServer && !selected.canRunClaudeCode);
      if (byId('workerModel').disabled) byId('workerModel').value = '';
      if (byId('workerEffort').disabled) byId('workerEffort').value = '';
    }
    function updateProviderDetails(modelValue) {
      const provider = selectedProvider();
      const cli = Boolean(provider?.canCoordinateWithCli);
      const models = byId('orchestratorModels');
      models.replaceChildren();
      for (const model of provider?.models || []) models.append(new Option(model.name + ' — ' + model.id, model.id));
      if (provider?.id === 'codex') {
        for (const model of state.coordinatorCliModels || []) {
          if (!(provider.models || []).some(item => item.id === model.id)) models.append(new Option(model.name + ' — ' + model.id, model.id));
        }
      }
      byId('orchestratorModel').value = modelValue || '';
      byId('orchestratorModel').placeholder = cli ? 'ID do modelo aceito pela CLI' : provider?.models?.length ? 'Selecione um modelo publicado pelo VS Code' : 'Nenhum modelo compatível disponível';
      byId('cliProfileSettings').hidden = !cli;
      byId('orchestratorEffort').disabled = !cli;
      byId('connectProvider').hidden = cli;
      updateCoordinatorEffortOptions(modelValue || '');
      const catalogStatus = byId('coordinatorModelStatus');
      if (provider?.id === 'codex') catalogStatus.textContent = state.coordinatorModelStatus || 'Selecione um perfil Codex autorizado para carregar o catálogo local de modelos.';
      else if (cli) catalogStatus.textContent = 'Informe um ID aceito pela CLI; acesso ao modelo será confirmado na solicitação.';
      else catalogStatus.textContent = '';
      const providerAccess = provider?.models.length
        ? provider.models.length + ' modelo(s) exposto(s) pelo VS Code.'
        : 'Este provedor não publica modelo para a conversa do Orquestrador.';
      byId('providerStatus').textContent = provider
        ? cli
          ? provider.name + ': coordenador via CLI oficial em modo de planejamento; usa apenas a autenticação do perfil selecionado.'
          : provider.name + ': ' + provider.source + '. ' + providerAccess + ' O acesso será verificado ao enviar a primeira solicitação.'
        : 'Escolha um provedor de modelos publicado no VS Code para conversar com o Coordenador.';
      if (!cli && state.options?.modelDiscoveryTimedOut) {
        byId('providerStatus').textContent += ' A API de modelos do VS Code ainda não respondeu; as outras configurações já estão disponíveis. Tente abrir Configurações novamente depois de autorizar um provedor no Chat.';
      }
      if (!cli && provider?.models?.length) {
        const accessCounts = { authorized: 0, 'consent-required': 0, blocked: 0, unknown: 0 };
        for (const model of provider.models) accessCounts[model.accessStatus] = (accessCounts[model.accessStatus] || 0) + 1;
        const accessSummary = [
          accessCounts.authorized ? accessCounts.authorized + ' autorizado(s)' : '',
          accessCounts['consent-required'] ? accessCounts['consent-required'] + ' aguardando consentimento' : '',
          accessCounts.blocked ? accessCounts.blocked + ' sem autorização' : '',
          accessCounts.unknown ? accessCounts.unknown + ' sem estado de acesso consultável' : ''
        ].filter(Boolean).join(', ');
        if (accessSummary) byId('providerStatus').textContent += ' Estado de acesso informado pelo VS Code: ' + accessSummary + '.';
      }
      byId('connectProvider').disabled = !provider;
    }
    function updateCoordinatorEffortOptions(modelId) {
      const select = byId('orchestratorEffort');
      const selected = select.value;
      const provider = selectedProvider();
      const model = (state.coordinatorCliModels || []).find(item => item.id === modelId);
      const efforts = provider?.id === 'codex'
        ? (model?.efforts?.length ? model.efforts : [...new Set((state.coordinatorCliModels || []).flatMap(item => item.efforts || []))])
        : ['low', 'medium', 'high', 'xhigh', 'max'];
      const labels = { minimal: 'Mínimo', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo', ultra: 'Ultra' };
      select.replaceChildren(new Option('Padrão do agente', ''));
      for (const effort of efforts) select.append(new Option(labels[effort] || effort, effort));
      select.value = efforts.includes(selected) ? selected : '';
    }
    function requestCoordinatorModels() {
      const provider = selectedProvider();
      const profileId = byId('coordinatorProfile').value;
      const requestId = ++coordinatorModelRequest;
      state.coordinatorCliModels = [];
      state.coordinatorModelStatus = '';
      if (provider?.id !== 'codex' || !profileId) {
        updateProviderDetails(byId('orchestratorModel').value);
        return;
      }
      state.coordinatorModelRequestId = requestId;
      state.coordinatorModelStatus = 'Carregando catálogo de modelos da CLI do Codex…';
      updateProviderDetails(byId('orchestratorModel').value);
      vscode.postMessage({ type: 'listCoordinatorModels', profileId, requestId });
    }
    function populateCoordinatorProfiles(config) {
      const profiles = state.coordinatorProfiles || [];
      const supported = (state.options?.providers || []).filter(item => item.canCoordinateWithCli);
      const providerSelect = byId('coordinatorProfileProvider'); providerSelect.replaceChildren();
      for (const item of supported) providerSelect.append(new Option(item.name, item.id));
      const selectedProviderId = byId('orchestratorProvider').value;
      if (supported.some(item => item.id === selectedProviderId)) providerSelect.value = selectedProviderId;
      const list = byId('coordinatorProfiles'); list.replaceChildren();
      const active = byId('coordinatorProfile'); active.replaceChildren();
      const candidates = profiles.filter(profile => profile.providerId === selectedProviderId && profile.authorized);
      active.append(new Option(candidates.length ? 'Selecione um perfil autorizado' : 'Nenhum perfil autorizado', ''));
      for (const profile of profiles) {
        const provider = supported.find(item => item.id === profile.providerId);
        const row = document.createElement('div'); row.className = 'agent-option';
        const authorize = document.createElement('input'); authorize.type = 'checkbox'; authorize.checked = Boolean(profile.authorized); authorize.title = 'Autorizar como coordenador';
        authorize.addEventListener('change', () => vscode.postMessage({ type: 'authorizeCoordinatorProfile', profileId: profile.id, authorized: authorize.checked }));
        const text = document.createElement('span'); text.innerHTML = '<span class="agent-name"></span><span class="agent-meta"></span>';
        text.querySelector('.agent-name').textContent = (provider?.name || profile.providerId) + ' · ' + profile.name;
        const auth = state.authStatuses?.['profile:' + profile.id];
        text.querySelector('.agent-meta').textContent = (profile.isolated ? 'Perfil isolado' : 'Login CLI atual') + ' · ' + (auth?.text || 'autenticação não verificada');
        const concurrency = document.createElement('label'); concurrency.className = 'profile-concurrency'; concurrency.textContent = 'Simultâneas (todos os projetos)';
        const limit = document.createElement('input'); limit.type = 'number'; limit.min = '1'; limit.max = '8'; limit.step = '1'; limit.value = Math.max(1, Math.min(8, Number(profile.maxParallel) || 1));
        limit.setAttribute('aria-label', 'Limite de tarefas simultâneas para ' + profile.name);
        limit.addEventListener('change', () => vscode.postMessage({ type: 'setCoordinatorProfileConcurrency', profileId: profile.id, maxParallel: Number(limit.value) }));
        concurrency.append(limit);
        const actions = document.createElement('span');
        for (const [label, type] of [['Verificar', 'checkCoordinatorProfile'], ['Login oficial', 'connectCoordinatorProfile'], ['Renomear', 'renameCoordinatorProfile'], ['Remover', 'removeCoordinatorProfile']]) {
          const button = document.createElement('button'); button.className = 'secondary'; button.textContent = label;
          button.addEventListener('click', () => vscode.postMessage({ type, profileId: profile.id })); actions.append(button);
        }
        row.append(authorize, text, concurrency, actions); list.append(row);
        if (profile.providerId === selectedProviderId && profile.authorized) active.append(new Option(profile.name + (auth?.status === 'verified' ? ' · autenticado' : ' · não verificado'), profile.id));
      }
      active.value = config.profileId || '';
      byId('orchestratorEffort').value = config.effort || '';
      byId('addExistingCoordinatorProfile').disabled = !supported.some(item => item.id === providerSelect.value);
      byId('addIsolatedCoordinatorProfile').disabled = !supported.some(item => item.id === providerSelect.value);
      requestCoordinatorModels();
    }
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
      const workspaceChanged = state !== undefined && state.workspace !== (stateValue?.workspace || '');
      if (workspaceChanged) {
        knowledgePageLoadRequest++;
        loadedKnowledgePage = undefined;
        byId('memoryKnowledgeEditor').hidden = true;
        byId('memoryKnowledgeEditStatus').textContent = 'O projeto mudou. Carregue novamente a página para editá-la no workspace atual.';
      }
      state = stateValue;
      byId('workspace').textContent = state.hasWorkspace ? state.workspace : 'Abra uma pasta de projeto para configurar o Orquestrador.';
      byId('aiStatus').textContent = state.aiExists
        ? state.aiIsDirectory ? '.ai já existe. A preparação não alterará esta pasta.' : 'Existe um item chamado .ai que não é pasta. Nada será alterado.'
        : 'A pasta .ai ainda não existe.';
      if (state.config?.configError) showNotice({ level: 'error', text: 'Erro de leitura da configuração .ai: ' + state.config.configError });
      byId('initialize').disabled = !state.hasWorkspace || state.aiExists;
      byId('save').disabled = !state.hasWorkspace || !state.aiIsDirectory;
      byId('memoryKnowledgeSearch').disabled = !state.hasWorkspace || !state.workspaceTrusted;
      byId('memoryKnowledgeCreate').disabled = !state.hasWorkspace || !state.workspaceTrusted;
      byId('memoryKnowledgeLoad').disabled = !state.hasWorkspace || !state.workspaceTrusted;
      if (!workspaceChanged && loadedKnowledgePage && state.workspace !== loadedKnowledgePage.workspace) {
        loadedKnowledgePage = undefined;
        byId('memoryKnowledgeEditor').hidden = true;
      }
      updateKnowledgeOperation();
      const config = state.config || {};
      const orchestration = config.orchestration || {};
      byId('workerCompatibilityStatus').textContent = 'O perfil selecionado é usado pelo coordenador. Perfis Codex autorizados também podem ser escolhidos por tarefa executada pelo Codex app-server. Os demais workers usam a autenticação e as opções próprias do executor listado; a extensão não compartilha tokens entre provedores.';
      const workerDefaults = config.workerDefaults || {};
      populateProviderOptions(orchestration);
      populateCoordinatorProfiles(orchestration);
      populateAllowedWorkers(orchestration);
      populateWorkerProviders(workerDefaults);
      byId('maxParallel').value = Math.max(1, Math.min(8, Number(orchestration.maxParallel) || 2));
      byId('maxAttempts').value = Math.max(1, Math.min(5, Number(orchestration.maxAttempts) || 3));
      byId('budgetLimitUsd').value = Math.max(0, Math.min(100000, Number(orchestration.budgetLimitUsd) || 0));
      updateProviderDetails(orchestration.modelId || orchestration.model?.id || '');
      const build = config.build || {};
      byId('buildCommand').value = build.command || '';
      byId('buildArgs').value = Array.isArray(build.args) ? build.args.join('\\n') : '';
      byId('buildCwd').value = build.cwd || '.';
      byId('buildTimeout').value = Math.max(1, Math.round((build.timeoutMs || 1800000) / 1000));
      byId('lichCommand').value = state.tools.lichCommand || 'lich';
      byId('aiMemoryCommand').value = state.tools.aiMemoryCommand || 'ai-memory';
      const memory = config.aiMemory || {};
      byId('memoryWorkspace').value = memory.workspace || '';
      byId('memoryProject').value = memory.project || '';
      byId('memoryScopeStatus').textContent = state.memoryScope
        ? 'Escopo detectado: '+state.memoryScope.workspace+'/'+state.memoryScope.project+' ('+state.memoryScope.source+'). Os campos preenchidos substituem essa detecção.'
        : 'O escopo será validado ao consultar AI Memory.';
      byId('upstreams').replaceChildren();
      for (const item of config.upstreams || []) addUpstream(item);
    }
    byId('addUpstream').addEventListener('click', () => addUpstream());
    byId('orchestratorProvider').addEventListener('change', () => { populateCoordinatorProfiles({}); updateProviderDetails(''); });
    byId('coordinatorProfile').addEventListener('change', requestCoordinatorModels);
    byId('orchestratorModel').addEventListener('change', () => updateCoordinatorEffortOptions(byId('orchestratorModel').value));
    byId('workerProvider').addEventListener('change', () => populateWorkerProviders({ provider: byId('workerProvider').value, model: '', effort: '' }));
    byId('checkWorkerAuth').addEventListener('click', () => vscode.postMessage({ type: 'checkWorkerAuthentication', providerId: byId('workerProvider').value }));
    byId('connectWorker').addEventListener('click', () => vscode.postMessage({ type: 'connectWorkerProvider', providerId: byId('workerProvider').value }));
    byId('connectProvider').addEventListener('click', () => vscode.postMessage({ type: 'connectProvider', providerId: byId('orchestratorProvider').value }));
    byId('addExistingCoordinatorProfile').addEventListener('click', () => vscode.postMessage({ type: 'createCoordinatorProfile', providerId: byId('coordinatorProfileProvider').value, isolated: false }));
    byId('addIsolatedCoordinatorProfile').addEventListener('click', () => vscode.postMessage({ type: 'createCoordinatorProfile', providerId: byId('coordinatorProfileProvider').value, isolated: true }));
    byId('initialize').addEventListener('click', () => vscode.postMessage({ type: 'initialize' }));
    byId('checkTools').addEventListener('click', () => vscode.postMessage({ type: 'checkTools' }));
    byId('installDependencies').addEventListener('click', () => vscode.postMessage({ type: 'installDependencies' }));
    byId('memoryKnowledgeSearch').addEventListener('click', () => {
      const query = byId('memoryKnowledgeQuery').value.trim();
      if (!query) { byId('memoryKnowledgeResults').textContent = 'Digite um termo para pesquisar.'; return; }
      const requestId = String(++knowledgeRequest);
      byId('memoryKnowledgeResults').textContent = 'Pesquisando no escopo do projeto…';
      const filters = {};
      const fields = { tier: ['memoryKnowledgeFilterTier', 'value'], kind: ['memoryKnowledgeFilterKind', 'value'], path_prefix: ['memoryKnowledgeFilterPath', 'value'], tag: ['memoryKnowledgeFilterTag', 'value'], pin_first: ['memoryKnowledgeFilterPinned', 'checked'], include_superseded: ['memoryKnowledgeFilterSuperseded', 'checked'], explain: ['memoryKnowledgeFilterExplain', 'checked'] };
      for (const [name, [id, property]] of Object.entries(fields)) if (knowledgeSearchFilters.includes(name)) filters[name] = byId(id)[property];
      vscode.postMessage({ type: 'searchKnowledge', query, filters, limit: knowledgeSearchLimit ? Number(byId('memoryKnowledgeLimit').value) : undefined, requestId });
    });
    byId('memoryKnowledgeCreate').addEventListener('click', () => {
      vscode.postMessage({
        type: 'createKnowledgePage', path: byId('memoryKnowledgePath').value, body: byId('memoryKnowledgeBody').value,
        tags: byId('memoryKnowledgeTags').value, tier: byId('memoryKnowledgeTier').value,
        pinned: byId('memoryKnowledgePinned').checked, kind: byId('memoryKnowledgeKind').value,
        sourceFiles: byId('memoryKnowledgeSources').value
      });
    });
    byId('memoryKnowledgeOperation').addEventListener('change', updateKnowledgeOperation);
    byId('memoryKnowledgeAnchor').addEventListener('change', updateKnowledgeOperation);
    byId('memoryKnowledgeLoad').addEventListener('click', () => {
      const pagePath = byId('memoryKnowledgeEditPath').value.trim();
      if (!pagePath) { byId('memoryKnowledgeEditStatus').textContent = 'Informe o caminho relativo de uma página existente.'; return; }
      loadedKnowledgePage = undefined;
      byId('memoryKnowledgeEditor').hidden = true;
      byId('memoryKnowledgeEditStatus').textContent = 'Carregando a página completa do AI Memory…';
      vscode.postMessage({ type: 'loadKnowledgePage', path: pagePath, requestId: String(++knowledgePageLoadRequest) });
    });
    byId('memoryKnowledgeApply').addEventListener('click', () => {
      if (!loadedKnowledgePage) return;
      const operation = byId('memoryKnowledgeOperation').value;
      const edit = {
        op: operation === 'append_end' || operation === 'append_section' ? 'append' : operation,
        target: operation === 'append_end' ? 'end_of_page' : operation === 'append_section' ? 'section' : undefined,
        anchor: operation === 'append_end' ? '' : byId('memoryKnowledgeAnchor').value,
        content: byId('memoryKnowledgeEditContent').value
      };
      byId('memoryKnowledgeEditStatus').textContent = 'Aplicando alteração condicional e confirmando por leitura…';
      byId('memoryKnowledgeApply').disabled = true;
      vscode.postMessage({ type: 'patchKnowledgePage', pageToken: loadedKnowledgePage.pageToken, edit });
    });
    byId('memoryKnowledgeSaveMetadata').addEventListener('click', () => {
      if (!loadedKnowledgePage) return;
      const changes = {
        tier: byId('memoryKnowledgeEditTier').value,
        kind: byId('memoryKnowledgeEditKind').value,
        tags: byId('memoryKnowledgeEditTags').value.split(',').map(value => value.trim()).filter(Boolean),
        pinned: byId('memoryKnowledgeEditPinned').checked
      };
      byId('memoryKnowledgeEditStatus').textContent = 'Atualizando metadados com precondição de versão; o conteúdo da página será preservado.';
      byId('memoryKnowledgeSaveMetadata').disabled = true;
      vscode.postMessage({ type: 'updateKnowledgeMetadata', pageToken: loadedKnowledgePage.pageToken, changes });
    });
    byId('save').addEventListener('click', () => {
      const command = byId('buildCommand').value.trim();
      const args = byId('buildArgs').value.split('\\n').map(value => value.trim()).filter(Boolean);
      const upstreams = [...byId('upstreams').querySelectorAll('.upstream')].map(row => Object.fromEntries(
        [...row.querySelectorAll('input')].map(input => [input.dataset.field, input.value.trim()])
      )).filter(item => item.path || item.remote || item.branch);
      vscode.postMessage({ type: 'save', settings: {
        orchestration: {
          providerId: byId('orchestratorProvider').value,
          profileId: byId('coordinatorProfile').value,
          modelId: byId('orchestratorModel').value.trim(),
          effort: byId('orchestratorEffort').value,
          allowedProviders: [...byId('allowedWorkers').querySelectorAll('input[type="checkbox"]:checked')].map(input => input.dataset.provider),
          maxParallel: Math.max(1, Math.min(8, Number(byId('maxParallel').value) || 2)),
          maxAttempts: Math.max(1, Math.min(5, Number(byId('maxAttempts').value) || 3)),
          budgetLimitUsd: Math.round(Math.max(0, Math.min(100000, Number(byId('budgetLimitUsd').value) || 0)) * 100) / 100
        },
        workerDefaults: { provider: byId('workerProvider').value, model: byId('workerModel').value.trim(), effort: byId('workerEffort').value },
        build: command ? { command, args, cwd: byId('buildCwd').value.trim() || '.', timeoutMs: Math.max(1, Number(byId('buildTimeout').value) || 1800) * 1000 } : null,
        upstreams,
        tools: { lichCommand: byId('lichCommand').value.trim(), aiMemoryCommand: byId('aiMemoryCommand').value.trim() },
        aiMemory: { workspace: byId('memoryWorkspace').value.trim(), project: byId('memoryProject').value.trim() }
      }});
    });
    window.addEventListener('message', event => {
      if (event.data.type === 'state') {
        try { load(event.data.state); }
        catch (error) {
          byId('workspace').textContent = 'Não foi possível exibir o estado do projeto.';
          byId('aiStatus').textContent = error.message || String(error);
          byId('initialize').disabled = true;
          byId('save').disabled = true;
          showNotice({ level: 'error', text: 'Erro ao exibir as configurações: ' + (error.message || String(error)) });
        }
      }
      if (event.data.type === 'stateError') {
        byId('workspace').textContent = event.data.workspace || 'Nenhuma pasta de projeto aberta.';
        byId('aiStatus').textContent = 'Não foi possível carregar o estado da pasta .ai.';
        byId('initialize').disabled = true;
        byId('save').disabled = true;
        showNotice({ level: 'error', text: 'Falha ao carregar as configurações: ' + event.data.text });
      }
      if (event.data.type === 'providers') {
        const providerId = byId('orchestratorProvider').value;
        const modelId = byId('orchestratorModel').value;
        const profileId = byId('coordinatorProfile').value;
        const effort = byId('orchestratorEffort').value;
        state.options = event.data.options || { providers: [], models: [], modelDiscoveryTimedOut: false };
        populateProviderOptions({ providerId });
        populateCoordinatorProfiles({ profileId, effort });
        updateProviderDetails(modelId);
      }
      if (event.data.type === 'coordinatorModels') {
        if (event.data.profileId !== byId('coordinatorProfile').value || event.data.requestId !== state.coordinatorModelRequestId) return;
        state.coordinatorCliModels = Array.isArray(event.data.models) ? event.data.models : [];
        state.coordinatorModelStatus = event.data.message || '';
        updateProviderDetails(byId('orchestratorModel').value);
      }
      if (event.data.type === 'providerError') showNotice({ type: 'notice', level: 'error', text: 'Não foi possível atualizar a lista de modelos: ' + event.data.text });
      if (event.data.type === 'notice') showNotice(event.data);
      if (event.data.type === 'knowledgeSearchResult' && event.data.requestId === String(knowledgeRequest)) {
        const visibleFilters = (event.data.filters || []).filter(name => byId('memoryKnowledgeFilterRows').querySelector('[data-filter="' + name + '"]')?.hidden === false);
        const applied = (event.data.filters || []).filter(name => visibleFilters.includes(name));
        byId('memoryKnowledgeResults').textContent = 'Escopo ' + event.data.scope.workspace + '/' + event.data.scope.project + ' · limite: ' + (event.data.limit ?? 'padrão do AI Memory') + ' · filtros aplicados: ' + (applied.join(', ') || 'nenhum') + '\\n\\n' + (event.data.text || '(nenhum resultado retornado pelo AI Memory)');
      }
      if (event.data.type === 'knowledgeSearchFilters') {
        knowledgeSearchFilters = Array.isArray(event.data.filters) ? event.data.filters : [];
        knowledgeSearchLimit = event.data.limit || null;
        const limitRow = byId('memoryKnowledgeLimitRow');
        limitRow.hidden = !knowledgeSearchLimit;
        if (knowledgeSearchLimit) {
          const input = byId('memoryKnowledgeLimit');
          input.min = knowledgeSearchLimit.minimum;
          input.max = knowledgeSearchLimit.maximum;
          input.value = knowledgeSearchLimit.default;
        }
        for (const row of byId('memoryKnowledgeFilterRows').querySelectorAll('[data-filter]')) row.hidden = !knowledgeSearchFilters.includes(row.dataset.filter);
        byId('memoryKnowledgeFilterRows').hidden = knowledgeSearchFilters.length === 0;
      }
      if (event.data.type === 'knowledgePageCreated') {
        byId('memoryKnowledgeStatus').textContent = 'AI Memory page created and verified: ' + event.data.path + ' (' + event.data.scope.workspace + '/' + event.data.scope.project + ', ID ' + event.data.pageId + ').';
        showNotice({ level: 'success', text: 'Página do AI Memory criada e verificada.' });
      }
      if (event.data.type === 'knowledgePageLoaded' && event.data.requestId === String(knowledgePageLoadRequest)) renderKnowledgePage(event.data.pageToken, event.data.page, event.data.scope);
      if (event.data.type === 'knowledgePagePatched') {
        renderKnowledgePage(event.data.pageToken, event.data.page, event.data.scope);
        byId('memoryKnowledgeEditContent').value = '';
        byId('memoryKnowledgeEditStatus').textContent = 'Alteração aplicada com precondição de versão e confirmada por leitura. Página agora em ' + event.data.page.pageId + '.';
        showNotice({ level: 'success', text: 'Página existente atualizada e confirmada pelo AI Memory.' });
      }
      if (event.data.type === 'knowledgeMetadataUpdated') {
        renderKnowledgePage(event.data.pageToken, event.data.page, event.data.scope);
        byId('memoryKnowledgeEditStatus').textContent = 'Metadados atualizados condicionalmente e confirmados por leitura. Conteúdo preservado; nova versão ' + event.data.page.pageId + '.';
        showNotice({ level: 'success', text: 'Metadados atualizados e confirmados pelo AI Memory.' });
      }
      if (event.data.type === 'knowledgeOperationError') {
        if (event.data.operation === 'loadKnowledgeSearchFilters') {
          knowledgeSearchFilters = [];
          byId('memoryKnowledgeFilterRows').hidden = true;
          showNotice({ level: 'error', text: event.data.text });
          return;
        }
        if (event.data.operation === 'searchKnowledge' && event.data.requestId !== String(knowledgeRequest)) return;
        if (event.data.operation === 'loadKnowledgePage' && event.data.requestId !== String(knowledgePageLoadRequest)) return;
        if (event.data.operation === 'searchKnowledge') byId('memoryKnowledgeResults').textContent = event.data.text;
        if (event.data.operation === 'loadKnowledgePage') {
          byId('memoryKnowledgeEditor').hidden = true;
          byId('memoryKnowledgeEditStatus').textContent = event.data.text;
        }
        if (event.data.operation === 'patchKnowledgePage') {
          loadedKnowledgePage = undefined;
          byId('memoryKnowledgeEditStatus').textContent = event.data.text + ' Carregue a página novamente antes de tentar outra alteração.';
          updateKnowledgeOperation();
        }
        if (event.data.operation === 'updateKnowledgeMetadata') {
          loadedKnowledgePage = undefined;
          byId('memoryKnowledgeEditStatus').textContent = event.data.text + ' Carregue a página novamente antes de tentar outra alteração.';
          updateKnowledgeOperation();
        }
      }
    });
    vscode.postMessage({ type: 'load' });
  </script>
</body>
</html>`;
  }
}

function defaultConfig() {
  return { build: null, upstreams: [], orchestration: {}, workerDefaults: {}, aiMemory: {} };
}

module.exports = { OrchestratorSettingsView };

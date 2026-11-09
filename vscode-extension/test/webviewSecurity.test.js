'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { createWebviewSecurity } = require('../src/webviewSecurity');

const originalLoad = Module._load;
const mockVscode = {
  lm: {
    tools: [],
    selectChatModels: async () => [],
    onDidChangeChatModels: () => ({ dispose() {} })
  },
  workspace: { isTrusted: false, workspaceFolders: [] },
  ViewColumn: { Beside: 2 },
  CancellationTokenSource: class { constructor() { this.token = {}; } dispose() {} }
};
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return mockVscode;
  return originalLoad.call(this, request, parent, isMain);
};
const { OrchestratorHomeView } = require('../src/orchestratorHomeView');
const { OrchestratorSettingsView } = require('../src/settingsView');
Module._load = originalLoad;

test('webview policy denies by default and authorizes inline code only with its per-view nonce', () => {
  const webview = { cspSource: 'vscode-webview-resource:' };
  const first = createWebviewSecurity(webview);
  const second = createWebviewSecurity(webview);

  assert.notEqual(first.nonce, second.nonce);
  assert.match(first.csp, /default-src 'none'/);
  assert.match(first.csp, /img-src vscode-webview-resource: data:/);
  assert.match(first.csp, /font-src vscode-webview-resource:/);
  assert.ok(first.csp.includes(`style-src vscode-webview-resource: 'nonce-${first.nonce}'`));
  assert.ok(first.csp.includes(`script-src 'nonce-${first.nonce}'`));
  assert.doesNotMatch(first.csp, /unsafe-inline|unsafe-eval/);
});

test('both Orchestrator webview documents actually emit a CSP and nonce-bound scripts', () => {
  const webview = { cspSource: 'vscode-webview-resource:' };
  for (const prototype of [OrchestratorHomeView.prototype, OrchestratorSettingsView.prototype]) {
    const html = prototype.html.call({}, webview);
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none';[^\"]+">/);
    const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
    assert.ok(nonce, 'the CSP should include a per-document script nonce');
    assert.ok(html.includes(`<script nonce="${nonce}">`), 'the inline script must use the CSP nonce');
    assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
    if (prototype === OrchestratorSettingsView.prototype) {
      assert.match(html, /id="memoryKnowledgeSearch"/);
      assert.match(html, /id="memoryKnowledgeFilterPath"/);
      assert.match(html, /id="memoryKnowledgeFilterTag"/);
      assert.match(html, /id="memoryKnowledgeFilterExplain"/);
      assert.match(html, /id="memoryKnowledgeCreate"/);
      assert.match(html, /id="memoryKnowledgeLoad"/);
      assert.match(html, /id="memoryKnowledgeApply"/);
      assert.match(html, /id="memoryKnowledgePinned"/);
      assert.match(html, /id="memoryKnowledgeSources"/);
      assert.match(html, /versão carregada|precondição de versão/i);
      assert.match(html, /create-only/);
      assert.match(html, /Estado de acesso informado pelo VS Code/);
      assert.match(html, /aguardando consentimento/);
    }
  }
});

test('Orchestrator home does not pollute its chat with Lich-only cost reporting', () => {
  const html = OrchestratorHomeView.prototype.html.call({}, { cspSource: 'vscode-webview-resource:' });
  assert.doesNotMatch(html, /refreshUsage|custos conhecidos do Lich|relat[oó]rio de custo do Lich/i);
  assert.equal(typeof OrchestratorHomeView.prototype.refreshUsage, 'undefined');
});

test('webviews receive CSP HTML before scripts are enabled', async () => {
  const homeEvents = [];
  const homeWebview = {
    cspSource: 'vscode-webview-resource:',
    postMessage: async () => true,
    onDidReceiveMessage: () => ({ dispose() {} })
  };
  Object.defineProperties(homeWebview, {
    html: { set(value) { assert.match(value, /Content-Security-Policy/); homeEvents.push('html'); } },
    options: { set(value) { assert.equal(value.enableScripts, true); homeEvents.push('scripts'); } }
  });
  const state = new Map();
  const home = Object.create(OrchestratorHomeView.prototype);
  Object.assign(home, {
    context: {
      workspaceState: {
        get: (key, fallback) => state.has(key) ? state.get(key) : fallback,
        update: async (key, value) => state.set(key, value)
      }
    },
    getState: async () => ({ config: { orchestration: {} }, options: { providers: [] }, coordinatorProfiles: [] }),
    view: undefined,
    messageListener: undefined,
    disposables: [],
    pollTimer: undefined,
    usage: { status: 'unknown' },
    coordinatorProfileAuth: {}
  });
  await home.resolveWebviewView({ webview: homeWebview });
  clearInterval(home.pollTimer);
  assert.deepEqual(homeEvents, ['html', 'scripts']);

  const settingsEvents = [];
  const settingsWebview = { cspSource: 'vscode-webview-resource:' };
  Object.defineProperties(settingsWebview, {
    html: { set(value) { assert.match(value, /Content-Security-Policy/); settingsEvents.push('html'); } },
    options: { set(value) { assert.equal(value.enableScripts, true); settingsEvents.push('scripts'); } },
    onDidReceiveMessage: { value: () => ({ dispose() {} }) }
  });
  let creationOptions;
  const panel = {
    webview: settingsWebview,
    onDidDispose: () => ({ dispose() {} }),
    dispose() {}
  };
  const originalCreateWebviewPanel = mockVscode.window?.createWebviewPanel;
  mockVscode.window = {
    createWebviewPanel: (_viewType, _title, _column, options) => {
      creationOptions = options;
      settingsEvents.push('create');
      return panel;
    }
  };
  try {
    const settings = new OrchestratorSettingsView({}, {});
    settings.refresh = async () => {};
    await settings.openPanel();
    assert.equal(creationOptions.enableScripts, false);
    assert.deepEqual(settingsEvents, ['create', 'html', 'scripts']);
    settings.dispose();
  } finally {
    if (originalCreateWebviewPanel) mockVscode.window.createWebviewPanel = originalCreateWebviewPanel;
    else delete mockVscode.window;
  }
});

test('settings view routes project knowledge operations and blocks them in Restricted Mode', async () => {
  const originalTrusted = mockVscode.workspace.isTrusted;
  const sent = [];
  const calls = [];
  const settings = Object.create(OrchestratorSettingsView.prototype);
  settings.actions = {
    knowledgeSearchCapabilities: async () => { calls.push(['filters']); return { filters: ['tier', 'kind', 'path_prefix', 'tag', 'pin_first', 'explain'], limit: { minimum: 1, maximum: 100, default: 8 } }; },
    searchKnowledge: async (query, filters, limit) => { calls.push(['search', query, filters, limit]); return { scope: { workspace: 'work', project: 'repo' }, text: 'result', supportedFilters: ['tier', 'kind', 'path_prefix', 'tag', 'pin_first', 'explain'], appliedFilters: Object.keys(filters), limit }; },
    createKnowledgePage: async input => { calls.push(['create', input]); return { scope: { workspace: 'work', project: 'repo' }, page: { path: input.path, pageId: 'page-1' } }; },
    loadKnowledgePage: async pagePath => ({ root: 'C:/repo', scope: { workspace: 'work', project: 'repo' }, page: { path: pagePath, pageId: 'base-1', body: '# Page', sections: [] } }),
    patchKnowledgePage: async (loaded, edit) => { calls.push(['patch', loaded.page.pageId, edit]); return { root: loaded.root, scope: loaded.scope, page: { ...loaded.page, pageId: 'base-2', body: '# Page\n\nUpdated.' } }; },
    updateKnowledgeMetadata: async (loaded, changes) => { calls.push(['metadata', loaded.page.pageId, changes]); return { root: loaded.root, scope: loaded.scope, page: { ...loaded.page, pageId: 'base-3', frontmatter: changes } }; }
  };
  settings.loadedKnowledgePages = new Map();
  settings.refresh = async () => {};
  settings.send = async message => { sent.push(message); };
  try {
    mockVscode.workspace.isTrusted = false;
    await settings.onMessage({ type: 'loadKnowledgeSearchFilters' });
    assert.equal(calls.length, 0);
    await settings.onMessage({ type: 'createKnowledgePage', path: 'knowledge.md', body: '# text' });
    assert.equal(calls.length, 0);
    assert.equal(sent.at(-1).level, 'error');
    await settings.onMessage({ type: 'patchKnowledgePage', pageToken: 'forged', edit: { op: 'append' } });
    await settings.onMessage({ type: 'updateKnowledgeMetadata', pageToken: 'forged', changes: { pinned: true } });
    assert.equal(calls.length, 0);
    mockVscode.workspace.isTrusted = true;
    await settings.onMessage({ type: 'loadKnowledgeSearchFilters' });
    await settings.onMessage({ type: 'searchKnowledge', query: 'architecture', filters: { path_prefix: 'docs/', tag: 'architecture' }, limit: 24, requestId: '1' });
    await settings.onMessage({ type: 'createKnowledgePage', path: 'knowledge.md', body: '# text', tags: 'design,decision' });
    await settings.onMessage({ type: 'loadKnowledgePage', path: 'knowledge.md', requestId: '2' });
    const loaded = sent.find(message => message.type === 'knowledgePageLoaded');
    assert.ok(loaded.pageToken);
    assert.equal(settings.loadedKnowledgePages.get(loaded.pageToken).page.pageId, 'base-1');
    await settings.onMessage({ type: 'patchKnowledgePage', pageToken: loaded.pageToken, edit: { op: 'append', content: 'Updated.' } });
    const latestToken = sent.find(message => message.type === 'knowledgePagePatched').pageToken;
    await settings.onMessage({ type: 'updateKnowledgeMetadata', pageToken: latestToken, changes: { tier: 'semantic', pinned: true } });
    assert.deepEqual(calls, [
      ['filters'],
      ['search', 'architecture', { path_prefix: 'docs/', tag: 'architecture' }, 24],
      ['create', { path: 'knowledge.md', body: '# text', tags: ['design', 'decision'], tier: '', pinned: false, kind: '', sourceFiles: [] }],
      ['patch', 'base-1', { op: 'append', content: 'Updated.' }],
      ['metadata', 'base-2', { tier: 'semantic', pinned: true }]
    ]);
    assert.equal(sent.find(message => message.type === 'knowledgeSearchResult').scope.project, 'repo');
    assert.equal(sent.find(message => message.type === 'knowledgePageCreated').pageId, 'page-1');
    assert.equal(sent.find(message => message.type === 'knowledgePagePatched').page.pageId, 'base-2');
    assert.equal(sent.find(message => message.type === 'knowledgeMetadataUpdated').page.pageId, 'base-3');
    assert.equal(settings.loadedKnowledgePages.has(loaded.pageToken), false);
    assert.equal(settings.loadedKnowledgePages.has(latestToken), false);
  } finally {
    mockVscode.workspace.isTrusted = originalTrusted;
  }
});

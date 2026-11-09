'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
const vscode = {
  lm: {
    tools: [],
    selectChatModels: async () => [],
    accessInformation: { canSendRequest: () => true }
  },
  workspace: { isTrusted: true }
};
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};
const { OrchestratorHomeView } = require('../src/orchestratorHomeView');
Module._load = originalLoad;

test('CLI coordinator receives the trusted workspace instructions before planning', async () => {
  let prompt = '';
  let loadedRoot = '';
  const sent = [];
  const view = Object.create(OrchestratorHomeView.prototype);
  view.threadKey = 'threads';
  view.activeKey = 'active';
  view.memoryToolsByRoot = new Map();
  view.coordinatorProfileAuth = {};
  view.context = {
    workspaceState: {
      get: key => key === 'threads' ? [] : key === 'active' ? undefined : [],
      update: async () => {}
    }
  };
  view.getState = async () => ({
    workspace: 'C:/test/project',
    config: { orchestration: { mode: 'cli', providerId: 'claude', profileId: 'profile-1' }, workerDefaults: {} },
    coordinatorProfiles: [{ id: 'profile-1', providerId: 'claude', name: 'Claude test profile', authorized: true }],
    options: { providers: [{ id: 'claude', name: 'Claude', canCoordinateWithCli: true, canRunClaudeCode: true, cliKind: 'claude' }] }
  });
  view.taskActions = {
    loadProjectGuidance: async root => {
      loadedRoot = root;
      return { text: 'Project instructions, specifications, and skills:\n### AGENTS.md\nFollow the project acceptance criteria.', files: ['AGENTS.md'] };
    },
    checkCoordinatorProfile: async () => ({ status: 'verified' }),
    runCoordinator: async (_profile, _provider, value) => {
      prompt = value;
      return '{"mode":"answer","answer":"ready"}';
    },
    listBranches: async () => [],
    listMemoryTools: async () => []
  };
  view.view = { webview: { postMessage: async message => { sent.push(message); } } };
  view.persistThreads = async () => {};
  view.refreshState = async () => {};

  await view.sendMessage('Inspect this project.');

  assert.equal(loadedRoot, 'C:/test/project');
  assert.match(prompt, /Follow the project acceptance criteria/);
  assert.match(prompt, /Project instructions, specifications, and skills/);
  assert.ok(sent.some(message => message.type === 'busy' && message.value === false));
});

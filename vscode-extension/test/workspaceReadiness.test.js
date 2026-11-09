'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canAutoInstallWorkspaceTools } = require('../src/workspaceReadiness');

test('automatic tool setup waits for a trusted project workspace', () => {
  assert.equal(canAutoInstallWorkspaceTools({ isTrusted: true, workspaceFolders: [{ uri: { fsPath: 'C:/project' } }] }), true);
  assert.equal(canAutoInstallWorkspaceTools({ isTrusted: false, workspaceFolders: [{ uri: { fsPath: 'C:/project' } }] }), false);
  assert.equal(canAutoInstallWorkspaceTools({ isTrusted: true, workspaceFolders: [] }), false);
  assert.equal(canAutoInstallWorkspaceTools({ isTrusted: true }), false);
});

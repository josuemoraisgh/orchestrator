'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { extensionStoragePath } = require('../src/extensionStorage');

test('extension storage path accepts the VS Code global storage URI', () => {
  assert.equal(extensionStoragePath({ globalStorageUri: { fsPath: 'C:\\Users\\test\\globalStorage\\orchestrator-ai' } }), 'C:\\Users\\test\\globalStorage\\orchestrator-ai');
});

test('extension storage path reports a readable error when VS Code omits it', () => {
  assert.throws(() => extensionStoragePath({}), /não forneceu o caminho de armazenamento global da extensão/);
  assert.throws(() => extensionStoragePath({ globalStorageUri: { fsPath: undefined } }), /não forneceu o caminho de armazenamento global da extensão/);
  assert.throws(() => extensionStoragePath(undefined), /não forneceu o caminho de armazenamento global da extensão/);
});

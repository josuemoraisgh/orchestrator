'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { pathIdentity, normalizePathValue, branchNameIdentity } = require('../src/pathIdentity');

test('absolute path identities follow platform case behavior', () => {
  assert.equal(pathIdentity('C:\\Projects\\Orchestrator', 'win32'), 'c:/projects/orchestrator');
  assert.equal(pathIdentity('/home/user/Projects/Orchestrator', 'linux'), '/home/user/Projects/Orchestrator');
  assert.equal(pathIdentity('/home/user/Projects/Orchestrator', 'darwin'), '/home/user/Projects/Orchestrator');
});

test('relative paths and branch names use the same platform identity policy', () => {
  assert.equal(normalizePathValue('Src\\UpperCase.js', 'win32'), 'src/uppercase.js');
  assert.equal(normalizePathValue('Src\\UpperCase.js', 'linux'), 'Src/UpperCase.js');
  assert.equal(branchNameIdentity('refs/heads/Feature/Task', 'win32'), 'feature/task');
  assert.equal(branchNameIdentity('refs/heads/Feature/Task', 'linux'), 'Feature/Task');
});

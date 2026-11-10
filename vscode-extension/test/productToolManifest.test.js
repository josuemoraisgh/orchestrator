'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const manifest = require('../package.json');

test('the Orchestrator chat exposes managed AI Memory, not direct Lich session controls', () => {
  const tools = manifest.contributes.languageModelTools || [];
  assert.equal(tools.some(tool => /lich/i.test(`${tool.name} ${tool.displayName} ${tool.modelDescription}`)), false);
  const checkCommand = manifest.contributes.commands.find(command => command.command === 'orchestratorAi.checkTools');
  assert.equal(checkCommand?.title, 'Orchestrator: Check Managed AI Memory');
});

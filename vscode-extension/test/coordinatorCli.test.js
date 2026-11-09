'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseCodexModelCatalog, resolveCodexModelSelection, runCoordinator } = require('../src/coordinatorCli');

test('Codex coordinator schema can return a structured task handoff request', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-fake-codex-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'codex.cmd');
  const script = path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.mkdir(path.join(root, 'workspace'), { recursive: true });
  await fs.writeFile(executable, '', 'utf8');
  const argsFile = path.join(root, 'coordinator-args.json');
  await fs.writeFile(script, `
    const fs = require('node:fs');
    const path = require('node:path');
    const args = process.argv.slice(2);
    if (args[0] === 'debug' && args[1] === 'models') {
      process.stdout.write(JSON.stringify({ models: [{ slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list', supported_in_api: true, default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }] }] }));
      process.exit(0);
    }
    fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));
    const schemaPath = args[args.indexOf('--output-schema') + 1];
    const answerPath = args[args.indexOf('--output-last-message') + 1];
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    if (!schema.properties.mode.enum.includes('handoff')) process.exit(7);
    const required = schema.properties.handoff.required;
    if (!required.includes('runId') || !required.includes('executor') || !required.includes('context')) process.exit(8);
    fs.writeFileSync(answerPath, JSON.stringify({
      mode: 'handoff', answer: null, plan: null,
      handoff: { runId: 'run-1', taskId: 'task-1', provider: 'claude', executor: 'claude-code-cli', profileId: '', model: '', effort: '', context: 'Continue from the verified task state.' }
    }));
  `, 'utf8');

  const result = await runCoordinator(
    { id: 'default', providerId: 'codex', isolated: false },
    { id: 'codex', name: 'Codex', executablePath: executable },
    path.join(root, 'storage'), path.join(root, 'workspace'), 'Transfer task-1 to Claude.', '', ''
  );
  const parsed = JSON.parse(result);
  assert.equal(parsed.mode, 'handoff');
  assert.equal(parsed.handoff.provider, 'claude');
  const args = JSON.parse(await fs.readFile(argsFile, 'utf8'));
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-5.6-luna');
  assert.ok(args.includes('model_reasoning_effort=low'));
});

test('Codex model catalog exposes only listed API models with their supported effort levels', () => {
  const models = parseCodexModelCatalog(JSON.stringify({ models: [
    {
      slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list', supported_in_api: true,
      default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }]
    },
    { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hidden', supported_in_api: true },
    { slug: 'gpt-unsupported', display_name: 'Unsupported', visibility: 'list', supported_in_api: false },
    { display_name: 'Missing ID', visibility: 'list', supported_in_api: true }
  ] }));

  assert.deepEqual(models, [{
    id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', defaultEffort: 'medium', efforts: ['low', 'medium', 'high']
  }]);
});

test('Codex model catalog rejects invalid and incomplete output', () => {
  assert.throws(() => parseCodexModelCatalog('not JSON'), /invalid model catalog/);
  assert.throws(() => parseCodexModelCatalog('{"items":[]}'), /no model catalog/);
});

test('Codex model selection uses the account catalog and its advertised default effort', () => {
  const models = [{ id: 'gpt-visible', defaultEffort: 'medium', efforts: ['low', 'medium'] }];
  assert.deepEqual(resolveCodexModelSelection(models), { model: 'gpt-visible', effort: 'medium' });
  assert.deepEqual(resolveCodexModelSelection(models, 'gpt-visible', 'low'), { model: 'gpt-visible', effort: 'low' });
});

test('Codex model selection rejects stale models and unsupported effort before dispatch', () => {
  const models = [{ id: 'gpt-visible', defaultEffort: 'medium', efforts: ['low', 'medium'] }];
  assert.throws(() => resolveCodexModelSelection(models, 'gpt-stale'), /not available|não está disponível/i);
  assert.throws(() => resolveCodexModelSelection(models, 'gpt-visible', 'ultra'), /not supported|não é suportado/i);
  assert.throws(() => resolveCodexModelSelection([]), /no models|não anunciou modelos/i);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { prepareProfileHome, profileEnvironment, profileHome } = require('../src/coordinatorCli');

const credentials = [
  'OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN',
  'OPENAI_IDENTITY_TOKEN_FILE', 'OPENAI_FEDERATION_RULE_ID', 'OPENAI_WORKLOAD_IDENTITY_CONTEXT',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'
];

test('isolated provider profiles receive separate homes and no inherited provider credentials', async t => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-profile-isolation-'));
  const previous = new Map(credentials.map(name => [name, process.env[name]]));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousClaudeHome = process.env.CLAUDE_CONFIG_DIR;
  t.after(async () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousClaudeHome === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeHome;
    await fs.rm(storage, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  for (const name of credentials) process.env[name] = `must-not-leak-${name}`;
  process.env.CODEX_HOME = 'inherited-codex-home';
  process.env.CLAUDE_CONFIG_DIR = 'inherited-claude-home';

  const firstCodex = { id: '11111111-1111-4111-8111-111111111111', providerId: 'codex', isolated: true };
  const secondCodex = { id: '22222222-2222-4222-8222-222222222222', providerId: 'codex', isolated: true };
  const claude = { id: '33333333-3333-4333-8333-333333333333', providerId: 'claude', isolated: true };
  const defaultCodex = { id: 'default-codex-cli-profile', providerId: 'codex', isolated: false };
  const defaultClaude = { id: 'default-claude-cli-profile', providerId: 'claude', isolated: false };
  const codexHomeA = profileHome(firstCodex, storage);
  const codexHomeB = profileHome(secondCodex, storage);
  const claudeHome = profileHome(claude, storage);

  assert.notEqual(codexHomeA, codexHomeB);
  assert.equal(profileEnvironment(firstCodex, storage).CODEX_HOME, codexHomeA);
  assert.equal(profileEnvironment(secondCodex, storage).CODEX_HOME, codexHomeB);
  assert.equal(profileEnvironment(claude, storage).CLAUDE_CONFIG_DIR, claudeHome);
  for (const profile of [firstCodex, secondCodex]) {
    assert.equal(profileEnvironment(profile, storage).CLAUDE_CONFIG_DIR, undefined, 'the isolated Codex profile must not inherit a Claude account directory');
  }
  assert.equal(profileEnvironment(claude, storage).CODEX_HOME, undefined, 'the isolated Claude profile must not inherit a Codex account directory');
  for (const name of credentials) {
    assert.equal(profileEnvironment(firstCodex, storage)[name], undefined, `${name} leaked into Codex profile`);
    assert.equal(profileEnvironment(claude, storage)[name], undefined, `${name} leaked into Claude profile`);
  }
  const codexEnv = profileEnvironment(defaultCodex, storage);
  for (const name of credentials.filter(name => name.startsWith('ANTHROPIC_') || name.startsWith('CLAUDE_'))) {
    assert.equal(codexEnv[name], undefined, `${name} leaked into the default Codex profile`);
  }
  assert.equal(codexEnv.OPENAI_API_KEY, process.env.OPENAI_API_KEY, 'the default Codex profile retains its own environment authentication');
  assert.equal(codexEnv.CODEX_HOME, 'inherited-codex-home', 'the default Codex profile retains its configured CLI home');
  assert.equal(codexEnv.CLAUDE_CONFIG_DIR, undefined);
  const claudeEnv = profileEnvironment(defaultClaude, storage);
  for (const name of credentials.filter(name => name.startsWith('OPENAI_') || name.startsWith('CODEX_'))) {
    assert.equal(claudeEnv[name], undefined, `${name} leaked into the default Claude profile`);
  }
  assert.equal(claudeEnv.ANTHROPIC_API_KEY, process.env.ANTHROPIC_API_KEY, 'the default Claude profile retains its own environment authentication');
  assert.equal(claudeEnv.CLAUDE_CONFIG_DIR, 'inherited-claude-home', 'the default Claude profile retains its configured CLI home');
  assert.equal(claudeEnv.CODEX_HOME, undefined);
  assert.equal(process.env.CODEX_HOME, 'inherited-codex-home');
  assert.equal(process.env.CLAUDE_CONFIG_DIR, 'inherited-claude-home');

  await Promise.all([firstCodex, secondCodex].map(profile => prepareProfileHome(profile, storage)));
  await prepareProfileHome(claude, storage);
  for (const home of [codexHomeA, codexHomeB]) {
    assert.equal(await fs.readFile(path.join(home, 'config.toml'), 'utf8'), 'cli_auth_credentials_store = "file"\n');
  }
  assert.equal(await fs.stat(claudeHome).then(info => info.isDirectory()), true);
});

test('isolated profile IDs cannot escape the extension-owned storage directory', () => {
  assert.throws(() => profileHome({ id: '..\\outside', providerId: 'codex', isolated: true }, 'C:/storage'), /inválido|invalid/i);
});

test('isolated Codex setup preserves and rejects unexpected existing configuration', async t => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-profile-config-'));
  const profile = { id: '44444444-4444-4444-8444-444444444444', providerId: 'codex', isolated: true };
  const home = profileHome(profile, storage);
  t.after(() => fs.rm(storage, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
  await fs.mkdir(home, { recursive: true });
  const config = path.join(home, 'config.toml');
  await fs.writeFile(config, 'model = "user-value"\n', 'utf8');

  await assert.rejects(prepareProfileHome(profile, storage), /cli_auth_credentials_store.*file/i);
  assert.equal(await fs.readFile(config, 'utf8'), 'model = "user-value"\n');
});

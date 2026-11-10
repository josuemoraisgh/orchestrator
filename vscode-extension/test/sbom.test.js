'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('release SBOM records the complete locked runtime closure and bundled licenses', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-sbom-test-'));
  const generatedPath = path.join(tempDir, 'sbom.cdx.json');
  try {
    const generated = spawnSync(process.execPath, ['scripts/create-sbom.js', '--output', generatedPath], { cwd: root, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    const bom = JSON.parse(fs.readFileSync(generatedPath, 'utf8'));
    assert.equal(bom.bomFormat, 'CycloneDX');
    assert.equal(bom.specVersion, '1.5');
    const components = new Map(bom.components.map(component => [component.name, component]));
    assert.deepEqual([...components.keys()].sort(), [
      'AI Memory', 'graceful-fs', 'ignore', 'pend', 'proper-lockfile', 'retry', 'signal-exit', 'yauzl'
    ]);
    assert.equal(components.get('AI Memory').licenses[0].license.id, 'MIT');
    assert.match(components.get('AI Memory').hashes[0].content, /^[a-f0-9]{64}$/);

    const expectedLicenses = {
      'graceful-fs': 'ISC', ignore: 'MIT', pend: 'MIT', 'proper-lockfile': 'MIT',
      retry: 'MIT', 'signal-exit': 'ISC', yauzl: 'MIT'
    };
    for (const [name, license] of Object.entries(expectedLicenses)) {
      const component = components.get(name);
      assert.equal(component.licenses[0].license.id, license, name);
      assert.ok(component.hashes?.length, `${name} needs a locked package hash`);
      const lockPath = `node_modules/${name}`;
      const packageRoot = path.join(root, lockPath);
      const files = fs.readdirSync(packageRoot);
      assert.ok(files.some(file => /^(license|copying|notice)/i.test(file)), `${name} license file must ship`);
    }
    assert.ok(!components.has('@vscode/vsce'), 'development packaging tools must not be listed as runtime components');
    const rootDependencies = bom.dependencies.find(entry => entry.ref === `orchestrator-ai@${bom.metadata.component.version}`);
    const upstreamReleases = JSON.parse(fs.readFileSync(path.join(root, 'upstream-releases.json'), 'utf8'));
    const aiMemoryVersion = upstreamReleases.aiMemory.version.replace(/^v/, '');
    assert.ok(rootDependencies.dependsOn.includes(`pkg:github/akitaonrails/ai-memory@${aiMemoryVersion}`));
    assert.ok(rootDependencies.dependsOn.includes('pkg:npm/ignore@7.0.14'));
    assert.ok(rootDependencies.dependsOn.includes('pkg:npm/proper-lockfile@4.1.2'));
    assert.ok(rootDependencies.dependsOn.includes('pkg:npm/yauzl@3.4.0'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

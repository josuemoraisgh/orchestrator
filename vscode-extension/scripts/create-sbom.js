'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const upstreams = JSON.parse(fs.readFileSync(path.join(root, 'upstream-releases.json'), 'utf8'));
const lockPackages = lock.packages || {};

function resolvePackage(parentPath, name) {
  let current = parentPath;
  while (true) {
    const candidate = path.posix.join(current, 'node_modules', name);
    if (lockPackages[candidate]) return candidate;
    if (!current) break;
    const parent = path.posix.dirname(current);
    current = parent === '.' ? '' : parent;
  }
  throw new Error(`The production dependency ${name} is missing from package-lock.json.`);
}

function licenseId(value, name) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && typeof value.type === 'string' && value.type.trim()) return value.type.trim();
  throw new Error(`The production dependency ${name} has no SPDX license in package-lock.json.`);
}

function packageComponent(lockPath) {
  const entry = lockPackages[lockPath];
  const packageName = lockPath.split('node_modules/').at(-1);
  const packageJsonPath = path.join(root, lockPath, 'package.json');
  const packageJson = fs.existsSync(packageJsonPath) ? JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) : {};
  const name = packageJson.name || packageName;
  const version = String(entry.version || packageJson.version || '');
  if (!version) throw new Error(`The production dependency ${name} has no locked version.`);
  const hashes = [];
  for (const token of String(entry.integrity || '').split(/\s+/).filter(Boolean)) {
    const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/.exec(token);
    if (match) hashes.push({ alg: match[1].toUpperCase().replace('SHA', 'SHA-'), content: Buffer.from(match[2], 'base64').toString('hex') });
  }
  const externalReferences = [];
  if (entry.resolved) externalReferences.push({ type: 'distribution', url: entry.resolved });
  const repository = packageJson.repository?.url || packageJson.repository;
  if (typeof repository === 'string' && repository) externalReferences.push({ type: 'vcs', url: repository.replace(/^git\+/, '') });
  if (packageJson.homepage) externalReferences.push({ type: 'website', url: packageJson.homepage });
  return {
    'bom-ref': `pkg:npm/${name.replace(/^@/, '%40')}@${version}`,
    type: 'library', name, version, scope: 'required',
    ...(packageJson.author ? { author: typeof packageJson.author === 'string' ? packageJson.author : packageJson.author.name } : {}),
    ...(packageJson.description ? { description: packageJson.description } : {}),
    purl: `pkg:npm/${name.replace(/^@/, '%40')}@${version}`,
    ...(externalReferences.length ? { externalReferences } : {}),
    ...(hashes.length ? { hashes } : {}),
    licenses: [{ license: { id: licenseId(entry.license || packageJson.license, name) } }]
  };
}

const components = new Map();
const dependencies = new Map();
function visit(lockPath) {
  if (components.has(lockPath)) return;
  const component = packageComponent(lockPath);
  components.set(lockPath, component);
  const entry = lockPackages[lockPath];
  const refs = [];
  for (const dependencyName of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
    const dependencyPath = resolvePackage(lockPath, dependencyName);
    refs.push(packageComponentRef(dependencyPath));
    visit(dependencyPath);
  }
  dependencies.set(component['bom-ref'], [...new Set(refs)]);
}

function packageComponentRef(lockPath) {
  const entry = lockPackages[lockPath];
  const name = lockPath.split('node_modules/').at(-1);
  return `pkg:npm/${name.replace(/^@/, '%40')}@${entry.version}`;
}

const rootPackage = lockPackages[''] || {};
const directReferences = [];
for (const dependencyName of Object.keys(rootPackage.dependencies || manifest.dependencies || {})) {
  const dependencyPath = resolvePackage('', dependencyName);
  directReferences.push(packageComponentRef(dependencyPath));
  visit(dependencyPath);
}

const aiMemory = upstreams.aiMemory;
if (!aiMemory?.version || !/^([0-9a-f]{64})$/i.test(aiMemory.windowsX64?.sha256 || '') || !aiMemory.windowsX64?.url) {
  throw new Error('The pinned AI Memory release is missing its version, Windows asset URL, or SHA-256 digest.');
}
const memoryVersion = String(aiMemory.version).replace(/^v/, '');
const aiMemoryRef = `pkg:github/akitaonrails/ai-memory@${memoryVersion}`;
components.set('external:ai-memory', {
  'bom-ref': aiMemoryRef,
  type: 'application',
  name: 'AI Memory',
  version: memoryVersion,
  scope: 'required',
  purl: aiMemoryRef,
  externalReferences: [
    { type: 'distribution', url: aiMemory.windowsX64.url },
    { type: 'vcs', url: `https://github.com/${aiMemory.repository}` }
  ],
  hashes: [{ alg: 'SHA-256', content: aiMemory.windowsX64.sha256.toLowerCase() }],
  licenses: [{ license: { id: 'MIT' } }],
  properties: [{ name: 'orchestrator:delivery', value: 'downloaded-at-runtime-and-digest-verified' }]
});
dependencies.set(aiMemoryRef, []);
directReferences.push(aiMemoryRef);

const rootRef = `${manifest.name}@${manifest.version}`;
const bom = {
  $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    lifecycles: [{ phase: 'build' }],
    tools: [{ vendor: 'npm', name: 'orchestrator-ai-sbom-generator', version: '1.0.0' }],
    component: {
      'bom-ref': rootRef, type: 'application', name: manifest.displayName || manifest.name,
      version: manifest.version, scope: 'required', description: manifest.description,
      purl: `pkg:npm/${manifest.name}@${manifest.version}`,
      licenses: [{ license: { id: manifest.license || 'NOASSERTION' } }]
    }
  },
  components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
  dependencies: [
    { ref: rootRef, dependsOn: [...new Set(directReferences)].sort() },
    ...[...dependencies.entries()].map(([ref, dependsOn]) => ({ ref, dependsOn: dependsOn.sort() })).sort((a, b) => a.ref.localeCompare(b.ref))
  ]
};

fs.writeFileSync(path.join(root, 'sbom.cdx.json'), `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
process.stdout.write(`Wrote CycloneDX SBOM with ${bom.components.length} runtime components to vscode-extension/sbom.cdx.json\n`);

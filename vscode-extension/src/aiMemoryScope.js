const fs = require('node:fs/promises');
const path = require('node:path');

const SAFE_SCOPE_NAME = /^[a-z0-9][a-z0-9._-]*$/;

function parseAiMemoryMarker(text) {
  const values = {};
  let inSection = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) { inSection = true; continue; }
    if (inSection) continue;
    const match = line.match(/^(workspace|project|identity|project_strategy)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function projectFromRemote(remote, identityStyle = 'path') {
  let value = String(remote || '').trim();
  if (!value) return '';
  value = value.replace(/\.git$/i, '');
  let hostAndPath = '';
  const url = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)\/(.+)$/i);
  if (url) hostAndPath = `${url[1]}/${url[2]}`;
  else {
    const scp = value.match(/^(?:[^@/]+@)?([^:]+):(.+)$/);
    if (scp) hostAndPath = `${scp[1]}/${scp[2]}`;
    else hostAndPath = value.replace(/^[\\/]+/, '');
  }
  const projectPath = identityStyle === 'host_path' ? hostAndPath : hostAndPath.includes('/') ? hostAndPath.slice(hostAndPath.indexOf('/') + 1) : hostAndPath;
  const project = projectPath.split('/').filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[^a-z0-9]+/, '');
  return SAFE_SCOPE_NAME.test(project) ? project : '';
}

async function findMarker(root, homeDir = process.env.USERPROFILE || process.env.HOME || '', repoRoot = '') {
  const absoluteRoot = path.resolve(root);
  const absoluteHome = homeDir ? path.resolve(homeDir) : '';
  const absoluteRepoRoot = repoRoot ? path.resolve(repoRoot) : absoluteRoot;
  const stopAt = absoluteHome && isInside(absoluteHome, absoluteRoot) ? absoluteHome : absoluteRepoRoot;
  let current = absoluteRoot;
  for (;;) {
    try { return { path: path.join(current, '.ai-memory.toml'), values: parseAiMemoryMarker(await fs.readFile(path.join(current, '.ai-memory.toml'), 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    if (current === stopAt) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { path: '', values: {} };
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveAiMemoryScope(root, options = {}) {
  const configured = options.config || {};
  const repoRoot = typeof options.getRepoRoot === 'function' ? await options.getRepoRoot(root) : '';
  const marker = await findMarker(root, options.homeDir, repoRoot);
  const values = marker.values;
  let workspace = String(configured.workspace || values.workspace || 'default').trim();
  let project = String(configured.project || values.project || '').trim();
  let source = configured.workspace && configured.project ? 'settings' : marker.path ? marker.path : 'repository defaults';

  if (!project && values.identity) project = values.identity.replace(/\//g, '-').toLowerCase();
  if (!project && typeof options.getRemote === 'function') {
    project = projectFromRemote(await options.getRemote(root), values.identity_style || 'path');
  }
  if (!project) {
    const fallback = values.project_strategy === 'repo-root' && repoRoot ? repoRoot : root;
    project = path.basename(path.resolve(fallback)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '');
  }
  if (!SAFE_SCOPE_NAME.test(workspace) || !SAFE_SCOPE_NAME.test(project)) {
    throw new Error(`AI Memory scope is invalid (${workspace}/${project}). Use lowercase letters, digits, dots, dashes, and underscores; configure workspace and project in Orchestrator settings.`);
  }
  return { workspace, project, source };
}

module.exports = { findMarker, parseAiMemoryMarker, projectFromRemote, resolveAiMemoryScope };

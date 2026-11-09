'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function escapes(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

async function resolveUpstreamDirectory(workspaceRoot, configuredPath) {
  const relativePath = String(configuredPath || '').trim();
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Upstream path must be a non-empty relative path: ${relativePath || '(empty)'}`);
  }

  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath);
  if (escapes(root, target)) throw new Error(`Upstream path escapes workspace: ${relativePath}`);

  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  if (escapes(realRoot, realTarget)) {
    throw new Error(`Upstream path resolves outside the workspace: ${relativePath}`);
  }

  const stat = await fs.stat(realTarget);
  if (!stat.isDirectory()) throw new Error(`Upstream path is not a directory: ${relativePath}`);
  return realTarget;
}

module.exports = { resolveUpstreamDirectory };

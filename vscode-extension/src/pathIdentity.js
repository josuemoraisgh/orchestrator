'use strict';

const path = require('node:path');

function normalizePathValue(value, platform = process.platform) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathIdentity(value, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return normalizePathValue(pathApi.resolve(String(value || '')), platform);
}

function branchNameIdentity(value, platform = process.platform) {
  const branch = String(value || '').replace(/^refs\/heads\//, '');
  return platform === 'win32' ? branch.toLowerCase() : branch;
}

module.exports = { pathIdentity, normalizePathValue, branchNameIdentity };

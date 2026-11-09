'use strict';

function normalizeSourcePath(value) {
  const file = String(value || '').trim().replaceAll('\\', '/');
  if (!file || file.startsWith('/') || /^[a-z]:/i.test(file) || file.split('/').some(part => !part || part === '.' || part === '..') || /[\r\n\0]/.test(file)) {
    throw new Error(`Invalid Git source path: ${file || '(empty)'}`);
  }
  return file;
}

async function verifyKnowledgeSourceFiles(root, requestedPaths, runOutcome) {
  const paths = [...new Set((Array.isArray(requestedPaths) ? requestedPaths : []).map(normalizeSourcePath))];
  if (paths.length > 16) throw new Error('AI Memory supports at most 16 source files per page.');
  if (!paths.length) return [];
  if (typeof runOutcome !== 'function') throw new Error('Git source verification is unavailable.');
  const head = await runOutcome('git', ['rev-parse', '--verify', 'HEAD'], root, 10000);
  if (head.code !== 0 || !/^[a-f0-9]{7,64}$/i.test(head.stdout)) throw new Error('Could not verify the Git commit for source provenance.');
  const verified = [];
  for (const file of paths) {
    const tracked = await runOutcome('git', ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', file], root, 10000);
    if (tracked.code !== 0 || !tracked.stdout) throw new Error(`Source file ${file} is not tracked by this project's Git repository.`);
    const status = await runOutcome('git', ['--literal-pathspecs', 'status', '--porcelain', '--untracked-files=no', '--', file], root, 10000);
    if (status.code !== 0 || status.stdout) throw new Error(`Source file ${file} has local changes; commit it or remove it from the provenance list.`);
    verified.push({ path: tracked.stdout.replaceAll('\\', '/'), commit: head.stdout });
  }
  return verified;
}

module.exports = { normalizeSourcePath, verifyKnowledgeSourceFiles };

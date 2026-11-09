'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ignore = require('ignore');

const MAX_INCLUDED_FILES = 250;
const MAX_INCLUDED_FILE_BYTES = 64 * 1024 * 1024;
const MAX_INCLUDED_TOTAL_BYTES = 256 * 1024 * 1024;

function git(args, cwd, timeout = 20000) {
  // Git for Windows otherwise rejects paths beyond MAX_PATH while checking
  // files in an existing checkout (notably deeply nested node_modules).
  // Scope the setting to each Orchestrator invocation; do not mutate user or
  // repository Git configuration.
  return new Promise((resolve, reject) => execFile('git', ['-c', 'core.longpaths=true', ...args], { cwd, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      error.message = (stderr || stdout || error.message || 'Git command failed').trim();
      reject(error);
    } else resolve(args.includes('-z') ? String(stdout || '') : String(stdout || '').trim());
  }));
}

function parseWorktrees(output) {
  return String(output || '').split(/\r?\n\r?\n/).filter(Boolean).map(block => {
    const item = {};
    for (const line of block.split(/\r?\n/)) {
      if (!line) continue;
      const index = line.indexOf(' ');
      if (index < 0) { item[line] = true; continue; }
      item[line.slice(0, index)] = line.slice(index + 1);
    }
    return item;
  });
}

function safePart(value) {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return cleaned || 'task';
}

function includePatternMatches(relativePath, pattern) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const source = String(pattern || '').trim();
  if (!normalized || !source || source.startsWith('!') || source.startsWith('#')) return false;
  return ignore().add(source).ignores(normalized);
}

function isIncludedPath(relativePath, patterns) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const rules = patterns.map(pattern => String(pattern || '').trim()).filter(Boolean);
  return Boolean(normalized && rules.length && ignore().add(rules).ignores(normalized));
}

class GitWorktrees {
  constructor(storageRoot) { this.storageRoot = path.resolve(storageRoot); }

  async open(projectRoot, { runId, taskId, attempt, branch: requestedBranch, baseBranch, existingPath, seedIncludedFiles = false } = {}) {
    const root = await git(['rev-parse', '--show-toplevel'], projectRoot);
    if (existingPath) {
      const target = path.resolve(existingPath);
      const entries = parseWorktrees(await git(['worktree', 'list', '--porcelain'], root));
      const canonicalTarget = await fs.realpath(target);
      const match = await Promise.all(entries.map(async item => ({ item, canonical: item.worktree ? await fs.realpath(item.worktree).catch(() => '') : '' })))
        .then(items => items.find(value => value.canonical.toLowerCase() === canonicalTarget.toLowerCase())?.item);
      if (!match) throw new Error('O checkout salvo não aparece na lista oficial de worktrees do Git.');
      const branch = String(match.branch || '').replace(/^refs\/heads\//, '');
      let includedFiles = [];
      try { if (seedIncludedFiles) includedFiles = await this.copyIncludedIgnoredFiles(root, target); }
      catch (error) { error.worktreePath = target; error.worktreeBranch = branch; throw error; }
      return { path: target, branch, reused: true, projectRoot: root, includedFiles };
    }

    const branch = requestedBranch
      ? String(requestedBranch).replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/^\/+|\/+$/g, '').slice(0, 100)
      : `orchestrator/${safePart(runId)}-${safePart(taskId)}-${Math.max(1, Number(attempt) || 1)}`;
    if (!branch || branch.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Nome de branch inválido para worktree.');
    const entries = parseWorktrees(await git(['worktree', 'list', '--porcelain'], root));
    const existingBranch = entries.find(item => String(item.branch || '').replace(/^refs\/heads\//, '').toLowerCase() === branch.toLowerCase());
    if (existingBranch) throw new Error(`A branch ${branch} já está associada à worktree ${existingBranch.worktree || '(caminho desconhecido)'}.`);
    const branchCheck = await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], root).then(() => true, error => error.code === 1 ? false : Promise.reject(error));
    if (branchCheck) throw new Error(`A branch ${branch} já existe; escolha outro nome para evitar reutilizar trabalho sem confirmação.`);
    let baseRef = 'HEAD';
    if (baseBranch) {
      const requestedBase = String(baseBranch).trim();
      if (!requestedBase || requestedBase.length > 200 || requestedBase.startsWith('-') || requestedBase.includes('..') || requestedBase.includes('//') || requestedBase.endsWith('/') || requestedBase.endsWith('.')) {
        throw new Error(`Nome de branch base invÃ¡lido: ${requestedBase}`);
      }
      const baseRefName = `refs/heads/${requestedBase}`;
      baseRef = await git(['rev-parse', '--verify', '--quiet', `${baseRefName}^{commit}`], root)
        .catch(() => { throw new Error(`A branch base local ${requestedBase} nÃ£o existe ou nÃ£o aponta para um commit.`); });
    }
    const repoKey = crypto.createHash('sha256').update(root.toLocaleLowerCase()).digest('hex').slice(0, 20);
    const target = path.join(this.storageRoot, 'worktrees', repoKey, `${safePart(runId)}-${safePart(taskId)}-${Math.max(1, Number(attempt) || 1)}`);
    try { await fs.access(target); throw new Error(`O caminho da worktree já existe: ${target}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await git(['worktree', 'add', '-b', branch, target, baseRef], root, 120000);
    let includedFiles = [];
    try { includedFiles = await this.copyIncludedIgnoredFiles(root, target); }
    catch (error) {
      error.message = `A worktree foi criada, mas os arquivos locais selecionados em .worktreeinclude não puderam ser copiados: ${error.message}`;
      error.worktreePath = target;
      error.worktreeBranch = branch;
      throw error;
    }
    return { path: target, branch, baseBranch: baseBranch || 'HEAD', reused: false, projectRoot: root, includedFiles };
  }

  async copyIncludedIgnoredFiles(projectRoot, worktreePath) {
    const includeFile = path.join(projectRoot, '.worktreeinclude');
    let source;
    try { source = await fs.readFile(includeFile, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const patterns = source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    if (!patterns.length) return [];
    const output = await git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], projectRoot, 30000);
    const candidates = output.split('\0').filter(relative => relative && isIncludedPath(relative, patterns));
    if (candidates.length > MAX_INCLUDED_FILES) throw new Error(`A seleção excede o limite de ${MAX_INCLUDED_FILES} arquivos.`);
    const sourceRoot = await fs.realpath(projectRoot);
    const targetRoot = await fs.realpath(worktreePath);
    const copied = [];
    let totalBytes = 0;
    for (const relative of candidates) {
      const segments = relative.split(/[\\/]+/);
      if (path.isAbsolute(relative) || segments.some(segment => !segment || segment === '.' || segment === '..')) continue;
      const sourcePath = path.join(sourceRoot, ...segments);
      const targetPath = path.join(targetRoot, ...segments);
      if (!isWithin(sourceRoot, sourcePath) || !isWithin(targetRoot, targetPath)) continue;
      let sourceParent = sourceRoot;
      let unsafeSourceParent = false;
      for (const segment of segments.slice(0, -1)) {
        sourceParent = path.join(sourceParent, segment);
        const parentStat = await fs.lstat(sourceParent).catch(() => undefined);
        if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) { unsafeSourceParent = true; break; }
      }
      if (unsafeSourceParent) continue;
      const sourceStat = await fs.lstat(sourcePath).catch(() => undefined);
      if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) continue;
      if (sourceStat.size > MAX_INCLUDED_FILE_BYTES || totalBytes + sourceStat.size > MAX_INCLUDED_TOTAL_BYTES) {
        throw new Error(`A seleção excede o limite de ${MAX_INCLUDED_TOTAL_BYTES / (1024 * 1024)} MiB ou um arquivo ultrapassa ${MAX_INCLUDED_FILE_BYTES / (1024 * 1024)} MiB.`);
      }
      let parent = targetRoot;
      let unsafeParent = false;
      for (const segment of segments.slice(0, -1)) {
        parent = path.join(parent, segment);
        const parentStat = await fs.lstat(parent).catch(() => undefined);
        if (parentStat?.isSymbolicLink() || (parentStat && !parentStat.isDirectory())) { unsafeParent = true; break; }
        if (!parentStat) await fs.mkdir(parent);
      }
      if (unsafeParent) continue;
      const existing = await fs.lstat(targetPath).catch(() => undefined);
      if (existing) continue;
      await fs.copyFile(sourcePath, targetPath, require('node:fs').constants.COPYFILE_EXCL);
      totalBytes += sourceStat.size;
      copied.push(relative.replace(/\\/g, '/'));
    }
    return copied;
  }

  async inspect(projectRoot) {
    const root = await git(['rev-parse', '--show-toplevel'], projectRoot);
    return parseWorktrees(await git(['worktree', 'list', '--porcelain'], root));
  }

  async listBranches(projectRoot) {
    const root = await git(['rev-parse', '--show-toplevel'], projectRoot);
    return (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], root))
      .split(/\r?\n/).map(branch => branch.trim()).filter(Boolean).slice(0, 100);
  }
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

module.exports = { GitWorktrees, parseWorktrees, safePart, includePatternMatches, isIncludedPath };

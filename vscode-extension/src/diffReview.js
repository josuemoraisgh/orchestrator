'use strict';

function normalizeDiffPath(value) {
  const input = String(value || '').replaceAll('\\', '/').trim();
  if (!input || input.startsWith('/') || /^[A-Za-z]:/.test(input)) return '';
  const parts = input.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return '';
  return parts.join('/');
}

function parseAddedDiffLines(diffText) {
  const files = new Map();
  let currentPath = '';
  let newLine = 0;
  let inHunk = false;
  for (const line of String(diffText || '').split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const rawPath = line.slice(4).replace(/^b\//, '');
      currentPath = rawPath === '/dev/null' ? '' : normalizeDiffPath(rawPath);
      inHunk = false;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = Boolean(currentPath);
      continue;
    }
    if (!inHunk || !line || line.startsWith('\\')) continue;
    if (line[0] === '+') {
      if (!files.has(currentPath)) files.set(currentPath, new Set());
      files.get(currentPath).add(newLine++);
    } else if (line[0] === ' ') newLine++;
  }
  return files;
}

function validateAddedDiffLocation(diffText, filePath, lineNumber) {
  const normalizedPath = normalizeDiffPath(filePath);
  const line = Number(lineNumber);
  if (!normalizedPath || !Number.isSafeInteger(line) || line < 1) {
    return { valid: false, reason: 'Informe um caminho relativo e um número de linha válido.' };
  }
  const files = parseAddedDiffLines(diffText);
  if (!files.get(normalizedPath)?.has(line)) {
    return { valid: false, reason: `A linha ${normalizedPath}:${line} não é uma linha adicionada na diff atual da tarefa.` };
  }
  return { valid: true, path: normalizedPath, line };
}

module.exports = { normalizeDiffPath, parseAddedDiffLines, validateAddedDiffLocation };

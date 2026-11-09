'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { redactSensitiveText } = require('./secretRedaction');

const MAX_GUIDANCE_FILES = 40;
const MAX_GUIDANCE_FILE_BYTES = 64 * 1024;
const MAX_GUIDANCE_FILE_CHARS = 6000;
const MAX_GUIDANCE_CHARS = 18000;

async function collectMarkdown(root, directory, relativeDirectory, output, depth = 0) {
  if (depth > 6 || output.length >= MAX_GUIDANCE_FILES) return;
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    const realDirectory = await fs.realpath(directory);
    const relative = path.relative(root, realDirectory);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error(`Could not read project guidance directory ${relativeDirectory}: ${error.message || error}`);
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (output.length >= MAX_GUIDANCE_FILES) return;
    if (entry.isSymbolicLink()) continue;
    const relative = path.posix.join(relativeDirectory, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      await collectMarkdown(root, absolute, relative, output, depth + 1);
    } else if (entry.isFile() && /\.(?:md|instructions\.md)$/i.test(entry.name)) {
      output.push({ absolute, relative });
    }
  }
}

async function loadProjectGuidance(projectRoot) {
  if (!projectRoot) return { text: '', files: [], truncated: false };
  const root = await fs.realpath(projectRoot);
  const files = [];
  const rootInstructions = path.join(root, 'AGENTS.md');
  try {
    const stat = await fs.lstat(rootInstructions);
    if (stat.isFile() && !stat.isSymbolicLink()) files.push({ absolute: rootInstructions, relative: 'AGENTS.md' });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const copilotInstructions = path.join(root, '.github', 'copilot-instructions.md');
  try {
    const stat = await fs.lstat(copilotInstructions);
    if (stat.isFile() && !stat.isSymbolicLink()) files.push({ absolute: copilotInstructions, relative: '.github/copilot-instructions.md' });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  for (const directory of ['.ai/specs', '.ai/skills', '.github/instructions']) {
    await collectMarkdown(root, path.join(root, directory), directory, files);
  }
  const uniqueFiles = [...new Map(files.map(file => [file.relative, file])).values()].slice(0, MAX_GUIDANCE_FILES);
  const sections = [];
  const contextHeader = 'Project instructions, specifications, and skills (from the trusted workspace; follow relevant rules unless they conflict with the user request or security constraints):\n';
  const truncationNotice = '[Some project guidance files were omitted or truncated to keep the coordinator context bounded.]';
  let usedChars = 0;
  let truncated = files.length > uniqueFiles.length;
  for (const file of uniqueFiles) {
    const relative = path.relative(root, file.absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const stat = await fs.lstat(file.absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_GUIDANCE_FILE_BYTES) {
      truncated = true;
      continue;
    }
    const realFile = await fs.realpath(file.absolute);
    const realRelative = path.relative(root, realFile);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) continue;
    const body = await fs.readFile(realFile, 'utf8');
    if (body.includes('\u0000')) continue;
    const heading = `### ${file.relative}\n`;
    const separators = sections.length ? 2 : 0;
    const noticeReserve = truncationNotice.length + 2;
    const remaining = MAX_GUIDANCE_CHARS - contextHeader.length - usedChars - separators - heading.length - noticeReserve;
    if (remaining <= 0) { truncated = true; break; }
    const content = redactSensitiveText(body, Math.min(MAX_GUIDANCE_FILE_CHARS, remaining));
    if (content.length < body.length) truncated = true;
    const section = heading + content;
    sections.push(section);
    usedChars += separators + section.length;
  }
  if (truncated) sections.push(truncationNotice);
  const text = sections.length
    ? `${contextHeader}${sections.join('\n\n')}`
    : 'No AGENTS.md, Copilot instructions, or .ai specs/skills Markdown files were found in the project workspace.';
  return {
    text,
    files: sections.filter(section => section.startsWith('### ')).map(section => section.slice(4, section.indexOf('\n'))),
    truncated
  };
}

module.exports = { loadProjectGuidance };

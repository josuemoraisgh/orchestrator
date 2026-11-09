'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCreatePageInput, buildKnowledgePatchInput, buildPageMetadataUpdateInput, buildScopedQueryInput, safePagePath, supportedKnowledgeQueryFilters } = require('../src/aiMemoryKnowledge');

const scope = { workspace: 'work', project: 'repo' };

test('scoped memory search follows the official query schema and project scope', () => {
  const tool = { name: 'memory_query', inputSchema: { properties: {
    workspace: { type: 'string' }, project: { type: 'string' }, query: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 12 }
  } } };
  assert.deepEqual(buildScopedQueryInput(tool, 'architecture decision', scope, 50), {
    query: 'architecture decision', limit: 12, workspace: 'work', project: 'repo'
  });
});

test('knowledge search applies only declared filters and refuses to ignore selected filters', () => {
  const tool = { name: 'memory_query', inputSchema: { properties: {
    workspace: { type: 'string' }, project: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 12 },
    tier: { type: 'string' }, kind: { type: 'string' }, path_prefix: { type: 'string' }, tag: { type: 'string' }, pin_first: { type: 'boolean' }
  } } };
  assert.deepEqual(supportedKnowledgeQueryFilters(tool), ['kind', 'tier', 'path_prefix', 'tag', 'pin_first']);
  assert.deepEqual(buildScopedQueryInput(tool, 'architecture', scope, 5, { tier: 'procedural', kind: 'decision', path_prefix: 'docs/architecture', tag: 'design', pin_first: true }), {
    query: 'architecture', limit: 5, workspace: 'work', project: 'repo', tier: 'procedural', kind: 'decision', path_prefix: 'docs/architecture', tag: 'design', pin_first: true
  });
  assert.throws(() => buildScopedQueryInput(tool, 'architecture', scope, 5, { include_superseded: true }), /does not declare|não declara/);
  assert.throws(() => buildScopedQueryInput(tool, 'architecture', scope, 5, { path_prefix: '../secrets' }), /prefixo relativo/i);
});

test('knowledge page creation is create-only and includes the resolved scope', () => {
  const tool = { name: 'memory_write_page', inputSchema: { properties: {
    workspace: { type: 'string' }, project: { type: 'string' }, path: { type: 'string' },
    body: { type: 'string' }, tags: { type: 'array' }, create_only: { type: 'boolean' }
  } } };
  assert.deepEqual(buildCreatePageInput(tool, scope, 'orchestrator/knowledge/runtime.md', '# Runtime\n\nUse Node.', ['decision', 'decision', '']), {
    workspace: 'work', project: 'repo', path: 'orchestrator/knowledge/runtime.md',
    body: '# Runtime\n\nUse Node.', tags: ['decision'], create_only: true
  });
});

test('durable page creation applies supported tier, pin, semantic kind, and source provenance', () => {
  const tool = { name: 'memory_write_page', inputSchema: { properties: {
    workspace: { type: 'string' }, project: { type: 'string' }, path: { type: 'string' },
    body: { type: 'string' }, create_only: { type: 'boolean' }, tags: { type: 'array' },
    tier: { type: 'string', enum: ['semantic', 'procedural', 'episodic', 'working'] },
    pinned: { type: 'boolean' }, kind: { type: 'string' }, source_files: { type: 'array' }
  } } };
  const input = buildCreatePageInput(tool, scope, 'decisions/api.md', '# API\n\nDecision.', [], {
    tier: 'procedural', pinned: true, kind: 'decision', sourceFiles: [{ path: 'src/api.js', commit: 'abcdef1234567' }]
  });
  assert.equal(input.tier, 'procedural');
  assert.equal(input.pinned, true);
  assert.equal(input.kind, 'decision');
  assert.deepEqual(input.source_files, [{ path: 'src/api.js', commit: 'abcdef1234567' }]);
});

test('safe page paths reject absolute paths and traversal', () => {
  for (const value of ['/etc/memory.md', 'C:/memory.md', '../memory.md', 'pages/../../memory.md', 'pages/a']) {
    assert.throws(() => safePagePath(value), /path|caminho/i);
  }
});

test('writer cannot silently fall back to overwrite when create_only is unsupported', () => {
  const tool = { name: 'memory_write_page', inputSchema: { properties: {
    workspace: { type: 'string' }, project: { type: 'string' }, path: { type: 'string' }, body: { type: 'string' }
  } } };
  assert.throws(() => buildCreatePageInput(tool, scope, 'knowledge.md', 'body'), /create_only/);
});

test('search cannot run without a project filter in the official tool schema', () => {
  const tool = { name: 'memory_query', inputSchema: { properties: { query: { type: 'string' } } } };
  assert.throws(() => buildScopedQueryInput(tool, 'query', scope), /project scope/);
});

test('section replacement uses the page ID and section hash supplied by AI Memory', () => {
  const tool = { name: 'memory_patch_page', inputSchema: { properties: {
    path: { type: 'string' }, expected_page_id: { type: 'string' }, edits: { type: 'array' },
    workspace: { type: 'string' }, project: { type: 'string' }
  } } };
  const page = { path: 'decisions/api.md', pageId: 'version-1', sections: [{ anchor: 'Data (API)+', level: 2, sha256: 'section-hash' }] };
  assert.deepEqual(buildKnowledgePatchInput(tool, scope, page, {
    op: 'replace_section', anchor: 'Data (API)+', content: '## Data (API)+\n\nUse version 2.'
  }), {
    path: 'decisions/api.md', expected_page_id: 'version-1', workspace: 'work', project: 'repo',
    edits: [{ op: 'replace_section', anchor: 'Data (API)+', section_sha256: 'section-hash', content: '## Data (API)+\n\nUse version 2.' }]
  });
});

test('section append and creation preserve the loaded page identity', () => {
  const tool = { name: 'memory_patch_page', inputSchema: { properties: {
    path: { type: 'string' }, expected_page_id: { type: 'string' }, edits: { type: 'array' },
    workspace: { type: 'string' }, project: { type: 'string' }
  } } };
  const page = { path: 'notes/work.md', pageId: 'version-3', sections: [{ anchor: 'Build', level: 2, sha256: 'hash' }] };
  assert.equal(buildKnowledgePatchInput(tool, scope, page, { op: 'append', target: 'section', anchor: 'Build', content: 'New detail.' }).expected_page_id, 'version-3');
  assert.deepEqual(buildKnowledgePatchInput(tool, scope, page, { op: 'add_section', anchor: 'Build', content: '### Risks\n\nNone known.' }).edits[0], {
    op: 'add_section', anchor: 'Build', content: '### Risks\n\nNone known.'
  });
});

test('editing fails closed for truncated pages, ambiguous sections, or stale identities', () => {
  const tool = { name: 'memory_patch_page', inputSchema: { properties: {
    path: { type: 'string' }, expected_page_id: { type: 'string' }, edits: { type: 'array' },
    workspace: { type: 'string' }, project: { type: 'string' }
  } } };
  const page = { path: 'notes/work.md', pageId: 'version-3', sections: [{ anchor: 'Build', level: 2, sha256: 'hash' }] };
  assert.throws(() => buildKnowledgePatchInput(tool, scope, { ...page, truncated: true }, { op: 'append', target: 'end_of_page', content: 'text' }), /completa/);
  assert.throws(() => buildKnowledgePatchInput(tool, scope, { ...page, pageId: '' }, { op: 'append', target: 'end_of_page', content: 'text' }), /completa/);
  assert.throws(() => buildKnowledgePatchInput(tool, scope, { ...page, sections: [...page.sections, ...page.sections] }, { op: 'append', target: 'section', anchor: 'Build', content: 'text' }), /exactly|inequívoca/);
  assert.throws(() => buildKnowledgePatchInput(tool, scope, page, { op: 'replace_section', anchor: 'Build', content: '## Wrong title\n\ntext' }), /heading|título|seção/i);
});

test('metadata updates preserve existing supported fields and use the loaded page identity', () => {
  const fields = ['workspace', 'project', 'path', 'body', 'expected_page_id', 'kind', 'tags', 'tier', 'pinned', 'source_files', 'entities', 'abstract', 'relations', 'applies_to', 'enforced_by', 'expires_at', 'session_id'];
  const tool = { name: 'memory_write_page', inputSchema: { properties: Object.fromEntries(fields.map(field => [field, { type: field === 'tags' || field === 'source_files' ? 'array' : 'string' }])) } };
  const page = { path: 'notes/work.md', pageId: 'page-12', body: '# Work\n', frontmatter: { tier: 'semantic', tags: ['old'], pinned: false, kind: 'note', source_files: [{ path: 'src/a.js', commit: 'abc' }] } };
  assert.deepEqual(buildPageMetadataUpdateInput(tool, scope, page, { tier: 'procedural', tags: ['new', 'new'], kind: 'decision', pinned: true }), {
    workspace: 'work', project: 'repo', path: 'notes/work.md', body: '# Work\n', expected_page_id: 'page-12',
    tier: 'procedural', tags: ['new'], pinned: true, kind: 'decision', source_files: [{ path: 'src/a.js', commit: 'abc' }]
  });
});

test('metadata updates fail closed when page version or existing metadata cannot be preserved', () => {
  const fields = ['workspace', 'project', 'path', 'body', 'expected_page_id', 'tier', 'pinned', 'kind', 'tags'];
  const tool = { name: 'memory_write_page', inputSchema: { properties: Object.fromEntries(fields.map(field => [field, {}])) } };
  const page = { path: 'notes/work.md', pageId: 'page-12', body: '# Work\n', frontmatter: { custom: 'value' } };
  assert.throws(() => buildPageMetadataUpdateInput(tool, scope, page, { pinned: true }), /preservar com segurança/i);
  assert.throws(() => buildPageMetadataUpdateInput(tool, scope, { ...page, truncated: true }, { pinned: true }), /complete|completa/i);
  assert.throws(() => buildPageMetadataUpdateInput({ ...tool, inputSchema: { properties: Object.fromEntries(fields.filter(field => field !== 'expected_page_id').map(field => [field, {}])) } }, scope, page, { pinned: true }), /expected_page_id/);
  assert.throws(() => buildPageMetadataUpdateInput({ ...tool, inputSchema: { properties: Object.fromEntries(fields.map(field => [field, {}])) } }, scope, { ...page, frontmatter: { source_files: ['a.js'] } }, { pinned: true }), /source_files/);
});

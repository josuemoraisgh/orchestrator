'use strict';

const { buildMemoryQueryInput, callAiMemoryTool, listAiMemoryTools, readAiMemoryPage, toolResultText } = require('./aiMemoryMcp');
const PRESERVABLE_PAGE_FIELDS = new Set([
  'kind', 'tags', 'pinned', 'tier', 'source_files', 'entities', 'abstract', 'relations',
  'applies_to', 'enforced_by', 'expires_at', 'session_id', 'type', 'generated', 'title'
]);
const PAGE_FIELDS_DERIVED_BY_RUNTIME = new Set(['type', 'generated', 'title']);
const KNOWLEDGE_QUERY_FILTERS = ['kind', 'tier', 'path_prefix', 'tag', 'pin_first', 'include_superseded', 'explain'];

function findTool(tools, suffix) {
  const expected = String(suffix || '').toLowerCase();
  return (Array.isArray(tools) ? tools : []).find(tool => String(tool?.name || '').toLowerCase().endsWith(expected));
}

function addScope(input, tool, scope) {
  const properties = tool?.inputSchema?.properties || {};
  if (Object.hasOwn(properties, 'workspace')) input.workspace = scope.workspace;
  if (Object.hasOwn(properties, 'project_id') && scope.projectId) input.project_id = scope.projectId;
  else if (Object.hasOwn(properties, 'project')) input.project = scope.project;
  else if (Object.hasOwn(properties, 'project_name')) input.project_name = scope.project;
  else throw new Error(`AI Memory tool ${tool.name} does not expose a supported project scope field.`);
  return input;
}

function supportedKnowledgeQueryFilters(tool) {
  const properties = tool?.inputSchema?.properties || {};
  return KNOWLEDGE_QUERY_FILTERS.filter(field => Object.hasOwn(properties, field));
}

function buildScopedQueryInput(tool, query, scope, limit = 8, filters = {}) {
  const input = buildMemoryQueryInput(tool, query, limit);
  addScope(input, tool, scope);
  const properties = tool?.inputSchema?.properties || {};
  for (const [field, raw] of Object.entries(filters || {})) {
    if (!KNOWLEDGE_QUERY_FILTERS.includes(field)) throw new Error(`Filtro do AI Memory não suportado pela interface: ${field}.`);
    if (raw === undefined || raw === null || raw === '' || raw === false) continue;
    if (!Object.hasOwn(properties, field)) throw new Error(`A versão ativa do AI Memory não declara o filtro ${field}; a busca foi cancelada para não ignorar sua seleção.`);
    if (field === 'pin_first' || field === 'include_superseded' || field === 'explain') input[field] = raw === true;
    else if (field === 'tier') {
      const value = String(raw).trim();
      const allowed = ['working', 'episodic', 'semantic', 'procedural'];
      if (!allowed.includes(value)) throw new Error(`Categoria de memória inválida: ${value}.`);
      input[field] = value;
    } else if (field === 'path_prefix') {
      const value = String(raw).trim().replaceAll('\\', '/');
      if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw new Error('O filtro de caminho deve ser um prefixo relativo ao projeto, sem segmentos . ou ...');
      input[field] = value.slice(0, 240);
    } else input[field] = String(raw).trim().slice(0, field === 'kind' ? 64 : 128);
  }
  return input;
}

function safePagePath(value) {
  const pagePath = String(value || '').trim().replaceAll('\\', '/');
  if (!pagePath || pagePath.startsWith('/') || /^[a-z]:/i.test(pagePath) || pagePath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Informe um caminho relativo de página do AI Memory, sem segmentos . ou ...');
  }
  if (!/\.md$/i.test(pagePath)) throw new Error('O caminho da página deve terminar em .md.');
  return pagePath;
}

function buildCreatePageInput(tool, scope, pagePath, body, tags = [], metadata = {}) {
  const properties = tool?.inputSchema?.properties || {};
  const pathField = ['path', 'page_path'].find(name => Object.hasOwn(properties, name));
  const bodyField = ['body', 'content'].find(name => Object.hasOwn(properties, name));
  if (!pathField || !bodyField) throw new Error('AI Memory memory_write_page does not expose supported path and body fields.');
  if (!Object.hasOwn(properties, 'create_only')) throw new Error('AI Memory memory_write_page does not expose create_only; safe create-only writes are unavailable.');
  const text = String(body || '').trim();
  if (!text) throw new Error('O conteúdo da página não pode ficar vazio.');
  const input = addScope({ [pathField]: safePagePath(pagePath), [bodyField]: text, create_only: true }, tool, scope);
  if (Object.hasOwn(properties, 'tags')) input.tags = [...new Set(tags.map(tag => String(tag).trim()).filter(Boolean))].slice(0, 20);
  if (metadata.tier) {
    if (!Object.hasOwn(properties, 'tier')) throw new Error('AI Memory memory_write_page does not support page tiers.');
    if (Array.isArray(properties.tier.enum) && !properties.tier.enum.includes(metadata.tier)) throw new Error(`AI Memory does not support tier ${metadata.tier}.`);
    input.tier = metadata.tier;
  }
  if (metadata.pinned === true) {
    if (!Object.hasOwn(properties, 'pinned')) throw new Error('AI Memory memory_write_page does not support pinned pages.');
    input.pinned = true;
  }
  const kind = String(metadata.kind || '').trim();
  if (kind) {
    if (!Object.hasOwn(properties, 'kind')) throw new Error('AI Memory memory_write_page does not support semantic kinds.');
    input.kind = kind.slice(0, 64);
  }
  const sourceFiles = Array.isArray(metadata.sourceFiles) ? metadata.sourceFiles : [];
  if (sourceFiles.length) {
    if (!Object.hasOwn(properties, 'source_files')) throw new Error('AI Memory memory_write_page does not support source-file provenance.');
    input.source_files = sourceFiles.slice(0, 16).map(source => ({ path: String(source.path), commit: String(source.commit) }));
  }
  return input;
}

function buildKnowledgePatchInput(tool, scope, page, edit = {}) {
  const properties = tool?.inputSchema?.properties || {};
  for (const required of ['path', 'expected_page_id', 'edits']) {
    if (!Object.hasOwn(properties, required)) throw new Error(`AI Memory ${tool?.name || 'memory_patch_page'} does not support required conditional field ${required}.`);
  }
  if (!page || page.truncated || !page.path || !page.pageId) throw new Error('Carregue a página completa do AI Memory antes de editar.');
  const path = safePagePath(page.path);
  const content = String(edit.content || '').trim();
  if (!content) throw new Error('O conteúdo da alteração não pode ficar vazio.');
  const sections = Array.isArray(page.sections) ? page.sections : [];
  const anchor = String(edit.anchor || '').trim();
  const matchingSections = sections.filter(section => section.anchor === anchor);
  let operation;
  if (edit.op === 'append' && edit.target === 'end_of_page') {
    operation = { op: 'append', target: 'end_of_page', content };
  } else if (edit.op === 'append' && edit.target === 'section') {
    if (matchingSections.length !== 1) throw new Error('Escolha uma seção inequívoca da página carregada.');
    operation = { op: 'append', target: 'section', anchor, content };
  } else if (edit.op === 'add_section') {
    if (matchingSections.length !== 1) throw new Error('A seção âncora precisa existir exatamente uma vez na página carregada.');
    if (!/^#{2,6}\s+\S/m.test(content)) throw new Error('A nova seção precisa começar com um título Markdown de nível 2 a 6.');
    operation = { op: 'add_section', anchor, content };
  } else if (edit.op === 'replace_section') {
    if (matchingSections.length !== 1 || typeof matchingSections[0].sha256 !== 'string' || !matchingSections[0].sha256) {
      throw new Error('A seção não tem um hash verificado para substituição condicional. Recarregue a página.');
    }
    if (!new RegExp(`^#{${matchingSections[0].level}}\\s+${escapeRegExp(anchor)}\\s*$`, 'm').test(content)) {
      throw new Error('A substituição precisa manter o título original da seção.');
    }
    operation = { op: 'replace_section', anchor, section_sha256: matchingSections[0].sha256, content };
  } else {
    throw new Error('Escolha uma operação de edição de página compatível com o AI Memory.');
  }
  return addScope({ path, expected_page_id: page.pageId, edits: [operation] }, tool, scope);
}

function buildPageMetadataUpdateInput(tool, scope, page, changes = {}) {
  const properties = tool?.inputSchema?.properties || {};
  for (const field of ['path', 'body', 'expected_page_id']) {
    if (!Object.hasOwn(properties, field)) throw new Error(`AI Memory ${tool?.name || 'memory_write_page'} does not support required conditional metadata field ${field}.`);
  }
  if (!page || page.truncated || !page.path || !page.pageId || typeof page.body !== 'string') {
    throw new Error('Carregue a página completa do AI Memory antes de alterar metadados.');
  }
  const frontmatter = page.frontmatter && typeof page.frontmatter === 'object' ? page.frontmatter : {};
  const unknown = Object.keys(frontmatter).filter(key => !PRESERVABLE_PAGE_FIELDS.has(key));
  if (unknown.length) throw new Error(`A página contém metadados que esta versão não pode preservar com segurança: ${unknown.join(', ')}.`);

  const input = addScope({
    path: safePagePath(page.path), body: page.body, expected_page_id: page.pageId
  }, tool, scope);
  for (const field of PRESERVABLE_PAGE_FIELDS) {
    if (PAGE_FIELDS_DERIVED_BY_RUNTIME.has(field) || !Object.hasOwn(frontmatter, field)) continue;
    if (!Object.hasOwn(properties, field)) throw new Error(`AI Memory memory_write_page cannot preserve existing ${field} metadata; no update was performed.`);
    input[field] = frontmatter[field];
  }
  for (const [field, value] of Object.entries(changes)) {
    if (!['kind', 'tags', 'tier', 'pinned'].includes(field)) throw new Error(`Metadata editing does not support ${field}.`);
    if (!Object.hasOwn(properties, field)) throw new Error(`AI Memory memory_write_page does not expose ${field}.`);
    if (field === 'kind') input.kind = String(value || '').trim().slice(0, 64);
    else if (field === 'tags') input.tags = [...new Set((Array.isArray(value) ? value : []).map(tag => String(tag).trim()).filter(Boolean))].slice(0, 20);
    else if (field === 'tier') {
      if (Array.isArray(properties.tier.enum) && !properties.tier.enum.includes(value)) throw new Error(`AI Memory does not support tier ${value}.`);
      input.tier = value;
    } else input.pinned = value === true;
  }
  return input;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function searchKnowledge(executable, cwd, scope, query, connection, limit = 8, filters = {}) {
  const tools = await listAiMemoryTools(executable, cwd, connection);
  const tool = findTool(tools, 'memory_query');
  if (!tool) throw new Error('AI Memory does not expose memory_query.');
  const input = buildScopedQueryInput(tool, query, scope, limit, filters);
  const result = await callAiMemoryTool(executable, cwd, tool.name, input, connection);
  const text = toolResultText(result);
  if (result?.isError) throw new Error(text || 'AI Memory search failed.');
  return { text, tool: tool.name, limit: input.limit, supportedFilters: supportedKnowledgeQueryFilters(tool), appliedFilters: KNOWLEDGE_QUERY_FILTERS.filter(field => Object.hasOwn(input, field)) };
}

async function getKnowledgeSearchCapabilities(executable, cwd, connection) {
  const tools = await listAiMemoryTools(executable, cwd, connection);
  const tool = findTool(tools, 'memory_query');
  if (!tool) throw new Error('AI Memory does not expose memory_query.');
  const limitSchema = tool.inputSchema?.properties?.limit;
  const maximum = Number.isFinite(Number(limitSchema?.maximum)) ? Math.min(100, Number(limitSchema.maximum)) : 100;
  const minimum = Number.isFinite(Number(limitSchema?.minimum)) ? Math.max(1, Number(limitSchema.minimum)) : 1;
  const defaultValue = Number.isFinite(Number(limitSchema?.default)) && Number(limitSchema.default) > 0
    ? Number(limitSchema.default) : Math.min(8, maximum);
  return { filters: supportedKnowledgeQueryFilters(tool), limit: Object.hasOwn(tool.inputSchema?.properties || {}, 'limit') ? { minimum, maximum: Math.max(minimum, maximum), default: Math.min(maximum, Math.max(minimum, defaultValue)) } : undefined };
}

async function createKnowledgePage(executable, cwd, scope, pagePath, body, tags, metadata, connection) {
  const tools = await listAiMemoryTools(executable, cwd, connection);
  const writer = findTool(tools, 'memory_write_page');
  if (!writer) throw new Error('AI Memory does not expose memory_write_page.');
  const input = buildCreatePageInput(writer, scope, pagePath, body, tags, metadata);
  const result = await callAiMemoryTool(executable, cwd, writer.name, input, connection);
  const text = toolResultText(result);
  if (result?.isError) throw new Error(text || 'AI Memory could not create the page.');
  const verified = await readAiMemoryPage(executable, cwd, scope, input.path || input.page_path, 12000, connection);
  if (!verified.body.includes(String(body).trim())) throw new Error('AI Memory returned a page, but the saved content did not pass read-back verification.');
  return { ...verified, tool: writer.name };
}

async function patchKnowledgePage(executable, cwd, scope, page, edit, connection) {
  const tools = await listAiMemoryTools(executable, cwd, connection);
  const patcher = findTool(tools, 'memory_patch_page');
  if (!patcher) throw new Error('AI Memory does not expose memory_patch_page; safe conditional editing is unavailable.');
  const input = buildKnowledgePatchInput(patcher, scope, page, edit);
  const result = await callAiMemoryTool(executable, cwd, patcher.name, input, connection);
  const text = toolResultText(result);
  if (result?.isError) throw new Error(text || 'AI Memory rejected the conditional page edit; reload the page before trying again.');
  const verified = await readAiMemoryPage(executable, cwd, scope, input.path, 64000, connection);
  if (verified.truncated || !verified.body.includes(String(edit.content).trim())) {
    throw new Error('AI Memory accepted the page patch, but the result could not be fully verified by read-back.');
  }
  return { ...verified, tool: patcher.name };
}

async function updateKnowledgeMetadata(executable, cwd, scope, page, changes, connection) {
  const tools = await listAiMemoryTools(executable, cwd, connection);
  const writer = findTool(tools, 'memory_write_page');
  if (!writer) throw new Error('AI Memory does not expose memory_write_page; conditional metadata editing is unavailable.');
  const input = buildPageMetadataUpdateInput(writer, scope, page, changes);
  const result = await callAiMemoryTool(executable, cwd, writer.name, input, connection);
  const text = toolResultText(result);
  if (result?.isError) throw new Error(text || 'AI Memory rejected the metadata update; reload the page and retry.');
  const verified = await readAiMemoryPage(executable, cwd, scope, input.path, 64000, connection);
  if (verified.truncated || verified.body !== page.body || verified.pageId === page.pageId) {
    throw new Error('AI Memory accepted the metadata update, but the unchanged page body and new version could not be verified.');
  }
  for (const [field, value] of Object.entries(changes)) {
    const actual = field === 'pinned' && verified.frontmatter[field] === undefined ? false : verified.frontmatter[field];
    if (JSON.stringify(actual) !== JSON.stringify(input[field])) {
      throw new Error(`AI Memory metadata read-back did not verify ${field}.`);
    }
  }
  return { ...verified, tool: writer.name };
}

async function loadKnowledgePage(executable, cwd, scope, pagePath, connection) {
  return readAiMemoryPage(executable, cwd, scope, safePagePath(pagePath), 64000, connection);
}

module.exports = {
  addScope, buildCreatePageInput, buildKnowledgePatchInput, buildPageMetadataUpdateInput, buildScopedQueryInput,
  createKnowledgePage, getKnowledgeSearchCapabilities, loadKnowledgePage, patchKnowledgePage, safePagePath, searchKnowledge, supportedKnowledgeQueryFilters, updateKnowledgeMetadata
};

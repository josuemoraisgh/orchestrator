'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { AiMemoryRuntime } = require('../src/aiMemoryRuntime');
const { callAiMemoryTool, listAiMemoryTools, toolResultText } = require('../src/aiMemoryMcp');
const { createKnowledgePage, getKnowledgeSearchCapabilities, patchKnowledgePage, searchKnowledge, updateKnowledgeMetadata } = require('../src/aiMemoryKnowledge');

test('managed AI Memory runtime shares task continuity across VS Code windows', {
  skip: !process.env.ORCHESTRATOR_AI_MEMORY_BIN
}, async t => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-ai-memory-runtime-'));
  const runtime = new AiMemoryRuntime(storage, async () => process.env.ORCHESTRATOR_AI_MEMORY_BIN);
  const secondWindowRuntime = new AiMemoryRuntime(storage, async () => process.env.ORCHESTRATOR_AI_MEMORY_BIN);
  t.after(async () => {
    const children = [...runtime.processes.values(), ...secondWindowRuntime.processes.values()];
    runtime.dispose();
    secondWindowRuntime.dispose();
    await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))));
    await fs.rm(storage, { recursive: true, force: true });
  });

  const connection = await runtime.ensure();
  const secondWindowConnection = await secondWindowRuntime.ensure();
  assert.equal(secondWindowConnection.url, connection.url, 'VS Code windows sharing extension storage must reuse the same memory server.');
  assert.equal(secondWindowConnection.ownerPid, connection.ownerPid);
  const tools = await listAiMemoryTools(connection.executable, process.cwd(), connection);
  const names = tools.map(tool => tool.name);
  assert.ok(names.some(name => name.endsWith('memory_query')));
  assert.ok(names.some(name => name.endsWith('memory_write_page')));
  assert.ok(names.some(name => name.endsWith('memory_handoff_list')));
  const writer = tools.find(tool => tool.name.endsWith('memory_write_page'));
  const reader = tools.find(tool => tool.name.endsWith('memory_read_page'));
  const query = tools.find(tool => tool.name.endsWith('memory_query'));
  const resolver = tools.find(tool => tool.name.endsWith('memory_resolve_write_target'));
  assert.ok(writer && reader && query && resolver);
  const searchCapabilities = await getKnowledgeSearchCapabilities(connection.executable, process.cwd(), connection);
  assert.ok(searchCapabilities.filters.includes('path_prefix'));
  assert.deepEqual(searchCapabilities.limit, { minimum: 1, maximum: 100, default: 8 });
  const scope = { workspace: 'default', project: `runtime-${randomUUID()}` };
  const pagePath = `orchestrator/integration/${randomUUID()}.md`;
  const marker = `IntegrationID${randomUUID().replaceAll('-', '')}`;
  const missingScope = await callAiMemoryTool(connection.executable, process.cwd(), resolver.name, scope, connection)
    .then(result => ({ isError: result.isError, text: toolResultText(result) }))
    .catch(error => ({ isError: true, text: error.message || String(error) }));
  assert.equal(missingScope.isError, true, 'a new project must be reported as missing before its first page is created.');
  assert.match(missingScope.text, /project .* not found in workspace/);
  const written = await callAiMemoryTool(connection.executable, process.cwd(), writer.name, {
    ...scope, path: pagePath,
    body: `# Runtime integration\n\n${marker}\n`, tags: ['orchestrator', 'integration'], create_only: true
  }, connection);
  assert.equal(written.isError, false, toolResultText(written));
  const savedPageId = /"page_id"\s*:\s*"([^"]+)"/i.exec(toolResultText(written))?.[1];
  assert.ok(savedPageId, toolResultText(written));
  const readback = await callAiMemoryTool(secondWindowConnection.executable, process.cwd(), reader.name, {
    workspace: scope.workspace, project: scope.project, path: pagePath, max_chars: 2000
  }, secondWindowConnection);
  assert.equal(readback.isError, false, toolResultText(readback));
  assert.match(toolResultText(readback), new RegExp(marker));
  assert.match(toolResultText(readback), new RegExp(savedPageId));
  const searched = await callAiMemoryTool(connection.executable, process.cwd(), query.name, {
    workspace: scope.workspace, project: scope.project, query: marker, limit: 6
  }, connection);
  assert.equal(searched.isError, false, toolResultText(searched));
  assert.match(toolResultText(searched), new RegExp(marker));
  assert.match(toolResultText(searched), new RegExp(pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const resolvedScope = await callAiMemoryTool(connection.executable, process.cwd(), resolver.name, scope, connection);
  assert.equal(resolvedScope.isError, false, toolResultText(resolvedScope));
  assert.ok(/"project_id"\s*:\s*"[^"]+"/.test(toolResultText(resolvedScope)), toolResultText(resolvedScope));
  const durablePath = `orchestrator/knowledge/${randomUUID()}.md`;
  const durableMarker = `DurableKnowledge${randomUUID().replaceAll('-', '')}`;
  const durable = await createKnowledgePage(connection.executable, process.cwd(), scope, durablePath, `# Durable knowledge\n\n${durableMarker}\n\n## Decision\n\nUse version 1.`, ['orchestrator', 'decision'], { tier: 'procedural', pinned: true, kind: 'decision', sourceFiles: [{ path: 'src/example.js', commit: '0123456789abcdef' }] }, connection);
  assert.equal(durable.path, durablePath);
  assert.ok(durable.pageId);
  assert.match(durable.body, new RegExp(durableMarker));
  assert.equal(durable.frontmatter.pinned, true);
  assert.equal(durable.frontmatter.tier, 'procedural');
  const metadataUpdated = await updateKnowledgeMetadata(connection.executable, process.cwd(), scope, durable, { tier: 'semantic', pinned: false, kind: 'architecture', tags: ['orchestrator', 'architecture'] }, connection);
  assert.notEqual(metadataUpdated.pageId, durable.pageId);
  assert.equal(metadataUpdated.body, durable.body);
  assert.equal(metadataUpdated.frontmatter.tier, 'semantic');
  assert.equal(metadataUpdated.frontmatter.pinned === true, false);
  assert.equal(metadataUpdated.frontmatter.kind, 'architecture');
  assert.deepEqual(metadataUpdated.frontmatter.source_files, durable.frontmatter.source_files);
  const filteredSearch = await searchKnowledge(connection.executable, process.cwd(), scope, durableMarker, connection, 8, {
    tier: 'semantic', path_prefix: 'orchestrator/knowledge/', tag: 'architecture', kind: 'architecture', pin_first: true, explain: true
  });
  assert.match(filteredSearch.text, new RegExp(durablePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(filteredSearch.supportedFilters.includes('path_prefix'));
  assert.deepEqual(filteredSearch.appliedFilters.sort(), ['explain', 'kind', 'path_prefix', 'pin_first', 'tag', 'tier'].sort());
  await assert.rejects(updateKnowledgeMetadata(connection.executable, process.cwd(), scope, durable, { pinned: true }, connection), /precondition|latest page|failed/i);
  const currentDurable = metadataUpdated;
  assert.ok(currentDurable.sections.some(section => section.anchor === 'Decision' && section.sha256));
  const patched = await patchKnowledgePage(connection.executable, process.cwd(), scope, currentDurable, {
    op: 'replace_section', anchor: 'Decision', content: '## Decision\n\nUse version 2.'
  }, connection);
  assert.notEqual(patched.pageId, currentDurable.pageId);
  assert.match(patched.body, /Use version 2/);
  await assert.rejects(patchKnowledgePage(connection.executable, process.cwd(), scope, currentDurable, {
    op: 'append', target: 'end_of_page', content: 'This stale write must be rejected.'
  }, connection), /precondition|latest page|failed/i);
  const knowledgeSearch = await searchKnowledge(connection.executable, process.cwd(), scope, durableMarker, connection);
  assert.match(knowledgeSearch.text, new RegExp(durableMarker));
  assert.match(knowledgeSearch.text, new RegExp(durablePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal((await runtime.status()).status, 'available');
});

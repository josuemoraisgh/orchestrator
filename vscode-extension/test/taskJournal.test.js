'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { TaskJournal } = require('../src/taskJournal');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-journal-'));
  const project = path.join(base, 'project');
  const otherProject = path.join(base, 'other-project');
  const storage = path.join(base, 'storage');
  await Promise.all([fs.mkdir(project), fs.mkdir(otherProject)]);
  const journal = new TaskJournal(storage);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { journal, project, otherProject };
}

function sample(runId = 'run-1', attempt = 1) {
  return {
    run: { id: runId, title: 'Implement the Quasar raster pipeline', prompt: 'Build a Quasar raster pipeline' },
    task: {
      id: 'task-raster', title: 'Raster pipeline', description: 'Implement Quasar raster decoding',
      acceptanceCriteria: ['Decode PNG raster data', 'Keep image memory bounded'],
      provider: 'copilot', model: 'vendor:model-x', executor: 'vscode-model',
      status: 'running', attempts: attempt, sessionId: 'orchestrator-model-session',
      projectPath: 'C:/project', worktreePath: 'C:/project', history: []
    }
  };
}

test('task events persist, redact credentials, and form a bounded continuation context', async t => {
  const { journal, project } = await fixture(t);
  const { run, task } = sample();
  await journal.record(project, run, task, 'session-started');
  const event = {
    id: 'run-1/task-raster/1/event-1', type: 'tool-result', actor: 'orchestrator',
    toolName: 'run_command', summary: 'api_key=secret-value Bearer abcdefghijklmnopqrstuvwxyz',
    content: 'Quasar raster parser compiled; output=ghp_123456789012345678901234567890123456'
  };
  assert.equal(await journal.appendEvent(project, run.id, task.id, event), true);
  assert.equal(await journal.appendEvent(project, run.id, task.id, event), false);

  const context = await journal.readContext(project, run.id, task.id);
  assert.equal(context.verified, true);
  assert.match(context.text, /Quasar raster parser compiled/);
  assert.match(context.text, /Acceptance criteria: Decode PNG raster data \| Keep image memory bounded/);
  assert.doesNotMatch(context.text, /secret-value|abcdefghijklmnopqrstuvwxyz|ghp_123456/);
});

test('task journal preserves the selected provider profile across attempts', async t => {
  const { journal, project } = await fixture(t);
  const { run, task } = sample();
  Object.assign(task, { provider: 'claude', executor: 'claude-code-cli', profileId: 'claude-profile-2' });
  await journal.record(project, run, task, 'session-started');

  task.attempts = 2;
  task.sessionId = 'orchestrator-claude-retry';
  await journal.record(project, run, task, 'retry-started');

  const record = await journal.read(project, run.id, task.id);
  assert.equal(record.latest.profileId, 'claude-profile-2');
  assert.deepEqual(record.attempts.map(item => item.snapshot.profileId), ['claude-profile-2', 'claude-profile-2']);
});

test('task journal and continuation context preserve the Lich delivery outcome', async t => {
  const { journal, project } = await fixture(t);
  const { run, task } = sample();
  task.deliveryStatus = 'unread';
  task.status = 'blocked';
  await journal.record(project, run, task, 'delivery-unread');

  const record = await journal.read(project, run.id, task.id);
  assert.equal(record.latest.deliveryStatus, 'unread');
  const context = await journal.readContext(project, run.id, task.id);
  assert.match(context.text, /delivery unread/);
});

test('journal search ranks matching task context and remains project-scoped', async t => {
  const { journal, project, otherProject } = await fixture(t);
  const { run, task } = sample();
  await journal.record(project, run, task, 'task-complete');
  const result = await journal.search(project, 'Quasar raster decoding', { limit: 5 });
  assert.equal(result.verified, true);
  assert.equal(result.results[0]?.taskId, task.id);
  assert.equal(result.results[0]?.source, 'orchestrator-task-journal');
  assert.equal((await journal.search(project, 'Quasar raster decoding', { runId: 'another-run' })).results.length, 0);
  assert.equal((await journal.search(project, 'Quasar raster decoding', { provider: 'claude' })).results.length, 0);
  assert.equal((await journal.search(otherProject, 'Quasar raster decoding')).results.length, 0);
});

test('journal path-prefix search follows filesystem case sensitivity', async t => {
  const { journal, project } = await fixture(t);
  const { run, task } = sample();
  task.changes = { files: [{ code: 'M', path: 'Source/UpperCase.js' }] };
  await journal.record(project, run, task, 'task-complete');

  assert.equal((await journal.search(project, 'Quasar raster', { pathPrefix: 'Source/Upper' })).results.length, 1);
  const caseVariantCount = (await journal.search(project, 'Quasar raster', { pathPrefix: 'source/upper' })).results.length;
  assert.equal(caseVariantCount, process.platform === 'win32' ? 1 : 0);
});

test('concurrent session events are retained without overwriting each other', async t => {
  const { journal, project } = await fixture(t);
  const { run, task } = sample();
  await journal.record(project, run, task, 'session-started');
  await Promise.all(Array.from({ length: 12 }, (_, index) => journal.appendEvent(project, run.id, task.id, {
    id: `event-${index}`, type: 'assistant-message', content: `Parallel event ${index}`
  })));
  const record = await journal.read(project, run.id, task.id);
  const events = record.attempts[0].events.filter(item => item.id.startsWith('event-'));
  assert.equal(events.length, 12);
});

test('handoff records are visible without consuming and can be claimed only once by the named recipient', async t => {
  const { journal, project } = await fixture(t);
  const { run, task } = sample();
  await journal.record(project, run, task, 'session-started');
  const handoff = await journal.createHandoff(project, {
    runId: run.id, taskId: task.id, fromProvider: 'copilot', fromSessionId: 'session-1',
    recipient: 'claude:vscode-model:model-y', context: 'Continue raster decoder; tests remain.'
  });
  assert.equal((await journal.listHandoffs(project, { status: 'pending' })).length, 1);
  await assert.rejects(journal.createHandoff(project, {
    runId: run.id, taskId: task.id, recipient: 'codex:lich-cli:', context: 'duplicate'
  }), /already has a pending handoff/);
  assert.equal((await journal.claimHandoff(project, handoff.id, 'codex:lich-cli:')).reason, 'wrong-recipient');
  const results = await Promise.all([
    journal.claimHandoff(project, handoff.id, 'claude:vscode-model:model-y'),
    journal.claimHandoff(project, handoff.id, 'claude:vscode-model:model-y')
  ]);
  assert.equal(results.filter(result => result.claimed).length, 1);
  assert.equal(results.filter(result => !result.claimed && result.reason === 'claimed').length, 1);
  assert.equal(results.find(result => result.claimed).handoff.context, 'Continue raster decoder; tests remain.');
  assert.equal(await journal.cancelHandoff(project, handoff.id), false);
});

test('a claimed handoff can be released after dispatch failure only by its named recipient', async t => {
  const { journal, project } = await fixture(t);
  const { run, task } = sample();
  await journal.record(project, run, task, 'session-started');
  const recipient = 'claude:claude-code-cli:sonnet:profile-1';
  const handoff = await journal.createHandoff(project, {
    runId: run.id, taskId: task.id, recipient, context: 'Continue from the preserved worktree.'
  });
  assert.equal((await journal.claimHandoff(project, handoff.id, recipient)).claimed, true);
  assert.equal(await journal.releaseClaimedHandoff(project, handoff.id, 'codex:cli:default'), false);
  assert.equal(await journal.releaseClaimedHandoff(project, handoff.id, recipient), true);
  const [pending] = await journal.listHandoffs(project, { status: 'pending' });
  assert.equal(pending.id, handoff.id);
  assert.equal(pending.claimedBy, '');
  assert.equal(pending.claimedAt, 0);
  assert.ok(pending.lastDispatchErrorAt > 0);
  assert.equal(await journal.releaseClaimedHandoff(project, handoff.id, recipient), false);
});

test('handoff session-start receipts bind the claimed recipient to the opened session', async t => {
  const { journal, project } = await fixture(t);
  const { run, task } = sample();
  await journal.record(project, run, task, 'session-started');
  const recipient = 'claude:claude-code-cli:sonnet:profile-1';
  const handoff = await journal.createHandoff(project, { runId: run.id, taskId: task.id, recipient, context: 'Continue safely.' });

  assert.equal((await journal.recordHandoffSessionStarted(project, handoff.id, recipient, 'session-before-claim')).reason, 'pending');
  assert.equal((await journal.claimHandoff(project, handoff.id, recipient)).claimed, true);
  assert.equal((await journal.recordHandoffSessionStarted(project, handoff.id, 'other-recipient', 'session-1')).reason, 'wrong-recipient');

  const receipt = await journal.recordHandoffSessionStarted(project, handoff.id, recipient, 'session-1');
  assert.equal(receipt.recorded, true);
  assert.equal(receipt.handoff.status, 'session-started');
  assert.equal(receipt.handoff.sessionStartedFor, recipient);
  assert.equal(receipt.handoff.sessionId, 'session-1');
  assert.ok(receipt.handoff.sessionStartedAt > 0);
  assert.equal((await journal.recordHandoffSessionStarted(project, handoff.id, recipient, 'session-1')).idempotent, true);
  assert.equal((await journal.recordHandoffSessionStarted(project, handoff.id, recipient, 'session-2')).reason, 'session-started');
  assert.equal((await journal.listHandoffs(project, { status: 'session-started' })).length, 1);
});

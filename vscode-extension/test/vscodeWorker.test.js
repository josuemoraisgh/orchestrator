'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { runModelTask } = require('../src/vscodeWorker');

class TextPart { constructor(value) { this.value = value; } }
class ToolCallPart { constructor(name, input, callId) { Object.assign(this, { name, input, callId }); } }
class ToolResultPart { constructor(callId, content) { Object.assign(this, { callId, content }); } }

function stream(parts) {
  return { async *[Symbol.asyncIterator]() { for (const part of parts) yield part; } };
}

test('first-party model worker runs bounded tools, blocks path escape, and records redacted events', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-worker-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outside = path.join(path.dirname(root), 'outside-orchestrator-worker.txt');
  await fs.rm(outside, { force: true });
  const events = [];
  let requestNumber = 0;
  const model = {
    vendor: 'copilot', id: 'model-x', name: 'Model X', capabilities: { toolCalling: 5 },
    async sendRequest() {
      requestNumber++;
      return { stream: stream(requestNumber === 1 ? [
        new ToolCallPart('write_file', { path: '../outside-orchestrator-worker.txt', content: 'must not escape' }, 'call-1'),
        new ToolCallPart('write_file', { path: 'generated.txt', content: 'safe content' }, 'call-2')
      ] : [new TextPart('Created the approved file and rejected the escaped path.')]) };
    }
  };
  const vscode = {
    lm: { selectChatModels: async () => [model], accessInformation: { canSendRequest: () => true } },
    LanguageModelChatMessage: {
      User: content => ({ role: 'user', content }),
      Assistant: content => ({ role: 'assistant', content })
    },
    LanguageModelTextPart: TextPart,
    LanguageModelToolCallPart: ToolCallPart,
    LanguageModelToolResultPart: ToolResultPart,
    LanguageModelChatToolMode: { Auto: 'auto' }
  };
  const result = await runModelTask(vscode, {
    provider: 'copilot', model: 'model-x', root, runId: 'run-1', taskId: 'task-1', attempt: 1,
    title: 'Create a file', description: 'Create generated.txt', acceptanceCriteria: ['File exists'],
    continuityContext: 'Prior task context'
  }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }, () => {}, event => events.push(event));

  assert.match(result.result, /approved file/);
  assert.equal(await fs.readFile(path.join(root, 'generated.txt'), 'utf8'), 'safe content');
  await assert.rejects(fs.stat(outside), { code: 'ENOENT' });
  assert.equal(events.filter(event => event.type === 'tool-call').length, 2);
  const toolResults = events.filter(event => event.type === 'tool-result');
  assert.equal(toolResults.length, 2);
  assert.doesNotMatch(JSON.stringify(toolResults), /safe content|must not escape/);
  assert.ok(toolResults[0].summary.includes('ERRO:'));
});

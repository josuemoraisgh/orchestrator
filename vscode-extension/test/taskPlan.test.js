'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { explicitHandoffRequest, handoffPermittedByCurrentRequest, parsePlanResponse, validatePlan } = require('../src/taskPlan');

test('parses a bounded task-handoff response from the coordinator', () => {
  const parsed = parsePlanResponse(JSON.stringify({
    mode: 'handoff', answer: null, plan: null,
    handoff: {
      runId: '4e8e7293-0fed-49fb-a160-7bac10fc9a20', taskId: 'task-a', provider: 'codex',
      executor: 'codex-app-server', profileId: 'profile-1', model: 'gpt-codex', effort: 'high',
      context: 'Implementer stopped after updating parser.js; continue and report remaining checks.'
    }
  }));
  assert.equal(parsed.mode, 'handoff');
  assert.equal(parsed.handoff.executor, 'codex-app-server');
  assert.equal(parsed.handoff.profileId, 'profile-1');
  assert.throws(() => parsePlanResponse(JSON.stringify({
    mode: 'handoff', answer: null, plan: null,
    handoff: { runId: 'run-1', taskId: '../bad', provider: 'codex', executor: 'codex-app-server', profileId: '', model: '', effort: '', context: 'Continue.' }
  })), /handoff precisa identificar/i);
});

test('handoff requires current user intent unless the task is blocked or failed', () => {
  assert.equal(explicitHandoffRequest('Transfira esta tarefa para o Codex.'), true);
  assert.equal(explicitHandoffRequest('Please switch agents and continue.'), true);
  assert.equal(explicitHandoffRequest('Do not transfer this task.'), false);
  assert.equal(handoffPermittedByCurrentRequest({ status: 'running', error: '' }, 'Continue the task.'), false);
  assert.equal(handoffPermittedByCurrentRequest({ status: 'running', error: '' }, 'Mude de agente e continue.'), true);
  assert.equal(handoffPermittedByCurrentRequest({ status: 'blocked', error: '' }, 'Continue the task.'), true);
});

test('accepts the first-party Codex app-server as a task executor', () => {
  const plan = validatePlan({
    title: 'Codex work',
    tasks: [{
      id: 'codex-task', title: 'Implement feature', description: 'Make a bounded change.',
      acceptanceCriteria: ['The change is implemented.'], dependsOn: [], provider: 'codex',
      executor: 'codex-app-server', profileId: 'codex-profile-1', model: 'gpt-test', effort: 'high', worktree: ''
    }]
  });
  assert.equal(plan.tasks[0].executor, 'codex-app-server');
  assert.equal(plan.tasks[0].profileId, 'codex-profile-1');
  assert.equal(plan.tasks[0].effort, 'high');
});

test('validates and persists a local worktree base branch', () => {
  const plan = validatePlan({
    title: 'Branch base',
    tasks: [{
      id: 'branch-task', title: 'Implement from a feature branch', description: 'Start the isolated checkout from the selected branch.',
      acceptanceCriteria: ['The worktree starts at the selected local branch.'], dependsOn: [], provider: 'codex', base: 'feature/base'
    }]
  });
  assert.equal(plan.tasks[0].base, 'feature/base');
  assert.throws(() => validatePlan({
    title: 'Invalid base',
    tasks: [{
      id: 'branch-task', title: 'Invalid base', description: 'Reject invalid branch syntax.',
      acceptanceCriteria: ['Invalid input is refused.'], dependsOn: [], provider: 'codex', base: '../outside'
    }]
  }), /branch base/i);
  assert.throws(() => validatePlan({
    title: 'Current checkout',
    tasks: [{
      id: 'branch-task', title: 'Current checkout', description: 'Current checkout cannot select a branch base.',
      acceptanceCriteria: ['Invalid combination is refused.'], dependsOn: [], provider: 'codex', base: 'main', worktree: 'current'
    }]
  }), /usa o checkout atual/i);
});

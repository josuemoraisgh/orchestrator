const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

function parsePlanResponse(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : source;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('O modelo não retornou o plano estruturado esperado. Tente solicitar o plano novamente.');
  let parsed;
  try { parsed = JSON.parse(candidate.slice(start, end + 1)); }
  catch { throw new Error('O modelo retornou um plano que não é JSON válido. Tente gerar o plano novamente.'); }
  if (!parsed || typeof parsed !== 'object' || !['answer', 'plan', 'handoff'].includes(parsed.mode)) {
    throw new Error('O modelo retornou um modo de resposta desconhecido.');
  }
  if (parsed.mode === 'answer') return { mode: 'answer', answer: String(parsed.answer || '').trim() };
  if (parsed.mode === 'handoff') {
    const handoff = parsed.handoff;
    if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) throw new Error('O handoff estruturado está ausente.');
    const value = {
      runId: String(handoff.runId || '').trim(), taskId: String(handoff.taskId || '').trim(),
      provider: String(handoff.provider || '').trim(), executor: String(handoff.executor || '').trim(),
      profileId: String(handoff.profileId || '').trim().slice(0, 120),
      model: String(handoff.model || '').trim().slice(0, 160), effort: String(handoff.effort || '').trim().slice(0, 40),
      context: String(handoff.context || '').trim().slice(0, 5000)
    };
    if (!value.runId || value.runId.length > 120 || !ID_PATTERN.test(value.taskId) || !/^[a-z0-9][a-z0-9:._-]{0,119}$/i.test(value.provider)
      || !['vscode-model', 'codex-app-server', 'claude-code-cli', 'lich-cli'].includes(value.executor) || !value.context) {
      throw new Error('O handoff precisa identificar uma tarefa válida, agente autorizado, executor e contexto.');
    }
    return { mode: 'handoff', handoff: value };
  }
  return { mode: 'plan', plan: validatePlan(parsed.plan) };
}

function explicitHandoffRequest(text) {
  const source = String(text || '');
  const action = /\b(?:handoff|transfer(?:ir)?|transfira|transfere|trocar de agente|troque de agente|mudar de agente|mude de agente|substituir o agente|substitua o agente|outro agente continuar|continue com outro agente|switch agents?|change agents?|replace the agent)\b/i;
  const negated = /\b(?:nao|n[aã]o|never|do not|don't|should not)\s+(?:(?:the|this|a|o|a|current|agente|agent|tarefa|task)\s+){0,2}(?:handoff|transfer(?:ir)?|transfira|transfere|trocar|troque|mudar|mude|substituir|substitua|switch|change|replace)\b/i;
  return action.test(source) && !negated.test(source);
}

function handoffPermittedByCurrentRequest(task, text) {
  return Boolean(task && (['blocked', 'failed'].includes(task.status) || String(task.error || '').trim() || explicitHandoffRequest(text)));
}

function validatePlan(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 12) {
    throw new Error('O plano precisa conter entre 1 e 12 tarefas.');
  }
  const ids = new Set();
  const tasks = input.tasks.map((item, index) => {
    const id = String(item?.id || `task-${index + 1}`).trim();
    if (!ID_PATTERN.test(id) || ids.has(id)) throw new Error(`ID de tarefa inválido ou repetido: ${id}`);
    ids.add(id);
    const title = String(item.title || '').trim();
    const description = String(item.description || '').trim();
    const base = String(item.base || '').trim();
    if (base && (base.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base) || base.includes('..') || base.includes('//') || base.endsWith('/') || base.endsWith('.'))) {
      throw new Error(`A branch base da tarefa ${id} precisa ser um nome de branch local válido.`);
    }
    if (base && String(item.worktree || '').trim() === 'current') throw new Error(`A tarefa ${id} usa o checkout atual e não pode definir uma branch base.`);
    const acceptanceCriteria = Array.isArray(item.acceptanceCriteria)
      ? item.acceptanceCriteria.map(value => String(value).trim()).filter(Boolean).slice(0, 12)
      : [];
    const estimatedCostUsd = item.estimatedCostUsd === undefined || item.estimatedCostUsd === null || item.estimatedCostUsd === ''
      ? null
      : Number(item.estimatedCostUsd);
    if (estimatedCostUsd !== null && (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0 || estimatedCostUsd > 100000)) {
      throw new Error(`A estimativa de custo da tarefa ${id} precisa ser um valor USD entre 0 e 100000.`);
    }
    if (!title || title.length > 160 || !description || description.length > 4000 || !acceptanceCriteria.length || acceptanceCriteria.length > 12 || acceptanceCriteria.some(value => value.length > 500) || acceptanceCriteria.join('').length > 1500) {
      throw new Error(`A tarefa ${id} precisa de título, descrição e critérios de conclusão.`);
    }
    return {
      id, title, description, acceptanceCriteria,
      dependsOn: Array.isArray(item.dependsOn) ? [...new Set(item.dependsOn.map(String))] : [],
      provider: String(item.provider || '').trim(),
      profileId: String(item.profileId || '').trim().slice(0, 120),
      executor: ['vscode-model', 'codex-app-server', 'claude-code-cli', 'lich-cli', 'auto'].includes(String(item.executor || '').trim()) ? String(item.executor).trim() : 'auto',
      model: String(item.model || '').trim().slice(0, 160),
      effort: String(item.effort || '').trim().slice(0, 40),
      worktree: String(item.worktree || '').trim().slice(0, 100),
      base,
      estimatedCostUsd,
      status: 'planned', attempts: 0, history: [], memory: { status: 'unverified', workstreamId: '' }
    };
  });
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`A tarefa ${task.id} depende do ID inexistente ${dependency}.`);
      if (dependency === task.id) throw new Error(`A tarefa ${task.id} não pode depender de si mesma.`);
    }
  }
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error('O plano contém dependências circulares.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of tasks) visit(task.id);
  function dependsOnTransitively(taskId, expectedId) {
    return byId.get(taskId).dependsOn.some(dependency => dependency === expectedId || dependsOnTransitively(dependency, expectedId));
  }
  const worktreeOwners = new Map();
  for (const task of tasks) {
    if (!task.worktree) continue;
    const branchKey = task.worktree.replace(/[^A-Za-z0-9._/-]+/g, '-').slice(0, 100).toLowerCase();
    const owner = worktreeOwners.get(branchKey);
    if (owner && !dependsOnTransitively(task.id, owner.id) && !dependsOnTransitively(owner.id, task.id)) {
      throw new Error(`As tarefas ${owner.id} e ${task.id} poderiam executar em paralelo na mesma worktree (${task.worktree}). Use nomes distintos ou declare a dependência entre elas.`);
    }
    if (!owner) worktreeOwners.set(branchKey, task);
  }
  return { title: String(input.title || 'Plano de trabalho').trim().slice(0, 160), tasks };
}

module.exports = { explicitHandoffRequest, handoffPermittedByCurrentRequest, parsePlanResponse, validatePlan };

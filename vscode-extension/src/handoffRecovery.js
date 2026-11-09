'use strict';

function applyJournalTaskSnapshot(task, snapshot) {
  if (!task || !snapshot) return false;
  const fields = [
    'provider', 'profileId', 'model', 'modelName', 'effort', 'executor', 'deliveryStatus',
    'status', 'sessionId', 'threadId', 'threadProvider', 'projectPath', 'worktreePath',
    'result', 'error', 'handoff', 'handoffId', 'handoffRecipient'
  ];
  let changed = false;
  for (const field of fields) {
    if (!Object.hasOwn(snapshot, field) || task[field] === snapshot[field]) continue;
    task[field] = snapshot[field];
    changed = true;
  }
  return changed;
}

function recordRecoveryEvent(task, handoff, event, detail) {
  task.history = Array.isArray(task.history) ? task.history : [];
  if (task.history.some(item => item.event === event && item.handoffId === handoff.id)) return false;
  task.history.push({ at: Date.now(), event, handoffId: handoff.id, detail });
  return true;
}

function recoverySignature(run, task) {
  return JSON.stringify({
    status: task.status, provider: task.provider, profileId: task.profileId, model: task.model,
    effort: task.effort, executor: task.executor, sessionId: task.sessionId,
    threadId: task.threadId, handoffId: task.handoffId, handoffRecipient: task.handoffRecipient,
    handoff: task.handoff, handoffReceipt: task.handoffReceipt, error: task.error,
    historyLength: task.history?.length || 0, runStatus: run.status, runPaused: run.paused
  });
}

function restoreRunStatusFromTasks(run) {
  if (!run || run.status === 'cancelled' || run.status === 'cancelling') return;
  const tasks = Array.isArray(run.tasks) ? run.tasks : [];
  if (!tasks.length) return;
  const statuses = tasks.map(task => task.status);
  if (statuses.every(status => status === 'complete')) run.status = 'complete';
  else if (statuses.every(status => ['complete', 'cancelled'].includes(status))) run.status = 'cancelled';
  else if (statuses.some(status => ['starting', 'running', 'cancelling'].includes(status))) run.status = 'running';
  else if (statuses.some(status => ['planned', 'ready', 'waitingDependency'].includes(status))) run.status = run.paused ? 'paused' : 'approved';
  else if (statuses.some(status => status === 'awaitingReview')) run.status = 'awaitingReview';
  else if (statuses.some(status => ['blocked', 'failed'].includes(status))) run.status = 'blocked';
}

function reconcileHandoffRecovery(run, task, handoffs, journalRecord) {
  if (!run?.id || !task?.id || !Array.isArray(handoffs)) return { action: 'none', changed: false };
  const handoff = handoffs
    .filter(item => item.runId === run.id && item.taskId === task.id && ['pending', 'claimed', 'session-started'].includes(item.status))
    .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))[0];
  if (!handoff) return { action: 'none', changed: false };
  const before = recoverySignature(run, task);

  if (handoff.status === 'pending') {
    if (task.handoffId && task.handoffId !== handoff.id) return { action: 'none', changed: false };
    if (task.handoffId === handoff.id) {
      task.handoffId = '';
      task.handoffRecipient = '';
    }
    recordRecoveryEvent(task, handoff, 'handoff-recovered-before-claim',
      'A extensão reiniciou antes de reivindicar a transferência; o agente anterior não foi parado e a transferência pendente será cancelada.');
    return { action: 'cancel-pending', handoffId: handoff.id, changed: before !== recoverySignature(run, task) };
  }

  const latest = journalRecord?.latest;
  const transitionWasPersisted = latest?.handoffId === handoff.id;
  let changed = false;
  if (transitionWasPersisted) changed = applyJournalTaskSnapshot(task, latest) || changed;
  task.handoffId = handoff.id;
  task.handoffRecipient = handoff.sessionStartedFor || handoff.claimedBy || handoff.recipient || task.handoffRecipient || '';
  task.handoff = handoff.context || task.handoff || '';

  if (handoff.status === 'claimed' && transitionWasPersisted
    && ['ready', 'waitingDependency'].includes(latest.status) && !latest.sessionId) {
    const eventAdded = recordRecoveryEvent(task, handoff, 'handoff-transition-recovered',
      'A transferência e a sessão anterior foram registradas antes do reinício; a tarefa será retomada com o destinatário selecionado.');
    changed = eventAdded || changed;
    run.status = 'approved';
    run.paused = false;
    return { action: 'resume-recipient', handoffId: handoff.id, changed: before !== recoverySignature(run, task) };
  }

  if (handoff.status === 'session-started') {
    if (transitionWasPersisted) changed = applyJournalTaskSnapshot(task, latest) || changed;
    task.sessionId = handoff.sessionId;
    task.handoffReceipt = {
      status: 'session-started', sessionId: handoff.sessionId,
      at: Number(handoff.sessionStartedAt) || 0
    };
    if (transitionWasPersisted && ['complete', 'awaitingReview', 'cancelled'].includes(latest.status)) {
      recordRecoveryEvent(task, handoff, 'handoff-result-recovered',
        `O diário já contém o estado ${latest.status} e o resultado persistido da tarefa; a recuperação preservou esse estado.`);
      restoreRunStatusFromTasks(run);
      return { action: 'preserve-persisted-result', handoffId: handoff.id, changed: before !== recoverySignature(run, task) };
    }
    task.status = 'blocked';
    task.error = 'A sessão destinatária foi aberta antes do reinício, mas a resposta da tarefa não foi preservada. Inspecione essa sessão antes de retomá-la ou transferir a tarefa.';
    recordRecoveryEvent(task, handoff, 'handoff-session-recovered',
      `Vínculo recuperado do diário: sessão ${handoff.sessionId}. O resultado permanece sem confirmação.`);
    run.status = 'blocked';
    run.paused = true;
    return { action: 'inspect-recipient-session', handoffId: handoff.id, changed: before !== recoverySignature(run, task) };
  }

  task.status = 'blocked';
  task.error = 'A transferência foi reivindicada, mas não há registro durável de que a sessão anterior parou ou de que o destinatário iniciou. Inspecione a sessão antes de continuar.';
  recordRecoveryEvent(task, handoff, 'handoff-claim-recovered-uncertain',
    'A extensão reiniciou durante a transferência; o estado da sessão anterior e do destinatário é incerto.');
  run.status = 'blocked';
  run.paused = true;
  return { action: 'inspect-uncertain-transfer', handoffId: handoff.id, changed: before !== recoverySignature(run, task) };
}

function restoreHandoffSession(task, handoff) {
  if (!task || !handoff || handoff.status !== 'session-started' || !handoff.sessionId) return false;
  if (task.handoffId && task.handoffId !== handoff.id) return false;

  const changed = task.sessionId !== handoff.sessionId || task.handoffReceipt?.status !== 'session-started';
  task.handoffId = handoff.id;
  task.handoffRecipient = handoff.sessionStartedFor || handoff.recipient;
  task.sessionId = handoff.sessionId;
  task.handoffReceipt = {
    status: 'session-started',
    sessionId: handoff.sessionId,
    at: Number(handoff.sessionStartedAt) || 0
  };

  if (task.status === 'starting') {
    task.status = 'blocked';
    task.error = 'O Extension Host reiniciou após registrar a abertura da sessão destinatária. O resultado da tarefa não foi salvo; inspecione ou estacione essa sessão antes de tentar novamente ou transferir.';
    task.history = Array.isArray(task.history) ? task.history : [];
    if (!task.history.some(event => event.event === 'handoff-session-recovered' && event.handoffId === handoff.id)) {
      task.history.push({
        at: Date.now(), event: 'handoff-session-recovered', handoffId: handoff.id,
        detail: `Vínculo recuperado do diário: sessão ${handoff.sessionId}. Estado bloqueado para revisão porque o resultado do agente não foi confirmado.`
      });
    }
    return true;
  }
  return changed;
}

module.exports = { applyJournalTaskSnapshot, reconcileHandoffRecovery, restoreHandoffSession, restoreRunStatusFromTasks };

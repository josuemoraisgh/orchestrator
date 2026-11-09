'use strict';

function applyPendingDispatchAbort(task, run) {
  if (!task || !run) return false;
  if (run.paused && task.status === 'starting') {
    task.status = 'ready';
    task.attempts = Math.max(0, (Number(task.attempts) || 0) - 1);
    task.error = '';
    task.history ||= [];
    task.history.push({ at: Date.now(), event: 'paused-before-dispatch', detail: 'A pausa foi solicitada antes da abertura da sessão Lich; nenhuma tentativa de agente foi consumida.' });
    return true;
  }
  if (['cancelling', 'cancelled'].includes(run.status) || ['cancelling', 'cancelled'].includes(task.status)) {
    if (['starting', 'cancelling'].includes(task.status)) task.attempts = Math.max(0, (Number(task.attempts) || 0) - 1);
    task.status = 'cancelled';
    task.error = '';
    task.history ||= [];
    task.history.push({ at: Date.now(), event: 'cancelled-before-dispatch', detail: 'O cancelamento foi recebido antes da abertura da sessão Lich; nenhuma tentativa de agente foi consumida.' });
    return true;
  }
  return false;
}

module.exports = { applyPendingDispatchAbort };

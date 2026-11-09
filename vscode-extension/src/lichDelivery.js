'use strict';

const NON_ANSWERED = new Set(['unread', 'unanswered', 'undelivered', 'stopped', 'expired']);
const DELIVERY_MESSAGES = {
  unread: 'A tarefa chegou à sessão, mas não há confirmação de que o agente a leu.',
  unanswered: 'O agente encerrou o turno sem responder pelo ticket; confira a sessão do provedor.',
  undelivered: 'A tarefa não chegou ao prompt do agente.',
  stopped: 'A sessão foi parada antes de responder ao ticket.',
  expired: 'O ticket expirou sem uma resposta recuperável.'
};

function normalizeLichStartDelivery(delivery) {
  const status = String(delivery?.status || '').trim().toLowerCase();
  const answer = String(delivery?.answer || '').trim();
  if (status === 'answered' && answer) return { status: 'awaitingReview', deliveryStatus: status, answer, error: '' };
  if (status === 'pending' && typeof delivery?.ticket === 'string' && delivery.ticket) {
    return { status: 'running', deliveryStatus: status, ticket: delivery.ticket, answer: '', error: '' };
  }
  if (NON_ANSWERED.has(status)) {
    return { status: 'blocked', deliveryStatus: status, ticket: String(delivery?.ticket || ''), answer: '', error: DELIVERY_MESSAGES[status] };
  }
  return {
    status: 'blocked', deliveryStatus: status || 'unknown', ticket: String(delivery?.ticket || ''), answer: '',
    error: status === 'answered' ? 'Lich marcou o ticket como respondido, mas não forneceu uma resposta.'
      : status === 'pending' ? 'Lich marcou o ticket como pendente sem fornecer uma identidade para acompanhá-lo.'
        : `Estado de entrega Lich desconhecido: ${status || '(ausente)'}. A tarefa foi preservada para inspeção.`
  };
}

function structuredOutput(text) {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch { return undefined; }
}

function normalizeLichWaitOutcome(outcome, fallbackAnswer) {
  const body = structuredOutput(String(outcome?.stdout || '')) || structuredOutput(String(outcome?.stderr || ''));
  const status = String(body?.status || '').trim().toLowerCase();
  const answer = String(body?.answer || body?.result || '').trim();
  if (status === 'answered' && answer) return { status: 'answered', deliveryStatus: status, result: answer };
  if (!status && answer) return { status: 'answered', deliveryStatus: 'answered', result: answer };
  if (NON_ANSWERED.has(status)) return { status: 'failed', deliveryStatus: status, stopped: status === 'stopped', error: DELIVERY_MESSAGES[status] };
  if (status === 'answered') return { status: 'failed', deliveryStatus: status, error: 'Lich encerrou o ticket sem um campo de resposta verificável.' };
  if (status === 'pending' || outcome?.code === 2) return { status: 'pending', deliveryStatus: 'pending' };
  if (outcome?.code === 0) {
    if (body) return { status: 'failed', deliveryStatus: status || 'unknown', error: `Resposta JSON Lich sem um estado de entrega reconhecido: ${status || '(ausente)'}.` };
    const result = String(fallbackAnswer || outcome.stdout || '').trim();
    return result ? { status: 'answered', deliveryStatus: 'answered', result } : { status: 'failed', deliveryStatus: 'answered', error: 'Lich concluiu o ticket sem uma resposta verificável.' };
  }
  return {
    status: 'failed', deliveryStatus: status || 'failed', stopped: /stopped/i.test(`${outcome?.stdout || ''}\n${outcome?.stderr || ''}`),
    error: String(body?.error || body?.message || outcome?.stderr || outcome?.stdout || `lich wait exited ${outcome?.code ?? -1}`)
  };
}

module.exports = { normalizeLichStartDelivery, normalizeLichWaitOutcome };

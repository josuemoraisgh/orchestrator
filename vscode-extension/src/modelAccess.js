'use strict';

function modelAccessStatus(accessInformation, model) {
  if (!model || typeof accessInformation?.canSendRequest !== 'function') return 'unknown';
  try {
    const state = accessInformation.canSendRequest(model);
    if (state === true) return 'authorized';
    if (state === false) return 'blocked';
    return 'consent-required';
  } catch {
    return 'unknown';
  }
}

function modelAccessLabel(status) {
  return ({
    authorized: 'acesso confirmado pelo VS Code',
    blocked: 'o VS Code informa que o acesso não está autorizado',
    'consent-required': 'o VS Code pode solicitar acesso na primeira chamada',
    unknown: 'acesso será confirmado no envio'
  })[status] || 'acesso será confirmado no envio';
}

module.exports = { modelAccessStatus, modelAccessLabel };

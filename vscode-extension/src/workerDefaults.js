'use strict';

function supportsWorker(provider) {
  return Boolean((provider?.canRunInLich && provider.cliKind)
    || provider?.canRunInVscodeModel
    || provider?.canRunCodexAppServer
    || provider?.canRunClaudeCode);
}

function resolveWorkerDefaults(providers = [], requested = {}) {
  const candidates = providers.filter(supportsWorker);
  const provider = candidates.find(item => item.id === String(requested.provider || '')) || candidates[0];
  const model = String(requested.model || '').trim();
  const effort = String(requested.effort || '').trim();
  const hasNativeCli = Boolean(provider?.canRunCodexAppServer || provider?.canRunClaudeCode);

  if (effort && provider?.canRunInVscodeModel && !hasNativeCli && !provider.canRunInLich) {
    throw new Error(`${provider.name} does not expose a generic effort setting through the VS Code API.`);
  }
  if (model && provider?.canRunInLich && !hasNativeCli && ['crush', 'shell'].includes(provider.id)) {
    throw new Error(`The compatibility executor does not accept --model for ${provider.id}.`);
  }
  if (effort && provider?.canRunInLich && !hasNativeCli && ['opencode', 'crush', 'cursor', 'shell'].includes(provider.id)) {
    throw new Error(`The compatibility executor does not accept --effort for ${provider.id}.`);
  }

  return { provider: provider?.id || '', model, effort };
}

module.exports = { supportsWorker, resolveWorkerDefaults };

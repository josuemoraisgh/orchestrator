'use strict';

function upstreamSyncInvocation(config) {
  const upstreams = Array.isArray(config?.upstreams) ? config.upstreams : [];
  if (upstreams.length === 0) {
    return { invocationMessage: 'No upstreams are configured; no changes will be made.' };
  }
  return {
    invocationMessage: 'Synchronizing project upstreams',
    confirmationMessages: {
      title: 'Update project upstreams?',
      message: 'Fetch and fast-forward only the repositories declared in .ai/orchestrator.json. Dirty repositories stop the operation.'
    }
  };
}

module.exports = { upstreamSyncInvocation };

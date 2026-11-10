'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { upstreamSyncInvocation } = require('../src/upstreamSyncInvocation');

test('does not request confirmation when upstream sync is a no-op', () => {
  assert.deepEqual(upstreamSyncInvocation({ upstreams: [] }), {
    invocationMessage: 'No upstreams are configured; no changes will be made.'
  });
});

test('retains confirmation when configured upstreams may be updated', () => {
  assert.deepEqual(upstreamSyncInvocation({ upstreams: [{ path: 'vendor/lich' }] }), {
    invocationMessage: 'Synchronizing project upstreams',
    confirmationMessages: {
      title: 'Update project upstreams?',
      message: 'Fetch and fast-forward only the repositories declared in .ai/orchestrator.json. Dirty repositories stop the operation.'
    }
  });
});

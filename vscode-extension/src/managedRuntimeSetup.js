'use strict';

async function ensureManagedAiMemory(memoryRuntime, progress) {
  if (!memoryRuntime || typeof memoryRuntime.ensure !== 'function') {
    throw new Error('The managed AI Memory runtime is unavailable.');
  }
  const connection = await memoryRuntime.ensure();
  if (!connection?.version || !connection?.executable) {
    throw new Error('AI Memory did not confirm its runtime version and executable.');
  }
  const version = String(connection.version).replace(/^v(?=\d)/i, '');
  const normalized = { ...connection, version };
  progress?.report({ message: `AI Memory ${version} ready`, increment: 100 });
  return normalized;
}

module.exports = { ensureManagedAiMemory };

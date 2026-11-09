const readline = require('node:readline');

const endpoint = process.env.ORCHESTRATOR_PERMISSION_URL;
const token = process.env.ORCHESTRATOR_PERMISSION_TOKEN;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function respond(id, result, error) {
  process.stdout.write(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }) + '\n');
}

input.on('line', async line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (!Object.hasOwn(message, 'id')) return;
  const { id, method, params = {} } = message;
  if (method === 'initialize') {
    respond(id, { protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'orchestrator-permissions', version: '1.0.0' } });
  } else if (method === 'ping') {
    respond(id, {});
  } else if (method === 'tools/list') {
    respond(id, { tools: [{ name: 'prompt', description: 'Ask the Orchestrator user to approve a Claude Code tool call.', inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object', additionalProperties: true } }, required: ['tool_name', 'input'], additionalProperties: false } }] });
  } else if (method === 'tools/call' && params.name === 'prompt') {
    try {
      if (!endpoint || !token) throw new Error('Approval bridge is unavailable.');
      const result = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(params.arguments || {}) });
      if (!result.ok) throw new Error(`Approval bridge returned ${result.status}.`);
      const decision = await result.json();
      respond(id, { content: [{ type: 'text', text: JSON.stringify(decision) }], isError: false });
    } catch (error) {
      respond(id, { content: [{ type: 'text', text: JSON.stringify({ behavior: 'deny', message: String(error.message || error) }) }], isError: false });
    }
  } else {
    respond(id, undefined, { code: -32601, message: 'Method not found.' });
  }
});

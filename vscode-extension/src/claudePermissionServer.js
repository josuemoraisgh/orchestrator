const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');

function safeMessage(value) {
  return JSON.stringify(value).replace(/\b(?:sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+)\b/g, '[credential redacted]').slice(0, 12000);
}

async function inside(root, target) {
  const path = require('node:path');
  const base = await fs.realpath(path.resolve(root));
  let resolved = path.resolve(base, String(target || '.'));
  const missing = [];
  while (true) {
    try {
      resolved = path.join(await fs.realpath(resolved), ...missing.reverse());
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return false;
      const parent = path.dirname(resolved);
      if (parent === resolved) return false;
      missing.push(path.basename(resolved));
      resolved = parent;
    }
  }
  const relative = path.relative(base, resolved);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function createClaudePermissionServer(options) {
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/approve' || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > 64000) {
        response.writeHead(413).end();
        return;
      }
    }
    try {
      const input = JSON.parse(body);
      const tool = String(input.tool_name || 'unknown').slice(0, 120);
      const args = input.input && typeof input.input === 'object' ? input.input : {};
      const candidatePaths = [args.file_path, args.path, args.cwd].filter(Boolean);
      if ((await Promise.all(candidatePaths.map(value => inside(options.root, value)))).some(value => !value)) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ behavior: 'deny', message: 'Requested path is outside the task checkout.' }));
        return;
      }
      const action = tool.toLowerCase() === 'bash'
        ? `Claude quer executar um comando no checkout da tarefa:\n\n${String(args.command || '(comando não informado)').slice(0, 5000)}\n\nDiretório: ${String(args.cwd || options.root).slice(0, 1000)}`
        : `Claude solicita permissão para usar ${tool} com estes dados:\n\n${safeMessage(args)}`;
      const choice = await options.requestApproval(action);
      const result = choice
        ? { behavior: 'allow', updatedInput: args }
        : { behavior: 'deny', message: 'Permission denied by the Orchestrator user.' };
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch {
      response.writeHead(400).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/approve`,
    token,
    close: () => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections?.();
    })
  };
}

module.exports = { createClaudePermissionServer };

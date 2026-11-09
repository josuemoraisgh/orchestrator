'use strict';

const SECRET_ASSIGNMENT = /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|token|password|passwd|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?access[_-]?key[_-]?id|account[_-]?key|private[_-]?key|connection[_-]?string|secret|client[_-]?secret)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi;
const CREDENTIAL = /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,})\b/gi;

function redactSensitiveText(value, max = 12000) {
  return String(value || '')
    .replace(/-----BEGIN (?:(?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----[\s\S]*?-----END (?:(?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/gi, '[REDACTED PRIVATE KEY]')
    .replace(/\b(Bearer|Basic)\s+[^\s"'`,;]+/gi, '$1 [REDACTED]')
    .replace(SECRET_ASSIGNMENT, '$1"[REDACTED]"')
    .replace(CREDENTIAL, '[REDACTED CREDENTIAL]')
    .slice(0, Math.max(0, Number(max) || 0));
}

module.exports = { redactSensitiveText };

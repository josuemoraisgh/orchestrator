'use strict';

const crypto = require('node:crypto');

function createWebviewSecurity(webview) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`
  ].join('; ');
  return { nonce, csp };
}

module.exports = { createWebviewSecurity };

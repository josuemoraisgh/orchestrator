'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { redactSensitiveText } = require('../src/secretRedaction');

test('redacts quoted multiword secrets and preserves surrounding text', () => {
  const value = 'Result: {"password": "duas palavras secretas", "api_key": "first second", token: Bearer abc.def} done';
  const redacted = redactSensitiveText(value);
  assert.match(redacted, /Result:/);
  assert.match(redacted, /done$/);
  assert.doesNotMatch(redacted, /duas palavras secretas|first second|abc\.def/);
});

test('preserves natural-language progress tokens and still redacts structured token fields', () => {
  const progress = 'Progress token: CLAUDE_PROGRESS_abc123 is present.\n';
  const structured = '{"token": "private-access-token", "access_token": "another-secret"}';
  const redacted = redactSensitiveText(progress + structured);

  assert.match(redacted, /Progress token: CLAUDE_PROGRESS_abc123 is present/);
  assert.doesNotMatch(redacted, /private-access-token|another-secret/);
  assert.match(redacted, /"token": "\[REDACTED\]"/);
  assert.match(redacted, /"access_token": "\[REDACTED\]"/);
});

test('redacts provider tokens and complete private key blocks', () => {
  const value = [
    'github_pat_abcdefghijklmnopqrstuvwxyz123456',
    'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    'npm_abcdefghijklmnopqrstuvwxyz1234567890abcd',
    'hf_abcdefghijklmnopqrstuvwxyz1234567890abcd',
    'AIza0123456789abcdefghijklmnopqrstuvwx',
    '-----BEGIN PRIVATE KEY-----',
    'private-material-that-must-not-persist',
    '-----END PRIVATE KEY-----'
  ].join('\n');
  const redacted = redactSensitiveText(value);
  assert.doesNotMatch(redacted, /github_pat_|ghp_|private-material-that-must-not-persist/);
  assert.doesNotMatch(redacted, /npm_abcdefghijklmnopqrstuvwxyz|hf_abcdefghijklmnopqrstuvwxyz|AIza0123456789/);
  assert.match(redacted, /REDACTED PRIVATE KEY/);
});

test('redacts AWS credential assignments and DSA private key blocks', () => {
  const value = 'aws_secret_access_key="multi word aws secret"\n-----BEGIN DSA PRIVATE KEY-----\nprivate-dsa-value\n-----END DSA PRIVATE KEY-----';
  const redacted = redactSensitiveText(value);
  assert.doesNotMatch(redacted, /multi word aws secret|private-dsa-value/);
  assert.match(redacted, /REDACTED PRIVATE KEY/);
});

test('redaction respects the configured storage bound', () => {
  assert.equal(redactSensitiveText('api_key=secret-value and more', 16), 'api_key="[REDACT');
});

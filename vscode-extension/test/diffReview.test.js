'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseAddedDiffLines, validateAddedDiffLocation } = require('../src/diffReview');

const diff = [
  'diff --git a/src/input.js b/src/input.js',
  'index 1111111..2222222 100644',
  '--- a/src/input.js',
  '+++ b/src/input.js',
  '@@ -4,3 +4,4 @@ function parse(value) {',
  '   if (value == null) return false;',
  '+  if (value.length === 0) return false;',
  '   return true;',
  ' }'
].join('\n');

test('diff parser maps added lines to safe relative paths and new-file line numbers', () => {
  const lines = parseAddedDiffLines(diff);
  assert.deepEqual([...lines.keys()], ['src/input.js']);
  assert.deepEqual([...lines.get('src/input.js')], [5]);
  assert.deepEqual(validateAddedDiffLocation(diff, 'src/input.js', 5), { valid: true, path: 'src/input.js', line: 5 });
});

test('diff parser rejects unchanged, deleted, absolute, and traversing locations', () => {
  assert.equal(validateAddedDiffLocation(diff, 'src/input.js', 4).valid, false);
  assert.equal(validateAddedDiffLocation(diff, 'src/input.js', 99).valid, false);
  assert.equal(validateAddedDiffLocation(diff, '../secret.js', 5).valid, false);
  assert.equal(validateAddedDiffLocation(diff, 'C:/secret.js', 5).valid, false);
});

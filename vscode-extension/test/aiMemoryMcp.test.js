'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMemoryQueryInput } = require('../src/aiMemoryMcp');

test('memory_query input follows the official tool schema and bounds page count', () => {
  const tool = { inputSchema: { properties: {
    query: { type: 'string' },
    limit: { type: ['integer', 'null'], minimum: 0, maximum: 100 }
  } } };
  assert.deepEqual(buildMemoryQueryInput(tool, ' prior migration decisions ', 6), { query: 'prior migration decisions', limit: 6 });
  assert.equal(buildMemoryQueryInput(tool, 'x'.repeat(2100), 500).query.length, 2000);
  assert.equal(buildMemoryQueryInput(tool, 'search', 500).limit, 100);
  assert.throws(() => buildMemoryQueryInput(tool, 'search', 0), /positive integer/);
  assert.throws(() => buildMemoryQueryInput(tool, 'search', ''), /positive integer/);
});

test('memory_query input supports alternate query field names and rejects unsupported schemas', () => {
  assert.deepEqual(buildMemoryQueryInput({ inputSchema: { properties: { q: { type: 'string' } } } }, 'search this'), { q: 'search this' });
  assert.throws(() => buildMemoryQueryInput({ inputSchema: { properties: { path: { type: 'string' } } } }, 'search'), /does not declare a supported query field/);
  assert.throws(() => buildMemoryQueryInput({ inputSchema: { properties: { query: { type: 'string' } } } }, '   '), /non-empty query/);
});

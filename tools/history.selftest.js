#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { updateHistory } = require('./history');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-history-'));
let count = 0;
const check = (name, fn) => { fn(); count++; console.log(`✓ ${name}`); };
const one = { ts: '2026-11-02T10:00:00Z', process: 'edit-text', output: '2026-11-02_правка', итог: 'не получилось: сбой', outcome: 'failed' };
const two = { ...one, output: '2026-11-02_другое', итог: 'готово', outcome: 'success' };
const log = path.join(cwd, '.history/runs.jsonl');
const read = () => fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
try {
  for (const row of [one, two]) fs.mkdirSync(path.join(cwd, 'outputs', row.output), { recursive: true });
  check('creates history', () => { updateHistory(cwd, one); assert.equal(read().length, 1); });
  check('repeated completion is idempotent', () => { updateHistory(cwd, one); assert.equal(read().length, 1); });
  updateHistory(cwd, two);
  check('resume replaces old result and preserves other runs', () => { updateHistory(cwd, { ...one, итог: 'готово', outcome: 'success' }); assert.equal(read().length, 2); assert.equal(read()[0].output, two.output); assert.equal(read()[1].outcome, 'success'); });
  check('does not overwrite corrupted history', () => { fs.appendFileSync(log, 'broken\n'); const bytes = fs.readFileSync(log); assert.throws(() => updateHistory(cwd, two)); assert.deepEqual(fs.readFileSync(log), bytes); fs.writeFileSync(log, JSON.stringify(one) + '\n'); });
  check('does not remove an existing lock', () => { const lock = path.join(cwd, '.history/.lock'); fs.mkdirSync(lock); assert.throws(() => updateHistory(cwd, two)); assert.ok(fs.existsSync(lock)); fs.rmdirSync(lock); });
  check('rejects output outside results', () => assert.throws(() => updateHistory(cwd, { ...one, output: '../other' })));
  check('rejects transcript or secret fields', () => assert.throws(() => updateHistory(cwd, { ...one, transcript: 'not allowed' })));
  console.log(`History: ${count} passed.`);
} finally { fs.rmSync(cwd, { recursive: true, force: true }); }

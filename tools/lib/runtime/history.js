#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validRunFolderName } = require('../core/paths');
function updateHistory(cwd, record, {recover=false}={}) {
  const required = ['ts', 'process', 'output', 'итог'];
  const allowed = new Set([...required, 'уровень', 'режим', 'outcome']);
  if (!record || typeof record !== 'object' || Array.isArray(record) || required.some(k => typeof record[k] !== 'string' || !record[k]) || Object.keys(record).some(k => !allowed.has(k))) throw new Error('Некорректная запись истории');
  if (Object.values(record).some(value => typeof value !== 'string') ||
      (record.outcome && !['success', 'failed', 'draft'].includes(record.outcome))) throw new Error('Некорректный исход истории');
  if (!validRunFolderName(record.output)) throw new Error('Некорректное имя output');
  const output = path.join(cwd, 'outputs', record.output);
  if (!fs.statSync(output).isDirectory() || fs.lstatSync(output).isSymbolicLink()) throw new Error('Нет папки результата');
  const dir = path.join(cwd, '.history');
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('Папка истории не должна быть ссылкой');
  fs.mkdirSync(dir, { recursive: true });
  const release = require('./run-storage').lock(dir,recover,'.lock');
  const log = path.join(dir, 'runs.jsonl');
  const temp = path.join(dir, `.runs-${randomUUID()}.tmp`);
  try {
    if (fs.existsSync(log) && fs.lstatSync(log).isSymbolicLink()) throw new Error('История не должна быть ссылкой');
    const rows = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean) : [];
    const previous = rows.map(row => {
      const value = JSON.parse(row);
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.output !== 'string') throw new Error('Повреждённая история: исходный файл сохранён');
      return value;
    });
    if (previous.filter(row => row.output === record.output).length === 1 && JSON.stringify(previous.find(row => row.output === record.output)) === JSON.stringify(record)) return;
    const next = rows.filter((_, i) => previous[i].output !== record.output);
    next.push(JSON.stringify(record));
    fs.writeFileSync(temp, next.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, log);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    release();
  }
}
module.exports = { updateHistory };

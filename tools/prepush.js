#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const { root } = require('./paths');
const cwd = root();
const input = fs.readFileSync(0, 'utf8');
const [remote, address] = process.argv.slice(2);
const git = (...args) => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
function reject(message) { console.error(message); process.exit(1); }
if (!remote || !address) reject('Не указан адрес отправки. Защита не проверена.');
const own = git('remote', 'get-url', '--push', '--all', 'mine')?.split('\n') || [];
const common = git('remote', 'get-url', '--push', '--all', 'origin')?.split('\n') || [];
const isOwn = git('config', 'branch.my.pushRemote') === 'mine' && own.includes(address) && !common.includes(address);
if (!isOwn) {
  for (const line of input.split('\n').filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) reject('Не удалось разобрать состав отправки.');
    const [local, sha, target, before] = fields;
    if (local === 'refs/heads/my' || target === 'refs/heads/my') reject('Личную копию нельзя отправить в общий репозиторий.');
    if (local.startsWith('refs/notes/') || target.startsWith('refs/notes/')) reject('Служебные заметки GigaCode не отправляются в общий репозиторий.');
    const zero = /^0+$/;
    if (zero.test(sha)) reject(`Удаление в общем репозитории запрещено: ${target}.`);
    if (!zero.test(before) && sha !== before) {
      if (!target.startsWith('refs/heads/')) reject(`Перезапись существующей ссылки запрещена: ${target}.`);
      if (git('merge-base', '--is-ancestor', before, sha) === null) reject(`Перезапись истории запрещена: ${target}.`);
    }
  }
}
// Preserve a pre-existing user hook, including its stdin and failure status.
const previous = git('config', '--local', 'processkit.previousPrePush');
if (previous) {
  const result = spawnSync(previous, [remote, address], { cwd, input, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error || result.status !== 0) reject('Ранее установленная проверка отправки отклонила действие.');
}

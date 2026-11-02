#!/usr/bin/env node
// Самопроверка hook pre-push: во временной папке собирается репозиторий, и hook
// вызывается напрямую на наборах «что отправляется» — как это сделал бы git.
// Ничего никуда не отправляется, адреса вымышленные.
// Запуск: node tools/check-prepush.js
// Хук — файл sh, его запускает git; для проверки нужна sh из состава Git
// (в windows — вместе с ним). Без sh набор не прогоняется: проверка не зелёная.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', '.gigacode', 'hooks', 'pre-push');
const ZERO = '0000000000000000000000000000000000000000';
const C = '1111111111111111111111111111111111111111';
const COMMON = 'ssh://common/repo.git';
const MINE = 'ssh://mine/repo.git';

function findSh() {
  const names = process.platform === 'win32' ? ['sh.exe', 'sh'] : ['sh'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const p = path.join(dir, n);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch (e) { /* нет такого — смотрим дальше */ }
    }
  }
  for (const p of [
    'C:\\Program Files\\Git\\bin\\sh.exe',
    'C:\\Program Files\\Git\\usr\\bin\\sh.exe',
    'C:\\Program Files (x86)\\Git\\bin\\sh.exe',
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const sh = findSh();
if (!sh) {
  console.log('Не нашёл sh (нужна sh из состава Git): набор hook не проверен.');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-prepush-'));

function git(...args) {
  return execFileSync('git', args, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function unset(key) {
  try { git('config', '--unset', key); } catch (e) { /* нечего снимать */ }
}

// args — то, что git передаёт хуку: адрес, флаги; вывод — его код выхода.
function push(refs, ...args) {
  try {
    execFileSync(sh, [HOOK, ...args], {
      cwd: tmp, input: `${refs}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, out: '' };
  } catch (e) {
    if (e.status === null || e.status === undefined) throw e;
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

let failed = 0;
let passed = 0;

function run(name, [refs, args, want]) {
  const { code, out } = push(refs, ...args);
  if (code === want) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}: ожидали код ${want}, получили ${code}`);
    for (const line of out.trim().split('\n')) if (line) console.log(`       ${line}`);
  }
}

try {
  git('init', '-q', '-b', 'master');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'remote.mine.url', MINE);

  // Ветка my отправляется только в свой репозиторий: для общего он не настроен.
  console.log('Запрещено в общий репозиторий:');
  run('личная ветка my', [`refs/heads/my ${C} refs/heads/my ${C}`, ['origin', COMMON], 1]);
  run('локальные заметки', [`refs/notes/gigacode ${C} refs/notes/gigacode ${ZERO}`, ['origin', COMMON], 1]);
  run('удаление ветки', [`(delete) ${ZERO} refs/heads/team-x ${C}`, ['origin', COMMON], 1]);
  run('удаление заметок', [`(delete) ${ZERO} refs/notes/gigacode ${C}`, ['origin', COMMON], 1]);
  run('--force', [`refs/heads/master-x ${C} refs/heads/master-x ${C}`, ['origin', COMMON, '--force'], 1]);
  run('--force-with-lease', [`refs/heads/master-x ${C} refs/heads/master-x ${C}`, ['origin', COMMON, '--force-with-lease'], 1]);
  run('--mirror', [`refs/heads/master-x ${C} refs/heads/master-x ${C}`, ['origin', COMMON, '--mirror'], 1]);
  run('+refspec', [`refs/heads/master-x ${C} refs/heads/master-x ${C}`, ['origin', COMMON, '+refs/heads/master-x:refs/heads/master-x'], 1]);

  console.log('Разрешено:');
  run('новая своя ветка', [`refs/heads/master-x ${C} refs/heads/master-x ${ZERO}`, ['origin', COMMON], 0]);
  run('обновление своей ветки', [`refs/heads/master-x ${C} refs/heads/master-x ${C}`, ['origin', COMMON], 0]);

  console.log('Собственный репозиторий (mine):');
  git('config', 'branch.my.pushRemote', 'mine');
  run('my в свой репозиторий', [`refs/heads/my ${C} refs/heads/my ${C}`, ['origin', MINE], 0]);
  run('удаление ветки в своём', [`(delete) ${ZERO} refs/heads/team-x ${C}`, ['origin', MINE], 0]);
  git('config', 'branch.my.pushRemote', 'no_push');
  run('при no_push общий адрес защищён', [`refs/heads/my ${C} refs/heads/my ${C}`, ['origin', COMMON], 1]);
  unset('branch.my.pushRemote');
} catch (e) {
  failed += 1;
  console.log(`✗ набор не выполнился: ${e.message}`);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* держится процессом — не результат проверки */ }
}

if (failed === 0) console.log(`\nВсе проверки hook прошли (${passed}).`);
else console.log(`\nПровалено: ${failed}, прошло: ${passed}.`);
process.exit(failed === 0 ? 0 : 1);
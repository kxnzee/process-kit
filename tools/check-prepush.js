#!/usr/bin/env node
// Integration: real git push to local disposable bare repositories; no network.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-hooks-'));
const cwd = path.join(temp, 'kit');
fs.mkdirSync(cwd);
let passed = 0;
function cmd(binary, args, expected = 0, location = cwd) {
  const result = spawnSync(binary, args, { cwd: location, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' } });
  if (expected === 0) assert.equal(result.status, 0, `${binary} ${args.join(' ')}: ${result.stderr}`);
  else assert.notEqual(result.status, 0, `${args.join(' ')} unexpectedly succeeded`);
  return result;
}
const git = (...args) => cmd('git', args).stdout.trim();
function test(name, args, succeeds) { cmd('git', args, succeeds ? 0 : 1); passed++; console.log(`✓ ${name}`); }
try {
  git('init', '-q', '-b', 'master'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  for (const file of ['tools/paths.js', 'tools/prepush.js', 'tools/install-hooks.js', 'tools/commit-guard.js', '.gigacode/hooks/pre-push', '.gigacode/hooks/pre-commit']) {
    const dest = path.join(cwd, file); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', file), dest);
  }
  fs.writeFileSync(path.join(cwd, 'file'), 'base'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  for (const name of ['origin', 'mine']) {
    const bare = path.join(temp, `${name}.git`); cmd('git', ['init', '--bare', '-q', bare]); git('remote', 'add', name, bare);
  }
  cmd(process.execPath, ['tools/install-hooks.js']);
  cmd(process.execPath, ['tools/install-hooks.js']);
  test('новая ветка', ['push', 'origin', 'master:master-check'], true);
  fs.writeFileSync(path.join(cwd, 'file'), 'next'); git('add', 'file'); git('commit', '-qm', 'next');
  test('обычный fast-forward', ['push', 'origin', 'master:master-check'], true);
  git('branch', 'my');
  test('my в общий', ['push', 'origin', 'my'], false);
  test('my под другим именем', ['push', 'origin', 'my:renamed'], false);
  test('другая ветка в удалённую my', ['push', 'origin', 'master:my'], false);
  git('notes', '--ref=ai', 'add', '-m', 'local note');
  test('заметки', ['push', 'origin', 'refs/notes/ai'], false);
  test('удаление', ['push', 'origin', '--delete', 'master-check'], false);
  git('checkout', '-qb', 'master-divergent', base);
  fs.writeFileSync(path.join(cwd, 'other'), 'divergent'); git('add', 'other'); git('commit', '-qm', 'divergent');
  test('реальный force с перезаписью истории', ['push', '--force', 'origin', 'master-divergent:master-check'], false);
  git('config', 'branch.my.pushRemote', 'mine');
  test('my в собственный', ['push', 'mine', 'my'], true);
  git('remote', 'set-url', 'mine', git('remote', 'get-url', 'origin'));
  test('mine совпадает с общим адресом', ['push', 'mine', 'my'], false);
  const hook = path.join(cwd, '.git/hooks/pre-push');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n'); fs.chmodSync(hook, 0o755);
  cmd(process.execPath, ['tools/install-hooks.js']);
  cmd(process.execPath, ['tools/install-hooks.js']);
  test('прежний hook сохранён и блокирует', ['push', 'origin', 'master-divergent:master-new'], false);
  assert.match(fs.readFileSync(`${hook}.before-process-kit`, 'utf8'), /exit 1/);
  console.log(`Проверки реальной отправки: ${passed} пройдено.`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

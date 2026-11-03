#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { root } = require('./paths');
const cwd = root();
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
try {
  const hook = path.resolve(cwd, git('rev-parse', '--git-path', 'hooks/pre-push'));
  const source = fs.readFileSync(path.join(cwd, '.gigacode/hooks/pre-push'), 'utf8');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  if (fs.existsSync(hook) && !fs.readFileSync(hook, 'utf8').includes('Process Kit pre-push v2')) {
    const backup = `${hook}.before-process-kit`;
    if (fs.existsSync(backup)) throw new Error('Резервный hook уже существует: не перезаписываю его.');
    fs.copyFileSync(hook, backup); fs.chmodSync(backup, 0o755);
    git('config', '--local', 'processkit.previousPrePush', backup);
  }
  fs.writeFileSync(hook, source.replace(/\r\n/g, '\n'), { mode: 0o755 });
  fs.chmodSync(hook, 0o755);
  console.log('Защита отправки установлена в этой копии.');
} catch (error) { console.error(error.message); process.exit(1); }

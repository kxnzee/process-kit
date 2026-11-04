#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cwd = path.join(__dirname, '..');
for (const file of ['validate.js', 'validate.selftest.js', 'architecture.selftest.js', 'atomic-actions.selftest.js', 'run-journal.selftest.js', 'foundation.selftest.js', 'commit-guard.selftest.js', 'promotion-plan.selftest.js', 'history.selftest.js', 'check-report.js', 'check-report.selftest.js', 'prepush.selftest.js']) {
  console.log(`\n${file}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log('\nВсе локальные проверки пройдены. Приёмка GigaCode выполняется отдельно.');

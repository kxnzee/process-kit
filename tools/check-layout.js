#!/usr/bin/env node
// Прежнее имя проверки раскладки. Правила живут в validate.js; файл оставлен,
// чтобы прежние записи, привычка и ссылки в старых ветках не ломались.
// Запуск: node tools/check-layout.js [--team <код>] [--process <имя>] [--root <путь>]
//   — то же, что node tools/validate.js с теми же аргументами.

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const r = spawnSync(process.execPath, [path.join(__dirname, 'validate.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status === null ? 2 : r.status);
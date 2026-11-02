// Пути Process Kit в одном месте для кода: скрипты tools/ и hook pre-push.
// В текстах (скиллы, GIGACODE.md) корень задаётся разделом «Где лежат результаты».
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function root(cwd = process.cwd()) {
  const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  });
  return out.trim();
}

const OUTPUTS_DIR = 'outputs';
const RUN_SUBDIR = '.run';
const HISTORY_DIR = '.history';
const RUNS_LOG = 'runs.jsonl';
const CACHE_DIR = 'cache';

// Старые имена каталогов результатов: нужны только переносу в outputs/ (pp-ai-mentor).
const PROCESS_KIT_OLD_DIR = 'Process Kit';
const OLD_RUNS_DIR = '.runs';
const OLD_RUNS_IN_LEGACY = '.runs';

function outputs(base) {
  return path.join(base, OUTPUTS_DIR);
}

function runFolder(base, name) {
  return path.join(base, OUTPUTS_DIR, name);
}

function runFolderName(base, name) {
  return path.join(base, OUTPUTS_DIR, name, RUN_SUBDIR);
}

function history(base) {
  return path.join(base, HISTORY_DIR);
}

function runsLog(base) {
  return path.join(base, HISTORY_DIR, RUNS_LOG);
}

function cache(base) {
  return path.join(base, HISTORY_DIR, CACHE_DIR);
}

// Имя папки запуска: <ГГГГ-ММ-ДД>_<1–4 слова строчными через дефис>, без пробелов.
// Это единственный шаблон в коде: его читают генератор имени и проверка раскладки.
const RUN_FOLDER_NAME = /^(\d{4}-\d{2}-\d{2})_([a-zа-яё0-9]+(?:-[a-zа-яё0-9]+)*)$/;

function runFolderParts(name) {
  const m = String(name).match(RUN_FOLDER_NAME);
  return m ? { date: m[1], short: m[2] } : null;
}

function validRunFolderName(name) {
  return RUN_FOLDER_NAME.test(name);
}

function runFolderUnique(base, name) {
  if (!validRunFolderName(name)) return null;
  const taken = (candidate) => fs.existsSync(path.join(base, OUTPUTS_DIR, candidate));
  if (!taken(name)) return path.join(base, OUTPUTS_DIR, name);
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${name}-${i}`;
    if (!taken(candidate)) return path.join(base, OUTPUTS_DIR, candidate);
  }
  return null;
}

module.exports = {
  root,
  outputs,
  runFolder,
  runFolderName,
  history,
  runsLog,
  cache,
  OUTPUTS_DIR,
  RUN_SUBDIR,
  HISTORY_DIR,
  RUNS_LOG,
  CACHE_DIR,
  PROCESS_KIT_OLD_DIR,
  OLD_RUNS_DIR,
  OLD_RUNS_IN_LEGACY,
  RUN_FOLDER_NAME,
  runFolderParts,
  validRunFolderName,
  runFolderUnique,
};
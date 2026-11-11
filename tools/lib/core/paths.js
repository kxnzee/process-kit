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
// Имя папки запуска: <ГГГГ-ММ-ДД>_<1–4 слова строчными через дефис>, без пробелов.
// Это единственный шаблон в коде: его читают генератор имени и проверка раскладки.
const RUN_FOLDER_NAME = /^(\d{4}-\d{2}-\d{2})_([a-zа-яё0-9]+(?:-[a-zа-яё0-9]+)*)$/;

function runFolderParts(name) {
  const m = String(name).match(RUN_FOLDER_NAME);
  if (!m) return null;
  const date = new Date(`${m[1]}T00:00:00Z`);
  const short = m[2].replace(/-([2-9]|[1-9][0-9]+)$/, '');
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== m[1] || short.length > 40 || short.split('-').length > 4) return null;
  return { date: m[1], short: m[2] };
}

function validRunFolderName(name) {
  return runFolderParts(name) !== null;
}

// Portable file name: Windows device names are reserved even with an extension.
// html разрешён: отчёт владельцу отдают не только текстовым файлом, но и цельной
// страницей-одностраничником, который открывают в браузере без внешней публикации.
function validResultName(name) {
  return typeof name==='string' && /^[^./\\][^/\\]*\.(md|txt|json|html)$/.test(name) &&
    !/[<>:"|?*\x00-\x1f]/.test(name) && !/[ .]$/.test(name) &&
    !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/i.test(name);
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
  runFolderParts,
  validRunFolderName,
  validResultName,
  runFolderUnique,
};

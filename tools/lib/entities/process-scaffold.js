'use strict';

const fs = require('node:fs');
const { inside } = require('../core/safe-path');
const { parseFrontmatter } = require('../core/markdown');
const { NAME, owner } = require('./process-model');
const { canonicalFile, scopeFor, visible } = require('./process-facts');

function scaffold(cwd, spec) {
  const name = spec?.process;
  if (typeof name !== 'string' || !Object.hasOwn(spec, 'process') || Object.keys(spec).length !== 1) {
    throw new Error('scaffold: требуется только process — имя нового определения');
  }
  if (name.match(NAME)?.[0] !== name || name === 'example') throw new Error('Неверное имя процесса');
  const dir = `processes/${name}`;
  const file = `${dir}/PROCESS.md`;
  const ownership = owner(name);
  const prefix = ownership.level === 2 ? 'my-' : ownership.level === 1 ? `team-${ownership.team}-` : '';
  if (!canonicalFile(file) || !NAME.test(name.slice(prefix.length)) || (!prefix && name.startsWith('team-'))) {
    throw new Error('Неверное имя или префикс процесса');
  }
  const scope = scopeFor(cwd);
  const level = ['master', 'team', 'my'][ownership.level];
  if (scope.level !== level || !visible(name, scope)) {
    throw new Error('Имя процесса не соответствует уровню и владельцу текущей рабочей копии');
  }

  const source = fs.readFileSync(inside(cwd, 'processes/example/PROCESS.md'), 'utf8');
  const content = source
    .replace(/^name: example(?=\r?$)/m, `name: ${name}`)
    .replace(/^При создании своего скопируй всю папку и выполни README\.md\. /m, '');
  if (parseFrontmatter(content).data?.name !== name) throw new Error('Шаблон процесса повреждён');

  const target = inside(cwd, dir);
  try {
    fs.mkdirSync(target);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Путь процесса уже занят: ' + dir);
    throw error;
  }
  let definition;
  let fd;
  try {
    definition = inside(cwd, file);
    fd = fs.openSync(definition, 'wx');
    try {
      fs.writeFileSync(fd, content);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (fd !== undefined) fs.rmSync(definition, { force: true });
    try { fs.rmdirSync(target); } catch { /* Не удаляем чужие файлы из занятой папки. */ }
    throw error;
  }
  return { process: name, status: 'draft', file };
}

module.exports = { scaffold };

#!/usr/bin/env node
// Валидатор сущностей Process Kit. Node >= 18, без зависимостей, CommonJS.
//
// Запуск:
//   node tools/kit.js check                 проверить всё
//   node tools/kit.js check --only outputs  одну сущность (имена — в RULES внизу)
//   node tools/kit.js check --json          вывод для машин
//   node tools/kit.js check --root <папка>  другой корень (для тестов)
//   node tools/kit.js check --team <код>    команда для рабочей ветки команды
//   node tools/kit.js check --level <уровень> уровень явно: master | team | my (team — с --team)
//   node tools/kit.js check --process <имя> проверка перед запуском: только значения
//                                          конфига, на которые ссылается процесс
//
// Уровень иначе берётся из имени ветки, включая рабочие места переноса
// promote/master/<тема> и promote/team-<код>/<тема>.
//
// Уровни: ОШИБКА — нарушено принятое правило этапа 1, код выхода 1.
//         ВНИМАНИЕ — поле или правило из будущих пунктов, код выхода не меняет.
// Правила: docs/STRUCTURE.md и инструкции примеров у владельцев сущностей.

'use strict';

const fs = require('fs');
const path = require('path');
const { processModel, parameter, NAME } = require('../entities/process-model');
const { execFileSync } = require('child_process');

// ---------- аргументы и корень ----------

const args = process.argv.slice(2);
const opt = { json: false, only: null, root: null, team: null, process: null, level: null, demo: false, params: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--demo') opt.demo = true;
  else if (args[i] === '--params') opt.params = args[++i];
  else if (args[i] === '--json') opt.json = true;
  else if (args[i] === '--only') opt.only = args[++i];
  else if (args[i] === '--process') opt.process = args[++i];
  else if (args[i].startsWith('--process=')) opt.process = args[i].slice(10);
  else if (args[i] === '--root') opt.root = args[++i];
  else if (args[i] === '--team') opt.team = args[++i];
  else if (args[i].startsWith('--team=')) opt.team = args[i].slice(7);
  else if (args[i] === '--level') opt.level = args[++i];
  else if (args[i].startsWith('--level=')) opt.level = args[i].slice(8);
  else { console.error(`Неизвестный аргумент: ${args[i]}`); process.exit(2); }
}

for (const flag of ['--only', '--process', '--root', '--team', '--level', '--params']) {
  const i = args.indexOf(flag);
  if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith('--'))) { console.error(`Нужно значение ${flag}`); process.exit(2); }
}
if ((opt.demo || opt.params) && !opt.process) { console.error('--demo/--params требуют --process'); process.exit(2); }

function git(argv, cwd) {
  try {
    return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}

function findRoot() {
  if (opt.root) return path.resolve(opt.root);
  try {
    return require('../core/paths').root();
  } catch (e) { throw new Error('Не найден корень Git: передайте --root <папка>'); }
}

const ROOT = findRoot();

const { runFolderParts } = require('../core/paths');

const issues = [];
function report(level, entity, file, line, msg) {
  issues.push({ level, entity, file: file ? path.relative(ROOT, file) || '.' : '.', line: line || 0, msg });
}
const E = (entity, file, line, msg) => report('E', entity, file, line, msg);
const W = (entity, file, line, msg) => report('W', entity, file, line, msg);

// ---------- общие помощники ----------

const exists = (p) => fs.existsSync(p);
const isDir = (p) => exists(p) && fs.statSync(p).isDirectory();
const read = (p) => fs.readFileSync(p, 'utf8');
const ls = (p) => (isDir(p) ? fs.readdirSync(p) : []);
const lines = (text) => text.split(/\r?\n/);

const SECRET_REF = /^(?:Bearer )?\$secret:[\w.-]+\/[\w.-]+$/;
const ACCESS_KEY = /(token|password|passwd|secret|api[-_]?key|authorization|auth)/i;

// ---------- шапка (frontmatter) ----------
// Подмножество YAML: key: value, key: [a, b], key: { … } (строкой),
// вложенные блоки по отступу, списки «- элемент».

const { parseFrontmatter } = require('../core/markdown');

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// ---------- ветка и уровни ----------

// Уровень берётся из имени ветки: master/master-* — общий, team-<код> — командный,
// my — личный. Рабочее место переноса promote/master/<тема> — общий,
// promote/team-<код>/<тема> — командный: уровень называют по имени.
// Рабочая ветка команды (ответвлена от team-<код>, имя другое) команду
// не называет: её берут из --team или из конфигурации master/team/my.
function normalizeBranch(branch) {
  if (!branch) return { branch, base: branch, promote: false };
  if (!branch.startsWith('promote/')) return { branch, base: branch, promote: false };
  const rest = branch.slice('promote/'.length);
  const base = rest.startsWith('team-') ? rest.split('/')[0] : 'master';
  return { branch, base, promote: true };
}

// --level задаёт уровень явно, если имя ветки его не выражает: master и my — сами по
// себе, team — вместе с командой из --team (без неё уровень команды не проверить).
function levelOverride() {
  if (!opt.level) return null;
  if (!['master', 'team', 'my'].includes(opt.level)) {
    console.error(`[validate] неизвестный --level «${opt.level}»: master | team | my`);
    process.exit(2);
  }
  if (opt.level === 'team' && !opt.team) {
    console.error('[validate] для уровня команды нужен --team <код>');
    process.exit(2);
  }
  return { base: opt.level === 'team' ? `team-${opt.team}` : opt.level, level: opt.level };
}

function branchInfo() {
  const raw = git(['rev-parse', '--abbrev-ref', 'HEAD'], ROOT);
  const own = levelOverride();
  const { branch, base, promote } = own
    ? { branch: raw, base: own.base, promote: false }
    : normalizeBranch(raw);
  let team = opt.team || (/^team-[a-z0-9]+$/.test(base || '') ? base.slice(5) : null);
  // Команду называют --team и настройки master/team/my. Из имени
  // рабочего места переноса — когда она в имени, иначе из ветки, когда та точно
  // командная: <код>-work или origin/team-<код> есть.
  if (!team && promote && base !== branch && base.startsWith('team-')) team = base.slice('team-'.length);
  if (!team && base && base.startsWith('team-') && base.endsWith('-work')) {
    const code = base.slice(5, -5);
    if (treeSet(`origin/team-${code}`)) team = code;
  }
  if(!team&&base!=='master'&&!(base||'').startsWith('master-')){
    try{team=require('../config/config').loadConfig(ROOT).teamId;}catch{}
  }
  return { branch, base, promote, team: team && team !== 'none' ? team : null };
}

// Ветка команды без имени команды: файлы уровня с префиксом проверить нечем.
// Личный уровень — ровно ветка my: ветки my-<что-то> называются так же, как личные
// файлы, и за личный уровень их принимать нельзя.
function teamUnknown() {
  const { branch, base, team } = branchInfo();
  return base && base !== 'master' && base !== 'my' && !base.startsWith('master-') && !team;
}

function treeSet(ref) {
  const out = git(['ls-tree', '-r', '-z', '--name-only', ref], ROOT);
  return out === null ? null : new Set(out.split('\0').filter(Boolean));
}

// Элемент уровня: processes/x/PROCESS.md, actions/x, adapters/x/ADAPTER.md, context/x/CONTEXT.md,
// processes/x/fixture.json, .gigacode/skills/x
function levelItems() {
  const items = [];
  const add = (dir, kind) => {
    for (const n of ls(path.join(ROOT, dir))) {
      if (['EXAMPLE.md', 'CATALOG.md', 'README.md', 'core'].includes(n)) continue;
      const full = path.join(ROOT, dir, n);
      if (kind === 'dir' && !isDir(full)) continue;
      if (kind === 'file' && isDir(full)) continue;
      items.push({ rel: `${dir}/${n}`, name: n });
    }
  };
  add('processes', 'dir');
  add('actions', 'dir');
  add('adapters', 'dir');
  for(const level of ['master','team','my'])for(const topic of ls(path.join(ROOT,'context',level)))if(topic!=='example'&&isDir(path.join(ROOT,'context',level,topic)))items.push({rel:`context/${level}/${topic}`,name:topic,contextLevel:level});
  add('.gigacode/skills', 'dir');
  for (const action of ls(path.join(ROOT, 'actions'))) for (const folder of ['queries', 'templates', 'rules']) {
    for (const name of ls(path.join(ROOT, 'actions', action, folder))) items.push({ rel: `actions/${action}/${folder}/${name}`, name });
  }
  return items;
}

function ruleLevels() {
  const { branch, base, team } = branchInfo();
  if (!branch) { W('уровни', null, 0, 'не git-папка: проверка префиксов пропущена'); return; }
  // Имени ветки достаточно, чтобы отличить общий уровень от своего; без origin
  // (локальная работа, свежий клон без fetch) префиксы всё равно проверяются.
  if (base === 'master' || base.startsWith('master-')) {
    for (const it of levelItems()) {
      if (it.contextLevel?it.contextLevel!=='master':/^(my-|team-)/.test(it.name)) E('уровни', path.join(ROOT, it.rel), 0, 'файл личного или командного уровня в общей ветке');
    }
    return;
  }
  // Личный уровень — только ветка my; рабочая ветка команды (имя не team-<код>)
  // личной не является, иначе все её файлы требовали бы префикс my-.
  // Префикс командного файла — имя ветки целиком: в ветке team-sws это team-sws-.
  const isMine = base === 'my';
  const own = isMine ? 'my-' : team ? `team-${team}-` : null;
  if (!own) return; // команда не названа: об этом уже сказано в раскладке
  const master = treeSet('origin/master');
  if (!master) { W('уровни', null, 0, 'нет origin/master: какие файлы общие, неизвестно — проверка префиксов пропущена'); return; }
  const teamSet = team ? treeSet(`origin/team-${team}`) : null;
  const inTree = (set, rel) => set && [...set].some((p) => p === rel || p.startsWith(rel + '/'));

  // Compare inherited content against the incorporated ancestor, not a newer remote tip.
  // Personal connection values are an explicit local setup; other inherited files stay owned upstream.
  function checkInherited(ref,skip=new Set()) {
    const baseline=git(['merge-base','HEAD',ref],ROOT);if(!baseline)return;
    const files=treeSet(baseline);if(!files)return;
    for(const rel of files){
      if(skip.has(rel))continue;
      const file=path.join(ROOT,rel),stat=fs.lstatSync(file,{throwIfNoEntry:false});
      const expected=git(['rev-parse',`${baseline}:${rel}`],ROOT);
      const raw=stat?.isFile()&&!stat.isSymbolicLink()?git(['hash-object','--no-filters','--',rel],ROOT):null;
      const actual=raw===expected?raw:stat?.isFile()&&!stat.isSymbolicLink()?git(['hash-object','--path',rel,'--',rel],ROOT):null;
      const entry=git(['ls-tree',baseline,'--',rel],ROOT),mode=entry?.split(' ')[0];
      if(!stat||actual!==expected||(mode==='100755')!==!!(stat.mode&0o111))E('уровни',file,0,'унаследованный файл изменён или удалён; создайте свой вариант с префиксом');
    }
  }
  checkInherited('origin/master');
  if(isMine&&teamSet)checkInherited(`origin/team-${team}`,new Set(master));

  for (const it of levelItems()) {
    if (inTree(master, it.rel)) continue;
    if (inTree(teamSet, it.rel)) continue;
    const file = path.join(ROOT, it.rel);
    if(it.contextLevel){if(it.contextLevel!==(isMine?'my':'team'))E('уровни',file,0,'новый контекст должен принадлежать уровню текущей ветки');continue;}
    if (!it.name.startsWith(own)) {
      E('уровни', file, 0, isMine
        ? 'в личной ветке новый файл должен начинаться с my-'
        : `в командной ветке новый файл должен начинаться с ${own}`);
    }
  }
}

// ---------- раскладка репозитория ----------

function ruleLayout() {
  for (const dir of ['fixtures', 'config/fixtures']) {
    if (exists(path.join(ROOT, dir))) E('раскладка', path.join(ROOT, dir), 0, 'данные должны лежать рядом с процессом или действием; тестовый код — в tests/');
  }
  // -z: без кавычек и экранирования кириллицы в именах
  const tracked = (git(['ls-files', '-z'], ROOT) || '').split('\0').filter(Boolean);
  const bad = [
    [/^(system|team|user)\//, 'папки system/, team/, user/ устарели'],
    [/^process-kit\.local\.json$/, 'process-kit.local.json устарел'],
    [/^gigacode-extension\.json$/, 'gigacode-extension.json в корне не используется'],
    [/(^|\/)CODEOWNERS$/, 'CODEOWNERS не используется'],
    [/^\.gigacode\/\.env$/, '.gigacode/.env не используется: доступ через $secret:'],
    [/^outputs\//, 'данные человека (outputs/) попали в git'],
    [/^\.history\//, 'данные человека (.history/) попали в git'],
  ];
  for (const f of tracked) for (const [re, msg] of bad) if (re.test(f)) E('раскладка', path.join(ROOT, f), 0, msg);

  for (const n of ['Process Kit', '.runs', 'runs', 'trace.jsonl', 'run.md']) {
    if (exists(path.join(ROOT, n))) E('раскладка', path.join(ROOT, n), 0, 'в корне не должно быть: результаты и прогоны лежат в outputs/<имя>/');
  }
  const { branch } = branchInfo();
  if (teamUnknown()) {
    W('уровни', null, 0, `ветка «${branch}» не называет команду: файлы уровня с префиксом не проверить, передайте --team <код> или настройте выбранную команду в config/my/config.json`);
  }
  for(const file of ['config/team/config.json','config/my/config.json']){
    if((branch==='master'||(branch||'').startsWith('master-'))&&tracked.includes(file))E('раскладка',path.join(ROOT,file),0,'в master нет реальных настроек team/my');
    if((branch||'').startsWith('team-')&&file==='config/my/config.json'&&tracked.includes(file))E('раскладка',path.join(ROOT,file),0,'личный конфиг не переносится в team');
  }

  const gi = path.join(ROOT, '.gitignore');
  if (!exists(gi)) { E('раскладка', gi, 0, 'нет .gitignore'); return; }
  const g = lines(read(gi)).map((l) => l.trim());
  for (const need of ['/outputs/', '/.history/']) if (!g.includes(need)) E('раскладка', gi, 0, `нет строки ${need}`);
  for (const old of ['Process Kit/', '.runs/']) if (!g.includes(old)) W('раскладка', gi, 0, `нет строки ${old} (старое имя, держим одну версию)`);

  // Team identity belongs to the team config.
  if((branch||'').startsWith('team-')&&!exists(path.join(ROOT,'config/team/config.json')))E('раскладка',path.join(ROOT,'config/team/config.json'),0,'в командной ветке нет настроек team');
}

// ---------- скиллы ----------

function ruleSkills() {
  const dir = path.join(ROOT, '.gigacode/skills');
  for (const name of ls(dir)) {
    const sdir = path.join(dir, name);
    if (!isDir(sdir)) continue;
    const file = path.join(sdir, 'SKILL.md');
    if (!exists(file)) {
      const nested = ls(sdir).some((n) => exists(path.join(sdir, n, 'SKILL.md')));
      E('скилл', sdir, 0, nested ? 'вложенный скилл: GigaCode их не видит, кладите плоско' : 'нет SKILL.md');
      continue;
    }
    if (!/^(pp-ai-|my-|[a-z0-9]+-)/.test(name)) E('скилл', file, 0, 'имя скилла: pp-ai-*, <код>-* или my-*');
    const text = read(file);
    const fm = parseFrontmatter(text);
    if (!fm.data) { E('скилл', file, 1, 'нет шапки --- name/description ---'); continue; }
    if (fm.data.name !== name) E('скилл', file, 2, `name «${fm.data.name || ''}» не совпадает с папкой «${name}»`);
    const desc = String(fm.data.description || '');
    if (!desc) E('скилл', file, 2, 'нет description');
    if (name.startsWith('pp-ai-') && name !== 'pp-ai-mentor' && !/вызывается помощником|вызывается ментором|не предлагается человеку/i.test(desc)) {
      W('скилл', file, 2, 'служебный скилл без пометки, что человеку он не предлагается');
    }
  }
}

// ---------- процессы ----------

// Шаги процесса — по одному месту для двух правил: «процесс» и предпусковая проверка.
// В разделе «## Шаги» подраздел «### <шаг>» даёт действие маркером списка
// «- действие» / «- процесс», а строка нумерованного списка «1. <действие>» — шаг сразу.
// Строки «- параметры:» внутри подраздела нужны сбору ссылок на поля конфига.
function ruleProcesses() {
  const dir = path.join(ROOT, 'processes');
  for (const n of ls(dir)) {
    if (['EXAMPLE.md', 'README.md', 'CATALOG.md'].includes(n)) continue;
    const file = path.join(dir, n, 'PROCESS.md');
    if (!isDir(path.join(dir, n))) { E('процесс', path.join(dir, n), 0, 'процесс должен лежать в отдельной папке'); continue; }
    if (!exists(file)) { E('процесс', file, 0, 'папка без определения процесса PROCESS.md'); continue; }
    const base = n;
    const text = read(file);
    const fm = parseFrontmatter(text);
    if (fm.error) { E('процесс', file, 1, fm.error); continue; }
    if (!fm.data) { E('процесс', file, 1, 'нет шапки-манифеста --- … ---'); continue; }
    let model;
    try { model = require('../entities/process-definition').validateDefinition(ROOT, base); }
    catch (error) { E('процесс', file, 0, error.message); continue; }
    const d = model.data;
    if (String(d.description).length > 400) W('процесс', file, 2, 'description длиннее 400 символов');
    if (d.examples && (asList(d.examples).length < 2 || asList(d.examples).length > 5)) W('процесс', file, 2, 'examples: нужно от 2 до 5');
    if (d.status === 'устарел' && !d.replaced_by) W('процесс', file, 2, 'устаревший процесс без replaced_by');
  }
}

// ---------- действия ----------

function ruleActions() {
  const dir = path.join(ROOT, 'actions');
  for (const name of ls(dir)) {
    const adir = path.join(dir, name);
    if (!isDir(adir)) continue;
    const file = path.join(adir, 'ACTION.md');
    if (!exists(file)) { E('действие', adir, 0, 'нет ACTION.md'); continue; }
    if (exists(path.join(adir, 'SKILL.md'))) E('действие', adir, 0, 'действие оформлено как скилл (SKILL.md)');
    const text = read(file);
    if (text.includes('.gigacode/skills')) E('действие', file, 0, 'действие ссылается на скиллы: шаг не кладётся в .gigacode/skills');
    const fm = parseFrontmatter(text);
    if (!fm.data) { E('действие', file, 1, 'нет шапки --- … ---'); continue; }
    const d = fm.data;
    if (d.name !== name) E('действие', file, 2, `name «${d.name || ''}» не совпадает с папкой «${name}»`);
    const desc = String(d.description || d['описание'] || '');
    if (!desc) E('действие', file, 2, 'нет description (что делает действие)');
    if (!d.kind) E('действие', file, 2, 'нет kind');
    else if (!['source', 'transform', 'act'].includes(String(d.kind))) E('действие', file, 2, `kind должен быть source | transform | act (найдено: ${d.kind})`);
    if (!d.consumes) E('действие', file, 2, 'нет consumes (что принимает)');
    if (!d.produces) E('действие', file, 2, 'нет produces (что отдаёт)');
    else if (typeof d.produces !== 'object' || Array.isArray(d.produces) || Object.keys(d.produces).length !== 1 || Object.entries(d.produces).some(([key,value])=>!NAME.test(key)||typeof value!=='string'||!value.trim())) E('действие', file, 2, 'атомарное действие объявляет один именованный результат с описанием');
    for (const key of ['artifacts','params']) {
      const list=d.consumes?.[key];
      if (!Array.isArray(list)||list.some(value=>typeof value!=='string'||!value)||new Set(list).size!==list.length) E('действие', file, 2, `consumes.${key}: нужен список уникальных входов`);
    }

    try { const meta=require('../entities/process-dependencies').action(ROOT,name); for(const ref of Object.values(meta.contracts))if(ref.startsWith('contracts/'))require('../contracts/value-contract').loadContract(ROOT,`actions/${name}/${ref}`); } catch(error) { E('контракт',file,0,error.message); }

    if(d.runtime){try{require('../actions/action-runtime').runtime(ROOT,name,d);}catch(error){E('действие',file,0,error.message);}}
    for(const ref of d.requiresFiles||[])if(!exists(path.join(ROOT,ref)))E('действие',file,0,`нет объявленного файла ${ref}`);

    if (d.kind === 'transform' && !/^none(?: |$)/.test(String(d.adapter))) E('действие', file, 2, 'transform не имеет сетевого adapter');
    if (d.kind === 'source' && (!d.adapter || /^none(?: |$)/.test(String(d.adapter)))) E('действие', file, 2, 'source требует сетевое подключение');
    if (d.kind === 'act' && (!d.adapter || /^none(?: |$)/.test(String(d.adapter)))) E('действие', file, 2, 'act требует существующее подключение, черновик — transform');

    // ссылки на свои файлы — относительно папки действия
    lines(text).forEach((l, i) => {
      if (l.includes(`actions/${name}/`)) W('действие', file, i + 1, `ссылка от корня: пишите путь относительно папки действия, без actions/${name}/`);
      const re = /(?:^|[\s`(«"'])((?:templates|queries|rules)\/[^\s`'")»,;]+)/g;
      let m;
      while ((m = re.exec(l))) {
        const ref = m[1].replace(/[.:]+$/, '');
        if (ref.includes('<') || ref.includes('$') || ref.endsWith('/')) continue;
        if (!exists(path.join(adir, ref))) E('действие', file, i + 1, `нет файла ${ref} в папке действия`);
      }
    });
  }
}

// ---------- подключения ----------

function ruleAdapters() {
  for (const n of ls(path.join(ROOT, 'adapters'))) {
    if (['EXAMPLE.md', 'README.md'].includes(n)) continue;
    const file = path.join(ROOT, 'adapters', n, 'ADAPTER.md');
    if (!isDir(path.join(ROOT, 'adapters', n)) || !exists(file)) { E('подключение', file, 0, 'адаптер должен лежать в папке с ADAPTER.md'); continue; }
    const text = read(file);
    if (!/MCP-сервер/i.test(text)) E('подключение', file, 0, 'нет строки «MCP-сервер: …»');
    if (!/Операции/i.test(text)) W('подключение', file, 0, 'нет раздела «Операции»');
    if (!/Пробный прогон/i.test(text)) W('подключение', file, 0, 'нет описания пробного прогона');
  }
}

function loadJson(entity, file) {
  try { return JSON.parse(read(file)); } catch (e) { E(entity, file, 0, `неверный JSON: ${e.message}`); return null; }
}

function walkStrings(obj, fn, key = '', trail = '') {
  if (typeof obj === 'string') return fn(key, obj, trail);
  if (Array.isArray(obj)) return obj.forEach((v, i) => walkStrings(v, fn, key, `${trail}[${i}]`));
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) walkStrings(v, fn, k, trail ? `${trail}.${k}` : k);
}

const isTodo = (v) => /^TODO(?::|$)/i.test(String(v));

// Запись конфига указывает адаптер путём шаблона (adapters/TODO/ADAPTER.md) или именем
// системы (jira); и то и другое сводится к файлу adapters/<имя>/ADAPTER.md.
const adapterName = (ref) => String(ref).trim().replace(/^adapters\//, '').replace(/\/ADAPTER\.md$/, '');
const adapterFile = (ref) => path.join(ROOT, 'adapters', adapterName(ref), 'ADAPTER.md');

// Имена MCP-серверов из настроек: по ним проверяется mcpServer в записях конфига.
let serversCache;
function declaredServers() {
  if (serversCache !== undefined) return serversCache;
  const file = path.join(ROOT, '.gigacode/settings.json');
  if (!exists(file)) { serversCache = null; return null; }
  let j;
  try { j = JSON.parse(read(file)); } catch (e) { serversCache = null; return null; }
  const servers = j && j.mcpServers && typeof j.mcpServers === 'object' ? Object.keys(j.mcpServers) : [];
  serversCache = servers.length ? new Set(servers) : null;
  return serversCache;
}

let configCache;
function currentConfig(){
 if(configCache!==undefined)return configCache;
 try{configCache=require('../config/config').loadConfig(ROOT);}catch(error){E('настройки',path.join(ROOT,'config'),0,error.message);configCache=null;}
 return configCache;
}

function ruleSources() {
  for(const rel of ['config/team/EXAMPLE.json','config/my/EXAMPLE.json','config/master/config.json']){
    const file=path.join(ROOT,rel);if(!exists(file))E('настройки',file,0,'нет примера/общих defaults');else loadJson('настройки',file);
  }
  const file=path.join(ROOT,'config'),j=currentConfig();if(!j)return;
  if(!j.files.some(file=>['config/team/config.json','config/my/config.json'].includes(file)))return;
  const selectedTeam=branchInfo().team;if(j.team&&selectedTeam&&j.team.id!==selectedTeam)E('настройки',file,0,'team.id не совпадает с командой ветки');
  const ids = new Set();
  const stores = storeEntries(j);
  if (!stores.length) W('настройки команды', file, 0, 'нет ни одной записи taskStores/codeStores: подключений к системам нет');
  stores.forEach(([where, s], i) => {
    const at = `${where}[${i}]`;
    if (!s || typeof s !== 'object') { E('настройки команды', file, 0, `${at}: запись должна быть объектом`); return; }
    if (!s.id) E('настройки команды', file, 0, `${at}: нет id`);
    else if (ids.has(s.id)) E('настройки команды', file, 0, `${at}: повтор id ${s.id}`);
    else ids.add(s.id);
    // Наличие файла подключения проверяет ruleConnections: одна ошибка на запись.
    if (!s.adapter) E('настройки команды', file, 0, `${at}: нет adapter`);
    if (s.kind && !isTodo(s.kind) && !/^[\w.-]+$/.test(String(s.kind))) {
      E('настройки команды', file, 0, `${at}: kind — тип системы (jira, bitbucket-server), а не описание`);
    }
    if (!s.mcpServer) E('настройки команды', file, 0, `${at}: нет mcpServer`);
    // Имя сервера должно быть объявлено в настройках: mcp__<mcpServer>__<имя> иначе не разрешится.
    else if (!isTodo(s.mcpServer) && declaredServers() && !declaredServers().has(String(s.mcpServer))) {
      W('настройки команды', file, 0, `${at}: mcpServer «${s.mcpServer}» не объявлен в .gigacode/settings.json — инструменты mcp__${s.mcpServer}__* не разрешатся`);
    }
  });
  walkStrings(j, (k, v, trail) => {
    if (ACCESS_KEY.test(k)) E('настройки команды', file, 0, `${trail}: значений доступа здесь быть не должно`);
    if (v === 'TODO') W('настройки команды', file, 0, `${trail}: не заполнено (TODO)`);
  });
}

function ruleSettings() {
  const file = path.join(ROOT, '.gigacode/settings.json');
  if (!exists(file)) { E('настройки GigaCode', file, 0, 'нет .gigacode/settings.json'); return; }
  const j = loadJson('настройки GigaCode', file);
  if (!j) return;
  function settingsValues(value, key = '', trail = '') {
    if (value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) settingsValues(v, k, trail ? `${trail}.${k}` : k); return; }
    if (ACCESS_KEY.test(key) && typeof value !== 'string') E('настройки GigaCode', file, 0, `${trail}: значение доступа должно быть ссылкой $secret:`);
  }
  settingsValues(j);
  walkStrings(j, (k, v, trail) => {
    if (/ВАШ_ТОКЕН|\$\{?PK_/.test(v)) E('настройки GigaCode', file, 0, `${trail}: устаревшая заглушка, нужна ссылка $secret:<имя>/<ключ>`);
    else if ((ACCESS_KEY.test(k) || /^Bearer\s/i.test(v)) && !SECRET_REF.test(v)) {
      E('настройки GigaCode', file, 0, `${trail}: значение доступа вместо ссылки $secret:<имя>/<ключ>`);
    }
  });
}

// ---------- значения доступа в файлах ----------

// Ссылка $secret: законна, а самих значений в репозитории быть не должно.
// Шаблоны собраны через склейку, чтобы этот файл не совпадал сам с собой.
const TOKEN_PATTERNS = [
  { re: new RegExp('gl' + 'pat-[A-Za-z0-9_-]{10,}'), label: 'похоже на токен GitLab' },
  { re: new RegExp('gh' + '[psu]_[A-Za-z0-9]{20,}'), label: 'похоже на токен GitHub' },
  { re: new RegExp('xox' + '[abp]-[A-Za-z0-9-]{10,}'), label: 'похоже на токен Slack' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'похоже на ключ AWS' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'закрытый ключ в репозитории' },
  { re: /Bearer\s+[A-Za-z0-9+/=._-]{20,}/, label: 'заголовок с токеном' },
];
const SECRET_SCAN_DIRS = ['processes', 'actions', 'adapters', 'context', 'config', 'tools', 'docs', '.gigacode'];
const SECRET_SCAN_SKIP = new Set(['tools/lib/validation/validate.js', '.gigacode/settings.json']);

function ruleSecrets() {
  const walk = (dir) => {
    for (const n of ls(dir)) {
      const full = path.join(dir, n);
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      if (isDir(full)) {
        if (n === 'node_modules' || n === '.git') continue;
        walk(full);
        continue;
      }
      if (n.startsWith('.env')) { E('секреты', full, 0, 'файл доступов в репозитории: доступом заведует клиент, в проекте его нет'); continue; }
      if (!/\.(md|json|js|sh|ya?ml|txt)$/i.test(n) || SECRET_SCAN_SKIP.has(rel)) continue;
      let text;
      try { text = read(full); } catch (e) { continue; }
      for (const { re, label } of TOKEN_PATTERNS) {
        if (re.test(text)) E('секреты', full, 0, `${label} — значений доступа в репозитории быть не должно`);
      }
    }
  };
  for (const d of SECRET_SCAN_DIRS) if (isDir(path.join(ROOT, d))) walk(path.join(ROOT, d));
  if (isDir(path.join(ROOT, 'outputs'))) walk(path.join(ROOT, 'outputs'));
}

function ruleTeam() { currentConfig(); }

// ---------- подключения из настроек команды ----------

// Записи конфига и их дефолты. Разбор формы — только здесь: правило sources и
// правило connections читают один и тот же список, а не каждый свой.
function storeEntries(j) {
  return [].concat(
    asList((j || {}).taskStores).map((s) => ['taskStores', s]),
    asList((j || {}).codeStores).map((s) => ['codeStores', s]),
  );
}

// Ветки без origin (локальная работа) не должны молча терять проверку уровней.
function ruleConnections() {
  const file=path.join(ROOT,'config'),j=currentConfig();if(!j)return;
  for (const [, s] of storeEntries(j)) {
    if (!s || typeof s !== 'object') continue;
    const ref = s.adapter || (s.kind ? String(s.kind) : '');
    if (!ref) { W('настройки команды', file, 0, `у записи «${s.id}» не задан adapter`); continue; }
    if (isTodo(ref) || isTodo(adapterName(ref))) continue;
    if (!exists(adapterFile(ref))) E('настройки команды', file, 0, `подключение adapters/${adapterName(ref)}/ADAPTER.md для «${s.id}» не найдено`);
  }
  for(const [slot,collection]of [['taskStore','taskStores'],['codeStore','codeStores']]){
    const id=j.defaults?.[slot];if(id&&!j[collection].some(entry=>entry.id===id))E('настройки',file,0,`defaults.${slot}: неизвестный id ${id}`);
    if(id&&j[collection].some(entry=>entry.id===id)){try{require('../config/config').selectedResource(j,slot,j[collection].find(entry=>entry.id===id));}catch(error){E('настройки',file,0,error.message);}}
  }
}

// ---------- контекст ----------

function ruleContext() {
  const files = [];
  for(const level of ls(path.join(ROOT,'context'))){
    if(level==='README.md')continue;
    if(!['master','team','my'].includes(level)){E('контекст',path.join(ROOT,'context',level),0,'уровень контекста: master/team/my');continue;}
    for(const name of ls(path.join(ROOT,'context',level))){
      const folder=path.join(ROOT,'context',level,name),file=path.join(folder,'CONTEXT.md');
      if(name==='README.md')continue;
      if(!isDir(folder)||!exists(file)){E('контекст',folder,0,'контекст должен лежать в папке с CONTEXT.md');continue;}
      const branch=branchInfo().base||'';
      if(name!=='example'&&((level!=='master'&&(branch==='master'||branch.startsWith('master-')))||(level==='my'&&branch.startsWith('team-'))))E('уровни',file,0,'контекст не принадлежит уровню ветки');
      files.push(file);
    }
  }
  for (const file of files) {
    const text = read(file);
    const n = lines(text).length;
    const base = path.basename(path.dirname(file));
    if (!text.trim()) E('контекст', file, 1, 'пустой файл контекста: удалите его или заполните');
    else if (!/^#[^#]/.test(text)) E('контекст', file, 1, 'нет заголовка «# …»');
    if (base === 'writing-style' && n > 100) E('контекст', file, 0, `правила письма длиннее 100 строк (${n})`);
    else if (n > 80) W('контекст', file, 0, `файл контекста длинный (${n} строк): подключайте только нужные сведения`);
  }
}

// ---------- outputs/ ----------

function ruleOutputs() {
  const dir = path.join(ROOT, 'outputs');
  if (!isDir(dir)) return;
  for (const n of ls(dir)) {
    const p = path.join(dir, n);
    if (!isDir(p)) { E('outputs', p, 0, 'прямо в outputs/ только папки запусков'); continue; }
    if (['tasks', 'setup', 'requests', '.runs', 'runs'].includes(n)) { E('outputs', p, 0, 'подпапок по видам нет: одна папка на запуск'); continue; }
    const m = runFolderParts(n);
    if (!m) { E('outputs', p, 0, 'имя папки: <ГГГГ-ММ-ДД>_<1–4 слова строчными через дефис>, без пробелов и точек'); continue; }
    if (m.short.replace(/-\d+$/, '').length > 40) E('outputs', p, 0, 'часть имени после даты длиннее 40 символов');
    checkRunFolder(p, m.short);
  }
}

function checkRunFolder(p, short) {
  const names = ls(p);
  if(names.includes('.action.json')){
    try{
      const meta=JSON.parse(read(path.join(p,'.action.json'))),action=require('../entities/process-dependencies').action(ROOT,meta.action);
      if(meta.schemaVersion!==1||meta.mode!=='local'||action.kind!=='transform'||!Object.hasOwn(action.contracts,meta.port)||!require('../core/paths').validResultName(meta.resultName)||meta.resultName==='итог.md'||names.some(name=>!['.action.json',meta.resultName].includes(name)))throw new Error('Некорректный результат прямого экшена');
      const file=path.join(p,meta.resultName),bytes=fs.readFileSync(file);if(require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw new Error('Изменён результат прямого экшена');
      const contract=action.contracts[meta.port];if(contract==='text'){if(!bytes.toString().trim())throw new Error('Пустой результат');}else require('../contracts/value-contract').validateValue(require('../contracts/value-contract').loadContract(ROOT,`actions/${meta.action}/${contract}`),JSON.parse(bytes));
    }catch(error){E('outputs',p,0,error.message);}return;
  }
  const hasRun = names.includes('.run');
  const isSetup = /^настройка(-\d+)?$/.test(short);
  const isRequest = short.startsWith('заявка-');
  const isProbe = short.startsWith('проба-');

  if (isSetup) {
    if (!names.includes('что-сделано.md')) E('outputs', p, 0, 'в папке настройки нет что-сделано.md');
    else checkSetupReport(path.join(p, 'что-сделано.md'));
    if (hasRun) E('outputs', p, 0, 'в папке настройки не должно быть .run/');
  }
  if (isRequest) {
    if (!names.includes('заявка.md')) E('outputs', p, 0, 'в папке заявки нет заявка.md');
    else checkRequest(path.join(p, 'заявка.md'));
    if (hasRun) E('outputs', p, 0, 'в папке заявки не должно быть .run/');
  }
  if (hasRun) {
    if (!names.includes('итог.md')) E('outputs', p, 0, 'есть .run/, но нет итог.md: итог пишется всегда, и при сбое');
    else checkSummary(path.join(p, 'итог.md'), names, isProbe);
    checkRunDir(path.join(p, '.run'));
  } else if (names.includes('итог.md')) {
    checkSummary(path.join(p, 'итог.md'), names, isProbe);
  } else if (!isSetup && !isRequest) E('outputs', p, 0, 'нет итог.md у запуска');
  for (const name of names) if (/^\d{2}-/.test(name)) E('outputs', path.join(p, name), 0, 'артефакт шага должен лежать в .run/');
}

function checkSummary(file, names, isProbe) {
  const t = read(file);
  const rows = lines(t);
  if (!/^# .+/.test(rows[0] || '')) E('итог', file, 1, 'первая строка — «# <задача словами человека>»');
  if (!/^Дата:\s*\d{1,2}\s+[а-яё]+\s+\d{4}/mi.test(t)) E('итог', file, 0, 'нет строки «Дата: 5 ноября 2026»');
  const end = t.match(/^Чем закончилось:\s*(.*)$/m);
  if (!end) E('итог', file, 0, 'нет строки «Чем закончилось: …»');
  else {
    const v = end[1].trim();
    if (isProbe && !/^пробный прогон/i.test(v)) E('итог', file, 0, 'пробный прогон: «Чем закончилось: пробный прогон …, ничего не отправлялось»');
    if (!isProbe && /^пробный прогон/i.test(v)) E('итог', file, 0, 'для демо имя папки должно начинаться с <дата>_проба-<задача>, не demo-');
    else if (!isProbe && !/^(готово|не получилось:)/i.test(v)) E('итог', file, 0, '«Чем закончилось:» начинается с «готово» или «не получилось: <причина>»');
  }
  if (/\$secret:|Bearer\s|Authorization:|x-[a-z]+-token/i.test(t)) E('итог', file, 0, 'в итоге есть данные доступа');
  if (/^\s+at\s.+:\d+:\d+\)?$/m.test(t) || /\b(TypeError|ReferenceError|ECONNREFUSED|stack trace)\b/.test(t)) W('итог', file, 0, 'похоже на текст системной ошибки: причину пишите простыми словами');
  const others = names.filter((n) => !n.startsWith('.') && n !== 'итог.md' && !/^диагностика(?:-\d+)?\.md$/.test(n));
  const listAt = rows.findIndex((r) => /^Файлы в этой папке:/.test(r));
  if (others.length && listAt < 0) W('итог', file, 0, 'нет списка «Файлы в этой папке:»');
  if (listAt >= 0) {
    if (/\.run\//.test(rows.slice(listAt).join('\n'))) E('итог', file, listAt + 1, 'в списке файлов не упоминается .run/');
    for (let i = listAt + 1; i < rows.length; i++) {
      const m = rows[i].match(/^-\s+(\S+)$/);
      if (!m) { if (rows[i].trim() && !rows[i].startsWith('-')) break; continue; }
      if (!names.includes(m[1])) W('итог', file, i + 1, `в списке есть ${m[1]}, а в папке его нет`);
    }
  }
}

function checkRunDir(dir) {
  try {
    const stateFile=path.join(dir,'state.json');
    if(exists(stateFile)){const state=JSON.parse(read(stateFile));const verified=require('../runtime/run-storage').verify(dir);if(state.schemaVersion===2&&!verified)throw new Error('отсутствует checkpoint');if(!['running','completed','failed'].includes(state.status))throw new Error('недопустимый статус');}
    if(exists(path.join(dir,'transaction.json')))E('прогон',dir,0,'незавершённая запись: используйте run recover');
  } catch(error){E('прогон',dir,0,error.message);}
  for (const n of ls(dir)) {
    const f = path.join(dir, n);
    if (['run.md', 'trace.jsonl', 'state.json', 'checkpoint.json', 'transaction.json', '.journal.lock', '.recovery.lock'].includes(n)) continue;
    if (n === 'inputs' && isDir(f)) continue;
    if (!/^\d{2}-[a-z0-9][\w-]*\.\w+$/i.test(n)) W('прогон', f, 0, 'файл шага: <NN>-<имя шага>.<расширение>, например 01-jira-search.json');
  }
  const st = path.join(dir, 'state.json');
  if (!exists(st)) W('прогон', dir, 0, 'нет state.json (нужен для продолжения с упавшего шага)');
  else {
    const j = loadJson('прогон', st);
    if (j) {
      if (!Number.isInteger(j.last_step) || j.last_step < 0) E('прогон', st, 0, 'state.json: last_step — номер последнего завершённого шага');
      if (typeof j.last_step_name !== 'string') E('прогон', st, 0, 'state.json: last_step_name — имя шага');
      if (j.artifacts) for (const [name, relative] of Object.entries(j.artifacts)) {
        if (typeof relative !== 'string' || path.basename(relative) !== relative || !exists(path.join(dir, relative))) {
          E('прогон', st, 0, `артефакт ${name}: файл отсутствует или путь вне .run/`);
        }
      }
    }
  }
  const tr = path.join(dir, 'trace.jsonl');
  if (exists(tr)) checkJsonl('прогон', tr, []);
}

function checkSetupReport(file) {
  const t = read(file);
  if (!/^# Настройка Process Kit/.test(t)) E('отчёт настройки', file, 1, 'первая строка — «# Настройка Process Kit, <дата>»');
  if (lines(t).filter((l) => l.trim()).length > 15) W('отчёт настройки', file, 0, 'отчёт длиннее 15 строк');
  if (/\$secret:|Bearer\s|x-[a-z]+-token/i.test(t)) E('отчёт настройки', file, 0, 'в отчёте есть данные доступа');
}

function checkRequest(file) {
  const t = read(file);
  if (!/^# Заявка/.test(t)) E('заявка', file, 1, 'первая строка — «# Заявка …»');
  if (!/^Что нужно:/m.test(t)) E('заявка', file, 0, 'нет строки «Что нужно: …»');
}

function checkJsonl(entity, file, required) {
  lines(read(file)).forEach((l, i) => {
    if (!l.trim()) return;
    let j;
    try { j = JSON.parse(l); } catch (e) { E(entity, file, i + 1, 'строка не JSON'); return; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) { E(entity, file, i + 1, 'строка должна быть объектом'); return; }
    for (const k of required) if (!(k in j)) E(entity, file, i + 1, `нет поля ${k}`);
    if (required.includes('output') && j.output && !isDir(path.join(ROOT, 'outputs', j.output))) {
      W(entity, file, i + 1, `папки outputs/${j.output} нет (удалена или перенесена)`);
    }
  });
}

function ruleHistory() {
  const file = path.join(ROOT, '.history/runs.jsonl');
  if (exists(file)) checkJsonl('история', file, ['ts', 'process', 'output']);
}

// ---------- предпусковая проверка: только объявленные зависимости ----------
function processDepthLimit(){try{return require('../config/config').loadMaster(ROOT).execution.maxProcessDepth;}catch(error){E('настройки',path.join(ROOT,'config/master/config.json'),0,error.message);return 1;}}

function ruleProcessValues() {
  if (!opt.process) return;
  if (!NAME.test(opt.process)) { E('значения', null, 0, 'недопустимое имя процесса'); return; }
  let overrides = {};
  if (opt.params) {
    overrides = loadJson('параметры', path.resolve(opt.params));
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      E('параметры', null, 0, '--params должен содержать JSON-объект'); return;
    }
  }
  const visiting = new Set(),maxDepth=processDepthLimit();
  function scan(name, depth = 1, inherited = {}) {
    if (depth > maxDepth || visiting.has(name)) { E('маршрут', null, 0, `цикл или глубина подпроцесса больше ${maxDepth}: ${name}`); return; }
    visiting.add(name);
    const file = path.join(ROOT, 'processes', name, 'PROCESS.md');
    if (!exists(file)) { E('значения', file, 0, `нет процесса ${name}`); visiting.delete(name); return; }
    const model = processModel(read(file));
    model.data.params={...model.data.params,...inherited};
    const req = model.data.requires || {};
    for (const step of model.steps) {
      if (step.kind === 'process') { scan(step.ref, depth + 1, require('../entities/process-dependencies').childParams(ROOT,model,step,model.data.params,{},overrides)); continue; }
      if (step.kind !== 'action') continue;
      const af = path.join(ROOT, 'actions', step.ref, 'ACTION.md');
      if (!exists(af)) { E('значения', af, 0, `нет действия ${step.ref}`); continue; }
      const action = parseFrontmatter(read(af)).data || {};
      for (const [key, folder] of Object.entries({ query: 'queries', template: 'templates', rule: 'rules' })) {
        if (!asList(action.consumes?.params).some(p => String(p).split(/[ (]/)[0] === key) && !(key in step.params)) continue;
        const value = parameter(model, step, key, overrides);
        if (value == null || typeof value === 'string' && !value.trim()) {
          E('значения', file, step.ln, `нет обязательного параметра ${key} для ${step.ref}`); continue;
        }
        if (!NAME.test(String(value)) || !exists(path.join(ROOT, 'actions', step.ref, folder, `${value}.md`))) {
          E('значения', file, step.ln, `не найден файл ${folder}/${value}.md для ${step.ref}`);
        }
      }
      try {
        const effective=require('../entities/process-dependencies').stepParams(model.data.params,step,overrides);
        const policy=require('../actions/action-runtime').runtime(ROOT,step.ref,action);
        policy.dependencies?.({cwd:ROOT,processName:name,actionName:step.ref,meta:action,params:effective,mode:opt.demo?'demo':'live',preflight:true});
      } catch(error){E('значения',file,step.ln,error.message);}
      if (opt.demo || action.kind === 'transform' || (action.kind === 'source' && action.adapter === 'environment-tool') || /^none(?: |$)/.test(String(action.adapter))) continue;
      const slots=asList(action.consumes?.params);
      if(!Array.isArray(req.config)||!req.config.length){E('значения',file,0,'requires.config не объявлен для сетевого шага');continue;}
      try{
        const selectedConfig=require('../config/config').loadConfig(ROOT,req.config),effective=require('../entities/process-dependencies').stepParams(model.data.params,step,overrides),fields=require('../config/config').requiredFields(ROOT,name,effective);
        for(const slot of ['taskStore','codeStore'].filter(slot=>slots.includes(slot)))require('../config/config').resolveStore(ROOT,selectedConfig,slot,effective[slot],fields);
      }catch(error){E('значения',file,0,error.message);}

    }
    visiting.delete(name);
  }
  try { const definition=require('../entities/process-definition'),model=definition.validateDefinition(ROOT,opt.process);definition.validateRunInput(ROOT,opt.process,model,{...model.data.params,...overrides}); }
  catch(error){E('процесс',null,0,error.message);return;}
  scan(opt.process);
}

// ---------- запуск ----------

const RULES = {
  layout: ruleLayout,
  levels: ruleLevels,
  skills: ruleSkills,
  processes: ruleProcesses,
  actions: ruleActions,
  adapters: ruleAdapters,
  sources: ruleSources,
  settings: ruleSettings,
  secrets: ruleSecrets,
  team: ruleTeam,
  connections: ruleConnections,
  context: ruleContext,
  outputs: ruleOutputs,
  history: ruleHistory,
  values: ruleProcessValues,
};

// Предпусковая проверка требует имя процесса: «проверить все поля сразу» заблокировало бы
// команду с несколькими подключениями — TODO во втором останавливал бы первый процесс.
if (opt.process) {
  if (opt.only && opt.only !== 'values') {
    console.error('[validate] --process работает отдельно от --only: имя процесса называет, что проверять');
    process.exit(2);
  }
  opt.only = 'values';
}
if (opt.only === 'values' && !opt.process) {
  console.error('[validate] для --only values нужно имя процесса: --process <имя>');
  process.exit(2);
}

if (opt.only && !RULES[opt.only]) {
  console.error(`[validate] неизвестная сущность «${opt.only}». Есть: ${Object.keys(RULES).join(', ')}`);
  process.exit(2);
}
for (const [name, fn] of Object.entries(RULES)) {
  if (opt.only && opt.only !== name) continue;
  try { fn(); } catch (e) { E(name, null, 0, `сбой проверки: ${e.message}`); }
}

const errors = issues.filter((x) => x.level === 'E');
const warns = issues.filter((x) => x.level === 'W');
if (opt.json) {
  console.log(JSON.stringify({ root: ROOT, errors: errors.length, warnings: warns.length, issues }, null, 2));
} else {
  for (const x of [...errors, ...warns]) {
    const where = x.line ? `${x.file}:${x.line}` : x.file;
    console.log(`${x.level === 'E' ? 'ОШИБКА  ' : 'ВНИМАНИЕ'} [${x.entity}] ${where} — ${x.msg}`);
  }
  console.log(`\nИтого: ошибок ${errors.length}, предупреждений ${warns.length}.`);
}
process.exit(errors.length ? 1 : 0);

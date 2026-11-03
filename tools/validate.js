#!/usr/bin/env node
// Валидатор сущностей Process Kit. Node >= 18, без зависимостей, CommonJS.
//
// Запуск:
//   node tools/validate.js                 проверить всё
//   node tools/validate.js --only outputs  одну сущность (имена — в RULES внизу)
//   node tools/validate.js --json          вывод для машин
//   node tools/validate.js --root <папка>  другой корень (для тестов)
//   node tools/validate.js --team <код>    команда для рабочей ветки команды
//   node tools/validate.js --level <уровень> уровень явно: master | team | my (team — с --team)
//   node tools/validate.js --process <имя> проверка перед запуском: только значения
//                                          конфига, на которые ссылается процесс
//
// Уровень иначе берётся из имени ветки, включая рабочие места переноса
// promote/master/<тема> и promote/team-<код>/<тема>.
//
// Уровни: ОШИБКА — нарушено принятое правило этапа 1, код выхода 1.
//         ВНИМАНИЕ — поле или правило из будущих пунктов, код выхода не меняет.
// Эталоны правил: docs/reference/, шаблоны: docs/templates/.

'use strict';

const fs = require('fs');
const path = require('path');
const { processModel, parameter, allowedReference, NAME } = require('./process-model');
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
    const paths = require('./paths');
    if (typeof paths.root === 'function') return paths.root();
    if (typeof paths.ROOT === 'string') return paths.ROOT;
  } catch (e) { throw new Error('Не найден корень Git: передайте --root <папка>'); }
}

const ROOT = findRoot();

const { runFolderParts } = require('./paths');

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
const SEMVER = /^\d+\.\d+\.\d+$/;

// ---------- шапка (frontmatter) ----------
// Подмножество YAML: key: value, key: [a, b], key: { … } (строкой),
// вложенные блоки по отступу, списки «- элемент».

const { parseFrontmatter } = require('./markdown');

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// ---------- ветка и уровни ----------

// Уровень берётся из имени ветки: master/master-* — общий, team-<код> — командный,
// my — личный. Рабочее место переноса promote/master/<тема> — общий,
// promote/team-<код>/<тема> — командный: уровень называют по имени.
// Рабочая ветка команды (ответвлена от team-<код>, имя другое) команду
// не называет: её берут из --team или из processkit.team, который пишет настройка.
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
  // Команду называют --team и processkit.team: то, что записала настройка. Из имени
  // рабочего места переноса — когда она в имени, иначе из ветки, когда та точно
  // командная: <код>-work или origin/team-<код> есть.
  if (!team && promote && base !== branch && base.startsWith('team-')) team = base.slice('team-'.length);
  if (!team && base && base.startsWith('team-') && base.endsWith('-work')) {
    const code = base.slice(5, -5);
    if (treeSet(`origin/team-${code}`)) team = code;
  }
  if (!team && base !== 'master' && !(base || '').startsWith('master-')) {
    const t = git(['config', 'processkit.team'], ROOT);
    if (t && t !== 'none') team = t.replace(/^team-/, '');
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

// Элемент уровня: processes/x.md, actions/x, adapters/x.md, context/x.md,
// context/core/x.md, config/fixtures/x.json, .gigacode/skills/x
function levelItems() {
  const items = [];
  const add = (dir, kind) => {
    for (const n of ls(path.join(ROOT, dir))) {
      if (['FORMAT.md', 'CATALOG.md', 'README.md', 'core'].includes(n)) continue;
      const full = path.join(ROOT, dir, n);
      if (kind === 'dir' && !isDir(full)) continue;
      if (kind === 'file' && isDir(full)) continue;
      items.push({ rel: `${dir}/${n}`, name: n });
    }
  };
  add('processes', 'file');
  add('actions', 'dir');
  add('adapters', 'file');
  add('context', 'file');
  add('tests', 'dir');
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
      if (/^(my-|team-)/.test(it.name)) E('уровни', path.join(ROOT, it.rel), 0, 'файл личного или командного уровня в общей ветке');
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

  for (const it of levelItems()) {
    if (inTree(master, it.rel)) continue;
    if (inTree(teamSet, it.rel)) continue;
    const file = path.join(ROOT, it.rel);
    if (!it.name.startsWith(own)) {
      E('уровни', file, 0, isMine
        ? 'в личной ветке новый файл должен начинаться с my-'
        : `в командной ветке новый файл должен начинаться с ${own}`);
    }
  }
}

// ---------- раскладка репозитория ----------

function ruleLayout() {
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
    W('уровни', null, 0, `ветка «${branch}» не называет команду: файлы уровня с префиксом не проверить, передайте --team <код> или укажите processkit.team`);
  }
  if ((branch === 'master' || (branch || '').startsWith('master-')) && tracked.includes('config/sources.json')) {
    E('раскладка', path.join(ROOT, 'config/sources.json'), 0, 'в общей ветке нет config/sources.json, только шаблон');
  }

  const gi = path.join(ROOT, '.gitignore');
  if (!exists(gi)) { E('раскладка', gi, 0, 'нет .gitignore'); return; }
  const g = lines(read(gi)).map((l) => l.trim());
  for (const need of ['outputs/', '.history/']) if (!g.includes(need)) E('раскладка', gi, 0, `нет строки ${need}`);
  for (const old of ['Process Kit/', '.runs/']) if (!g.includes(old)) W('раскладка', gi, 0, `нет строки ${old} (старое имя, держим одну версию)`);

  // TEAM.md: в командной ветке обязателен, если есть — из чего состоит
  const teamFile = path.join(ROOT, 'TEAM.md');
  if (!exists(teamFile)) {
    const b = branchInfo().branch || '';
    if (b.startsWith('team-')) E('раскладка', teamFile, 0, 'в командной ветке нет TEAM.md');
  } else {
    const t = read(teamFile);
    if (!/^# .+/m.test(t)) E('раскладка', teamFile, 1, 'нет заголовка «# <название команды>»');
    for (const need of ['Код:', 'Владельцы:']) if (!t.includes(need)) E('раскладка', teamFile, 0, `нет строки «${need}»`);
  }
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
function processSteps(text) { return processModel(text); }

function ruleProcesses() {
  const dir = path.join(ROOT, 'processes');
  for (const child of ls(dir)) if (isDir(path.join(dir, child))) E('процесс', path.join(dir, child), 0, 'подпапок в processes/ нет');
  for (const n of ls(dir)) {
    if (!n.endsWith('.md') || ['FORMAT.md', 'CATALOG.md', 'README.md'].includes(n)) continue;
    const file = path.join(dir, n);
    const base = n.slice(0, -3);
    const text = read(file);
    const fm = parseFrontmatter(text);
    if (fm.error) { E('процесс', file, 1, fm.error); continue; }
    if (!fm.data) { E('процесс', file, 1, 'нет шапки-манифеста --- … ---'); continue; }
    const d = fm.data;
    if (d.name !== base) E('процесс', file, 2, `name «${d.name || ''}» не совпадает с именем файла «${base}»`);
    const desc = String(d.description || '');
    if (!desc) E('процесс', file, 2, 'нет description: по нему помощник находит процесс');
    else if (desc.length > 400) W('процесс', file, 2, 'description длиннее 400 символов');
    if (!d.version) E('процесс', file, 2, 'нет version');
    else if (!SEMVER.test(String(d.version))) E('процесс', file, 2, 'version не в формате X.Y.Z');
    const ex = asList(d.examples).length ? asList(d.examples) : asList(d.example);
    if (!ex.length) E('процесс', file, 2, 'нет examples или example');
    else if (d.examples && (ex.length < 2 || ex.length > 5)) W('процесс', file, 2, 'examples: нужно от 2 до 5');
    if (!d.area) E('процесс', file, 2, 'нет area');
    if (!d.status) E('процесс', file, 2, 'нет status');
    if (d.status && !['действует', 'устарел'].includes(d.status)) E('процесс', file, 2, 'status: «действует» или «устарел»');
    if (d.status === 'устарел' && !d.replaced_by) W('процесс', file, 2, 'устаревший процесс без replaced_by');

    const req = d.requires && typeof d.requires === 'object' ? d.requires : {};
    for (const a of asList(req.actions)) if (!exists(path.join(ROOT, 'actions', a, 'ACTION.md'))) E('процесс', file, 2, `requires.actions: нет действия ${a}`);
    for (const c of asList(req.context)) {
      const p = c.startsWith('context/') ? c : `context/${c}`;
      if (!exists(path.join(ROOT, p))) E('процесс', file, 2, `requires.context: нет файла ${p}`);
      if (!allowedReference(base, path.basename(p, '.md'))) E('уровни', file, 2, `контекст нижнего уровня ${p}`);
    }
    for (const r of asList(req.data)) {
      if (r.includes('<') || r.includes('$')) continue;
      const hits = ls(path.join(ROOT, 'actions')).some((a) => exists(path.join(ROOT, 'actions', a, r)));
      if (!hits) W('процесс', file, 2, `requires.data: ${r} не найден ни в одном действии`);
    }

    // шаги
    const bodyRows = lines(fm.body);
    const stepsAt = bodyRows.findIndex((l) => /^##\s+Шаги/.test(l));
    if (stepsAt < 0) { E('процесс', file, fm.bodyLine, 'нет раздела «## Шаги»'); continue; }
    const model = processSteps(text);
    for (const error of model.errors) E('маршрут', file, 0, error);
    const used = model.steps;
    if (!used.length) W('процесс', file, fm.bodyLine + stepsAt, 'в разделе «Шаги» не найдено ни одного шага');
    for (const u of used) {
      if (u.ref && !allowedReference(base, u.ref)) E('уровни', file, u.ln, `ссылка вниз по уровням: ${base} → ${u.ref}`);
      if (u.kind === 'action') {
        const af = path.join(ROOT, 'actions', u.ref, 'ACTION.md');
        const action = exists(af) ? parseFrontmatter(read(af)).data || {} : {};
        if (u.artifact && action.produces && typeof action.produces === 'object' && !Array.isArray(action.produces) && !(u.artifact in action.produces)) {
          E('контракт', file, u.ln, `артефакт ${u.artifact} не объявлен в produces действия ${u.ref}`);
        }
        for (const [key, folder] of Object.entries({ query: 'queries', template: 'templates', rule: 'rules' })) {
          if (!asList(action.consumes?.params).some(p => String(p).split(/[ (]/)[0] === key) && !(key in u.params)) continue;
          const value = parameter(model, u, key);
          if (value == null) continue;
          if (!NAME.test(String(value))) { E('процесс', file, u.ln, `параметр ${key}: нужно явное имя файла данных`); continue; }
          const data = path.join(ROOT, 'actions', u.ref, folder, `${value}.md`);
          if (!exists(data)) E('процесс', file, u.ln, `нет данных действия ${u.ref}/${folder}/${value}.md`);
          if (!allowedReference(base, value)) E('уровни', file, u.ln, `ссылка на данные нижнего уровня: ${value}`);
        }
      }
      if (u.kind === 'action' && !exists(path.join(ROOT, 'actions', u.ref, 'ACTION.md'))) E('процесс', file, u.ln, `шаг ссылается на несуществующее действие ${u.ref}`);
      if (u.kind === 'process' && !exists(path.join(ROOT, 'processes', `${u.ref}.md`))) E('процесс', file, u.ln, `подпроцесс ${u.ref} не найден`);
    }
    const reqA = asList(req.actions);
    if (!req.actions) E('процесс', file, 2, 'нет requires.actions');
    if (reqA.length) for (const u of used) if (u.kind === 'action' && !reqA.includes(u.ref)) E('процесс', file, u.ln, `действие ${u.ref} не перечислено в requires.actions`);

    // Required input artifacts must be available on every incoming route.
    const predecessors = new Map(used.map(step => [step.name, []]));
    for (const step of used) for (const target of step.kind === 'branch' ? step.targets : step.next ? [step.next] : []) {
      if (predecessors.has(target)) predecessors.get(target).push(step.name);
    }
    const cache = new Map(), activeFlow = new Set();
    function after(name) {
      if (cache.has(name)) return cache.get(name);
      if (activeFlow.has(name)) return new Set();
      activeFlow.add(name);
      const step = used.find(step => step.name === name);
      const parents = predecessors.get(name) || [];
      let input = new Set();
      if (parents.length && name !== model.entry) {
        input = new Set(after(parents[0]));
        for (const parent of parents.slice(1)) { const available = after(parent); input = new Set([...input].filter(key => available.has(key))); }
      }
      if (step?.kind === 'action') {
        const af = path.join(ROOT, 'actions', step.ref, 'ACTION.md');
        const action = exists(af) ? parseFrontmatter(read(af)).data || {} : {};
        for (const artifact of asList(action.consumes?.artifacts)) {
          if (NAME.test(String(artifact)) && !input.has(artifact)) E('контракт', file, step.ln, `вход ${artifact} недоступен на всех путях к шагу ${name}`);
        }
        if (step.artifact) input.add(step.artifact);
        else if (action.produces && typeof action.produces === 'object') for (const key of Object.keys(action.produces)) input.add(key);
      }
      activeFlow.delete(name); cache.set(name, input); return input;
    }
    for (const step of used) after(step.name);

    // маршрут: entry, следующий, goto указывают на существующие шаги
    const stepNames = bodyRows.slice(stepsAt + 1)
      .map((l) => (l.match(/^###\s+([\w-]+)\s*$/) || [])[1]).filter(Boolean);
    if (stepNames.length) {
      const entry = d.entry;
      if (!entry) E('процесс', file, 2, 'в шапке нет entry');
      else if (!stepNames.includes(String(entry))) E('процесс', file, 2, `entry «${entry}» не совпадает ни с одним шагом (${stepNames.join(', ')})`);
      bodyRows.slice(stepsAt + 1).forEach((l, i) => {
        const ln = fm.bodyLine + stepsAt + 1 + i;
        const next = (l.match(/^\s*(?:[-*]\s*)?следующий:\s*([\w-]+)\s*$/) || [])[1];
        if (next && next !== 'end' && !stepNames.includes(next)) E('процесс', file, ln, `следующий: «${next}» — такого шага нет`);
        const m = l.match(/[\w-]+:\s*(?:в артефакте[^→]*)?→\s*goto:\s*([\w-]+)/i) || l.match(/^\s*(?:[-*]\s*)?goto:\s*([\w-]+)\s*$/);
        if (m && m[1] !== 'end' && !stepNames.includes(m[1])) E('процесс', file, ln, `goto: «${m[1]}» — такого шага нет`);
      });
    }
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
    if (!n.endsWith('.md')) continue;
    const file = path.join(ROOT, 'adapters', n);
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

// Запись конфига указывает адаптер путём шаблона (adapters/TODO.md) или именем
// системы (jira); и то и другое сводится к файлу adapters/<имя>.md.
const adapterName = (ref) => String(ref).trim().replace(/^adapters\//, '').replace(/\.md$/, '');
const adapterFile = (ref) => path.join(ROOT, 'adapters', `${adapterName(ref)}.md`);

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

function ruleSources() {
  const tpl = path.join(ROOT, 'config/sources.template.json');
  if (!exists(tpl)) E('настройки команды', tpl, 0, 'нет config/sources.template.json');
  else loadJson('настройки команды', tpl);

  const file = path.join(ROOT, 'config/sources.json');
  if (!exists(file)) return;
  const j = loadJson('настройки команды', file);
  if (!j) return;
  if (typeof j !== 'object' || Array.isArray(j)) { E('настройки команды', file, 0, 'настройки должны быть объектом'); return; }
  for (const key of ['taskStores', 'codeStores']) if (j[key] !== undefined && !Array.isArray(j[key])) E('настройки команды', file, 0, `${key}: нужен массив`);
  // Форма поставки: taskStores (системы задач) и codeStores (репозитории).
  // Прежний массив sources не поддерживается: его записи никто не читает.
  if (Array.isArray(j.sources)) {
    E('настройки команды', file, 0, 'массив sources устарел: системы задач — в taskStores, репозитории — в codeStores');
  }
  if (j.overlay) E('настройки команды', file, 0, 'overlay не поддерживается: конфиг один в текущей ветке');
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
const SECRET_SCAN_SKIP = new Set(['tools/validate.js', '.gigacode/settings.json']);

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

function ruleTeam() {
  return; // содержимое TEAM.md проверяет раскладка: одной ошибки на файл достаточно
}

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
  const file = path.join(ROOT, 'config/sources.json');
  if (!exists(file)) return;
  const j = loadJson('настройки команды', file);
  if (!j) return;
  for (const [, s] of storeEntries(j)) {
    if (!s || typeof s !== 'object') continue;
    const ref = s.adapter || (s.kind ? String(s.kind) : '');
    if (!ref) { W('настройки команды', file, 0, `у записи «${s.id}» не задан adapter`); continue; }
    if (isTodo(ref)) continue;
    if (!exists(adapterFile(ref))) E('настройки команды', file, 0, `подключение adapters/${adapterName(ref)}.md для «${s.id}» не найдено`);
  }
  const def = (j.defaults || {}).process;
  if (def && def !== 'TODO' && !exists(path.join(ROOT, 'processes', `${def}.md`))) {
    E('настройки команды', file, 0, `defaults.process «${def}» не найден в processes/`);
  }
}

// ---------- контекст ----------

function ruleContext() {
  const files = [];
  for (const d of ['context']) {
    for (const n of ls(path.join(ROOT, d))) {
      const full = path.join(ROOT, d, n);
      if (isDir(full)) E('контекст', full, 0, 'подпапок в context/ нет: командные и личные файлы лежат рядом, отличаются префиксом');
      else if (n.endsWith('.md')) files.push(full);
      else E('контекст', full, 0, 'в context/ только файлы .md');
    }
  }
  for (const file of files) {
    const text = read(file);
    const n = lines(text).length;
    const base = path.basename(file);
    if (!text.trim()) E('контекст', file, 1, 'пустой файл контекста: удалите его или заполните');
    else if (!/^#[^#]/.test(text)) E('контекст', file, 1, 'нет заголовка «# …»');
    if (base === 'writing-style.md' && n > 100) E('контекст', file, 0, `правила письма длиннее 100 строк (${n})`);
    else if (n > 80) W('контекст', file, 0, `файл контекста длинный (${n} строк): контекст читается в каждой сессии`);
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
  if (!/^Дата:\s*\d{4}-\d{2}-\d{2}/m.test(t)) E('итог', file, 0, 'нет строки «Дата: ГГГГ-ММ-ДД ЧЧ:ММ»');
  const end = t.match(/^Чем закончилось:\s*(.*)$/m);
  if (!end) E('итог', file, 0, 'нет строки «Чем закончилось: …»');
  else {
    const v = end[1].trim();
    if (isProbe && !/^Пробный прогон, ничего не отправлено/.test(v)) E('итог', file, 0, 'пробный прогон: «Чем закончилось: Пробный прогон, ничего не отправлено. …»');
    if (!isProbe && !/^(готово|не получилось:)/i.test(v)) E('итог', file, 0, '«Чем закончилось:» начинается с «готово» или «не получилось: <причина>»');
  }
  if (/\$secret:|Bearer\s|Authorization:|x-[a-z]+-token/i.test(t)) E('итог', file, 0, 'в итоге есть данные доступа');
  if (/^\s+at\s.+:\d+:\d+\)?$/m.test(t) || /\b(TypeError|ReferenceError|ECONNREFUSED|stack trace)\b/.test(t)) W('итог', file, 0, 'похоже на текст системной ошибки: причину пишите простыми словами');
  const others = names.filter((n) => !n.startsWith('.') && n !== 'итог.md');
  const listAt = rows.findIndex((r) => /^Файлы в этой папке:/.test(r));
  if (others.length && listAt < 0) W('итог', file, 0, 'нет списка «Файлы в этой папке:»');
  if (listAt >= 0) {
    if (/\.run\//.test(rows.slice(listAt).join('\n'))) E('итог', file, listAt + 1, 'в списке файлов не упоминается .run/');
    for (let i = listAt + 1; i < rows.length; i++) {
      const m = rows[i].match(/^-\s+(\S+)\s+—/);
      if (!m) { if (rows[i].trim() && !rows[i].startsWith('-')) break; continue; }
      if (!names.includes(m[1])) W('итог', file, i + 1, `в списке есть ${m[1]}, а в папке его нет`);
    }
  }
}

function checkRunDir(dir) {
  for (const n of ls(dir)) {
    const f = path.join(dir, n);
    if (['run.md', 'trace.jsonl', 'state.json'].includes(n)) continue;
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
  let config;
  const configFile = path.join(ROOT, 'config/sources.json');
  const visiting = new Set();
  function scan(name, depth = 1) {
    if (depth > 5 || visiting.has(name)) { E('маршрут', null, 0, `цикл или глубина подпроцесса больше 5: ${name}`); return; }
    visiting.add(name);
    const file = path.join(ROOT, 'processes', `${name}.md`);
    if (!exists(file)) { E('значения', file, 0, `нет процесса ${name}`); visiting.delete(name); return; }
    const model = processModel(read(file));
    for (const error of model.errors) E('маршрут', file, 0, error);
    const req = model.data.requires || {};
    for (const step of model.steps) {
      if (step.kind === 'process') { scan(step.ref, depth + 1); continue; }
      if (step.kind !== 'action') continue;
      const af = path.join(ROOT, 'actions', step.ref, 'ACTION.md');
      if (!exists(af)) { E('значения', af, 0, `нет действия ${step.ref}`); continue; }
      const action = parseFrontmatter(read(af)).data || {};
      for (const [key, folder] of Object.entries({ query: 'queries', template: 'templates', rule: 'rules' })) {
        if (!asList(action.consumes?.params).some(p => String(p).split(/[ (]/)[0] === key) && !(key in step.params)) continue;
        const value = parameter(model, step, key, overrides);
        if (value == null) continue;
        if (!NAME.test(String(value)) || !exists(path.join(ROOT, 'actions', step.ref, folder, `${value}.md`))) {
          E('значения', file, step.ln, `не найден файл ${folder}/${value}.md для ${step.ref}`);
        }
      }
      if (opt.demo || action.kind === 'transform' || /^none(?: |$)/.test(String(action.adapter))) continue;
      const fields = { taskStore: asList(req.taskFields), codeStore: asList(req.codeFields) };
      if (!fields.taskStore.length && !fields.codeStore.length) {
        E('значения', file, 0, 'сетевой процесс должен объявить requires.taskFields/codeFields'); continue;
      }
      if (config === undefined) config = exists(configFile) ? loadJson('значения', configFile) : null;
      if (!config) { E('значения', configFile, 0, 'нет корректного config/sources.json: нужна настройка'); continue; }
      for (const [key, required] of Object.entries(fields)) {
        if (!required.length) continue;
        const collection = key === 'taskStore' ? 'taskStores' : 'codeStores';
        const id = parameter(model, step, key, overrides) ?? config.defaults?.[key];
        const entry = (config[collection] || []).find(item => item?.id === id);
        if (!entry) { E('значения', file, 0, `не найдена выбранная запись ${collection}: ${id || 'id не задан'}`); continue; }
        if (entry.enabled === false) { E('значения', file, 0, `подключение ${id} выключено`); continue; }
        function values(obj, parts) {
          if (!parts.length) return [obj];
          const [part, ...rest] = parts;
          if (part.endsWith('[]')) {
            const array = obj?.[part.slice(0, -2)];
            return Array.isArray(array) && array.length ? array.flatMap(item => values(item, rest)) : [undefined];
          }
          return values(obj?.[part], rest);
        }
        for (const field of ['adapter', 'mcpServer', ...required]) {
          const vals = values(entry, String(field).split('.'));
          const empty = value => value == null || value === '' || isTodo(value) ||
            (Array.isArray(value) && (!value.length || value.some(empty)));
          if (String(field).startsWith('modules[]') && Array.isArray(entry.modules) && entry.modules.length === 0) continue;
          if (vals.some(empty)) E('значения', file, 0, `${collection}[${id}].${field} не заполнено`);
        }
        if (!isTodo(entry.adapter) && !exists(adapterFile(entry.adapter))) E('значения', file, 0, `нет подключения ${entry.adapter}`);
      }
    }
    visiting.delete(name);
  }
  scan(opt.process);
}

// ---------- запуск ----------

const RULES = {
  layout: ruleLayout,
  levels: ruleLevels,
  skills: ruleSkills,
  processes: () => {
    ruleProcesses();
    const active = new Set();
    function visit(name, depth) {
      if (active.has(name) || depth > 5) { E('маршрут', null, 0, `цикл или глубина подпроцесса больше 5: ${name}`); return; }
      const file = path.join(ROOT, 'processes', `${name}.md`);
      if (!exists(file)) return;
      active.add(name);
      for (const step of processModel(read(file)).steps) if (step.kind === 'process') visit(step.ref, depth + 1);
      active.delete(name);
    }
    for (const file of ls(path.join(ROOT, 'processes'))) if (file.endsWith('.md')) visit(file.slice(0, -3), 1);
  },
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
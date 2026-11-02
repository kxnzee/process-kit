#!/usr/bin/env node
// Сверка прогона процесса с эталонными результатами шагов.
// Запуск: node tools/check-report.js                                  — все наборы tests/<имя>/ открытой ветки
//         node tools/check-report.js --tests tests/<имя>              — один набор
//         node tools/check-report.js --process sdd-stories-report     — набор того же имени
//         node tools/check-report.js --run outputs/<имя>/.run         — плюс сверка с артефактами прогона
// Код возврата: 0 — расхождений нет, 1 — есть (или сверять нечего).

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const has = (name) => args.includes(name);

const root = path.resolve(arg('--root', process.cwd()));

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function fail(file, message) {
  problems.push({ file, message });
}

const problems = [];

// 1. Где лежат эталоны: каталог целиком (--tests) или один набор того же имени, что процесс.
// Без --tests и без имени процесса берутся все наборы открытой ветки: набор — это каталог
// tests/<имя>/ с fixture.json или report.md. Сам каталог tests/ набором не считается.
const explicitTests = arg('--tests', '');
const processName = arg('--process', '');
let sets;
let setsBase;
if (explicitTests) {
  const dir = path.resolve(root, explicitTests);
  sets = exists(dir) && !isSet(dir) ? subSets(dir) : [dir];
  setsBase = dir;
} else if (processName) {
  sets = [path.join(root, 'tests', processName)];
  setsBase = path.join(root, 'tests', processName);
} else {
  let name = '';
  const configFile = path.join(root, 'config', 'sources.json');
  if (exists(configFile)) {
    try {
      name = (JSON.parse(read(configFile)).defaults || {}).process || '';
    } catch (e) {
      fail('config/sources.json', `не разбирается как JSON: ${e.message}`);
    }
  }
  const all = subSets(path.join(root, 'tests'));
  sets = name && all.some((d) => path.basename(d) === name) ? [path.join(root, 'tests', name)] : all;
  setsBase = path.join(root, 'tests');
}
if (!sets.length || !sets.some((d) => exists(d))) {
  console.log(`наборов для сверки нет: в каталоге ${rel(setsBase)} нет ни одного набора`);
  console.log('набор — каталог tests/<имя>/{fixture.json, fetch.json, report.md}');
  process.exit(1);
}

const runDirArg = arg('--run', arg('--runDir', ''));
const fixtureArg = arg('--fixture', '');

let failed = 0;
if (sets.length > 1) console.log(`наборов: ${sets.length}`);
for (const testsDir of sets) {
  if (sets.length > 1) console.log(`\n== ${rel(testsDir)}`);
  checkSet(testsDir);
  report(testsDir);
  if (problems.length) failed += 1;
}
if (sets.length > 1) {
  const ok = sets.length - failed;
  console.log(`\nитого: ${sets.length} ${plural(sets.length, 'набор', 'набора', 'наборов')}, ` +
    `${ok} без расхождений, ${failed} с расхождениями`);
}
process.exit(failed ? 1 : 0);

function isSet(dir) {
  return exists(path.join(dir, 'fixture.json')) || exists(path.join(dir, 'fetch.json')) || exists(path.join(dir, 'report.md'));
}

function subSets(dir) {
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return names
    .filter((d) => d.isDirectory())
    .map((d) => path.join(dir, d.name))
    .filter(isSet)
    .sort();
}

function rel(p) {
  return path.relative(root, p).replace(/\\/g, '/');
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

function checkSet(testsDir) {
  problems.length = 0;
  let reportData = null;
  let reportText = null;
  if (runDirArg) {
    const runDir = path.resolve(root, runDirArg);
    const dataFile = path.join(runDir, 'report-data.json');
    const textFile = path.join(runDir, 'report-text.md');
    if (!exists(dataFile)) {
      fail(rel(runDir), 'в каталоге прогона нет report-data.json — шаг fetch не оставил артефакт');
    } else {
      try {
        reportData = JSON.parse(read(dataFile));
      } catch (e) {
        fail(rel(dataFile), `report-data.json не разбирается как JSON: ${e.message}`);
      }
    }
    if (exists(textFile)) reportText = read(textFile);
  } else if (sets.length === 1) {
    console.log('каталог прогона не указан (--run <каталог>): сверяю только эталоны между собой');
  }

  // 3. Эталон fetch.json и, если он есть, report-data.json прогона.
  const fetchFile = path.join(testsDir, 'fetch.json');
  let expected = null;
  let demoSet = false;
  if (!exists(fetchFile)) {
    fail(rel(fetchFile), 'нет эталона шага fetch');
  } else {
    try {
      const parsed = JSON.parse(read(fetchFile));
      expected = parsed.expected || null;
      if (parsed.demo === true) demoSet = true;
    } catch (e) {
      fail(rel(fetchFile), `не разбирается как JSON: ${e.message}`);
    }
  }

  if (expected) {
    checkFixture(expected);
    if (reportData) checkReportData(expected, reportData);
  }

  // 4. Эталон report.md и, если он есть, report-text.md прогона.
  const reportFile = path.join(testsDir, 'report.md');
  if (!exists(reportFile)) {
    fail(rel(reportFile), 'нет эталона шага compose');
  } else if (reportText) {
    checkReportText(read(reportFile), reportText);
  }
}

function report(testsDir) {
  const line = '-'.repeat(60);
  console.log('Process Kit — сверка с эталоном');
  console.log(`каталог: ${root}`);
  console.log(`эталоны: ${rel(testsDir)}`);
  console.log(`прогон:  ${runDirArg ? rel(path.resolve(root, runDirArg)) : '(не указан)'}`);
  console.log(line);
  if (!problems.length) console.log('расхождений нет');
  for (const p of problems) console.log(`РАСХОЖДЕНИЕ ${p.file}: ${p.message}`);
  console.log(line);
  console.log(`расхождений: ${problems.length}`);
}

// --- проверки набора -------------------------------------------------------

function checkFixture(exp) {
  const fixturePath = path.resolve(root, fixtureArg || argFromFetchJson('fixture') || '');
  if (!fixtureArg && !argFromFetchJson('fixture')) return;
  if (!exists(fixturePath)) {
    fail(rel(fixturePath), 'фикстура, на которой собран эталон, не найдена');
    return;
  }
  let fx;
  try {
    fx = JSON.parse(read(fixturePath));
  } catch (e) {
    fail(rel(fixturePath), `не разбирается как JSON: ${e.message}`);
    return;
  }
  checkSet(rel(fixturePath), (fx.stories || []).map((s) => s.key), exp.sddKeys.concat(exp.plainKeys), 'выборка фикстуры против эталона');
  checkSet(rel(fixturePath), (fx.excluded || []).map((s) => s.key), Object.keys(exp.excluded), 'отсев фикстуры против эталона');
  checkSet(rel(fixturePath), (fx.unverified || []).map((s) => s.key), Object.keys(exp.unverified), 'непроверенные фикстуры против эталона');
  for (const s of fx.stories || []) {
    const row = exp.sddRows[s.key] || (exp.plainKeys.includes(s.key) ? {} : null);
    if (!row) {
      fail(rel(fixturePath), `«${s.key}» есть в фикстуре, но не указана ни в sddKeys, ни в plainKeys эталона`);
      continue;
    }
    if (row.status && s.status !== row.status) {
      fail(rel(fixturePath), `«${s.key}»: статус в фикстуре «${s.status}», в эталоне «${row.status}»`);
    }
    if (row.inProgressAt && s.inProgressAt !== row.inProgressAt) {
      fail(rel(fixturePath), `«${s.key}»: дата старта в фикстуре «${s.inProgressAt}», в эталоне «${row.inProgressAt}»`);
    }
  }
}
function argFromFetchJson(key) {
  try {
    return JSON.parse(read(fetchFile))[key] || '';
  } catch {
    return '';
  }
}

function checkReportData(exp, data) {
  const file = 'report-data.json';
  let sdd = asArray(data.sddStories);
  let plain = asArray(data.plainStories);
  let unv = asArray(data.unverified);
  let c = data.counters || {};
  if (!sdd.length && !plain.length && !Object.keys(c).length && data.expected) {
    // артефакт шага целиком в форме эталона: группы и счётчики лежат под expected
    const inner = data.expected;
    sdd = asArray(inner.sddKeys).map((key) => ({ key, ...(inner.sddRows || {})[key] }));
    plain = asArray(inner.plainKeys).map((key) => ({ key }));
    unv = Object.keys(inner.unverified || {}).map((key) => ({ key, reason: inner.unverified[key] }));
    c = inner;
  }

  for (const name of ['storyCount', 'sddCount', 'plainCount', 'labelCount', 'commitCount', 'unverifiedCount']) {
    if (c[name] === undefined) {
      fail(file, `в счётчиках нет поля ${name}`);
    } else if (Number(c[name]) !== Number(exp[name])) {
      fail(file, `${name}: в прогоне ${c[name]}, в эталоне ${exp[name]}`);
    }
  }
  const share = String(c.sddShare === undefined ? '' : c.sddShare).replace(',', '.');
  if (share === '') {
    fail(file, 'в счётчиках нет поля sddShare');
  } else if (Number(share) !== Number(String(exp.sddShare).replace(',', '.'))) {
    fail(file, `sddShare: в прогоне ${c.sddShare}, в эталоне ${exp.sddShare}`);
  }

  checkSet(file, sdd.map((s) => s.key), exp.sddKeys, 'группа «по SDD»');
  checkSet(file, plain.map((s) => s.key), exp.plainKeys, 'группа «без SDD»');
  checkSet(file, unv.map((s) => s.key), Object.keys(exp.unverified), 'раздел «проверить не удалось»');

  for (const s of sdd) {
    const rows = exp.sddRows[s.key];
    if (!rows) continue;
    if (rows.status && s.status !== rows.status) fail(file, `«${s.key}»: статус ${s.status}, в эталоне ${rows.status}`);
    if (rows.inProgressAt && s.inProgressAt !== rows.inProgressAt) {
      fail(file, `«${s.key}»: старт ${s.inProgressAt}, в эталоне ${rows.inProgressAt}`);
    }
    const want = exp.via[s.key];
    if (want && !sameVia(s.via, want)) fail(file, `«${s.key}»: засчитано по «${s.via}», в эталоне «${want}»`);
    if (!s.url) fail(file, `«${s.key}»: нет url — ссылку нельзя собрать`);
    if (sdd === data.sddStories && s === data.sddStories[0] && !('commit' in s)) {
      fail(file, 'в элементах sddStories нет поля commit (допустимо «—», но поле обязано быть)');
    }
  }
  for (const s of unv) {
    const want = exp.unverified[s.key];
    if (want && !contains(s.reason, want)) {
      fail(file, `«${s.key}» (не проверено): причина «${s.reason}» не содержит ожидаемого «${want}»`);
    }
  }
}

function sameVia(got, want) {
  const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const g = norm(got);
  const w = norm(want);
  if (g === w) return true;
  const both = g.includes('метк') && g.includes('pr');
  const label = g.includes('метк') && !g.includes('pr');
  const byPr = g.includes('pr') && !g.includes('метк');
  if (w.includes('метка') && w.includes('pr')) return both;
  if (w === 'pr с артефактами') return byPr;
  if (w === 'метка') return label;
  return false;
}

function contains(text, needle) {
  return String(text || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function checkReportText(expText, gotText) {
  const file = 'report-text.md';
  const expRows = rowsOf(expText);
  const gotRows = rowsOf(gotText);
  if (!expRows.length) {
    fail(rel(reportFile), 'в эталоне нет ни одной строки-факта');
    return;
  }
  const gotAll = normalize(gotText);
  for (const row of expRows) {
    const line = row.cells.join(' | ');
    if (!row.key) {
      const ok = gotRows.some((r) =>
        row.cells.every((cell) => normalize(r.cells.join(' | ')).includes(normalize(cell)))
      );
      if (!ok) fail(file, `нет строки из эталона: «${line}»`);
      continue;
    }
    const found = gotRows.filter((r) => r.key === row.key);
    if (!found.length) {
      fail(file, `нет задачи «${row.key}», которая есть в эталоне`);
      continue;
    }
    const hits = found.filter((r) => {
      const text = normalize(r.cells.join(' | '));
      return row.cells.every((cell) => normalize(text).includes(normalize(cell)));
    });
    if (!hits.length) {
      fail(file, `«${row.key}»: строка не совпадает с эталоном «${line}», в отчёте «${found[0].cells.join(' | ')}»`);
    }
  }
  const expKeys = new Set(expRows.map((r) => r.key).filter(Boolean));
  for (const r of gotRows) {
    if (r.key && !expKeys.has(r.key)) fail(file, `лишняя задача «${r.key}», которой нет в эталоне`);
  }
  const expectedDemo = demoSet || contains(expText, 'ДАННЫЕ ДЕМО');
  const gotDemo = contains(gotAll, 'ДАННЫЕ ДЕМО');
  if (expectedDemo !== gotDemo) {
    fail(file, gotDemo ? 'в отчёте пометка «ДАННЫЕ ДЕМО» есть, а эталон ждёт живой прогон' : 'в отчёте нет пометки «ДАННЫЕ ДЕМО», хотя набор проверяется на демо-прогоне');
  }
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Строки-факты: строки таблиц, у которых есть ключ задачи, и строки итоговой таблицы.
// Заголовки, текст и комментарии не сверяются — формулировки шаблона могут меняться;
// порядок строк значения не имеет.
function rowsOf(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|') || /^\|.*---/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
    if (!cells.length) continue;
    const keyCell = cells.find((c) => /\b[A-Z][A-Z0-9]+-\d+\b/.test(c));
    const key = keyCell ? (keyCell.match(/\b[A-Z][A-Z0-9]+-\d+\b/) || [])[0] : '';
    if (!key && !/^\d/.test(cells[cells.length - 1])) continue;
    out.push({ key, cells });
  }
  return out;
}

function checkSet(file, got, want, label) {
  const g = (got || []).slice().sort();
  const w = (want || []).slice().sort();
  const missing = w.filter((k) => !g.includes(k));
  const extra = g.filter((k) => !w.includes(k));
  if (missing.length) fail(file, `${label}: нет ${missing.join(', ')}`);
  if (extra.length) fail(file, `${label}: лишние ${extra.join(', ')}`);
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}
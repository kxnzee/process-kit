#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-report-'));
const source = path.join(__dirname, '..', 'tests', 'sdd-stories-report');
const set = path.join(root, 'tests', 'sdd-stories-report');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
let count = 0;
function run(name, ok, extra = []) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-report.js'), '--root', root, ...extra], { encoding: 'utf8' });
  assert.equal(r.status, ok ? 0 : 1, `${name}: ${r.stdout} ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /ReferenceError|TypeError/);
  count++;
}
try {
  fs.mkdirSync(path.dirname(set), { recursive: true });
  fs.cpSync(source, set, { recursive: true });
  run('исходный набор', true);
  const fixtureFile = path.join(set, 'fixture.json');
  const fixture = fs.readFileSync(fixtureFile);
  const badFixture = JSON.parse(fixture);
  badFixture.stories.pop();
  write(fixtureFile, badFixture);
  run('пропавшая задача в фикстуре', false);
  fs.writeFileSync(fixtureFile, fixture);
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'sources.json'), '{');
  run('повреждённый конфиг', false);
  fs.unlinkSync(path.join(root, 'config', 'sources.json'));
  const fetchFile = path.join(set, 'fetch.json');
  const fetch = JSON.parse(fs.readFileSync(fetchFile));
  write(fetchFile, { ...fetch, expected: null });
  run('нет expected', false);
  write(fetchFile, fetch);
  const runDir = path.join(root, 'run');
  fs.mkdirSync(runDir);
  const exp = fetch.expected;
  const data = {
    counters: exp,
    excluded: Object.entries(exp.excluded).map(([key, reason]) => ({ key, reason })),
    sddStories: exp.sddKeys.map(key => ({ key, ...exp.sddRows[key], via: exp.via[key], url: `https://example.test/${key}`, commit: '—' })),
    plainStories: exp.plainKeys.map(key => ({ key })),
    unverified: Object.entries(exp.unverified).map(([key, reason]) => ({ key, reason })),
  };
  write(path.join(runDir, 'report-data.json'), data);
  const report = 'ДАННЫЕ ДЕМО\n' + fs.readFileSync(path.join(set, 'report.md'), 'utf8');
  fs.writeFileSync(path.join(runDir, 'report-text.md'), report);
  run('полный корректный прогон', true, ['--run', runDir]);
  fs.unlinkSync(path.join(runDir, 'report-text.md'));
  run('нет отчёта', false, ['--run', runDir]);
  fs.writeFileSync(path.join(runDir, 'report-text.md'), 'пустой отчёт');
  run('неверный отчёт', false, ['--run', runDir]);
  fs.writeFileSync(path.join(runDir, 'report-text.md'), report);
  write(path.join(runDir, 'report-data.json'), { ...data, counters: { ...exp, storyCount: 999 } });
  run('неверные счётчики', false, ['--run', runDir]);
  write(path.join(runDir, 'report-data.json'), data);
  const mappedData = path.join(runDir, '01-fetch.json');
  const mappedText = path.join(runDir, '02-compose.md');
  fs.renameSync(path.join(runDir, 'report-data.json'), mappedData);
  fs.renameSync(path.join(runDir, 'report-text.md'), mappedText);
  write(path.join(runDir, 'state.json'), { artifacts: { 'report-data': '01-fetch.json', 'report-text': '02-compose.md' } });
  run('артефакты по state', true, ['--run', runDir]);
  const duplicate = JSON.parse(JSON.stringify(data)); duplicate.sddStories.push(duplicate.sddStories[0]);
  write(mappedData, duplicate);
  run('повтор задачи', false, ['--run', runDir]);
  write(mappedData, data);
  const wrongLabels = JSON.parse(fixture); wrongLabels.stories[0].labels = []; wrongLabels.stories[0].prs = [];
  write(fixtureFile, wrongLabels);
  run('независимая группировка фикстуры', false);
  fs.writeFileSync(fixtureFile, fixture);
  fs.writeFileSync(mappedText, report.replace('| Выполнено по SDD | 3 |', '| Выполнено по SDD | 30 |'));
  run('число не совпадает по префиксу', false, ['--run', runDir]);
  fs.writeFileSync(mappedText, report);
  fs.writeFileSync(path.join(set, 'report.md'), 'нет таблиц');
  run('пустой эталон отчёта', false, ['--run', runDir]);
  console.log(`Проверки сверки отчётов: ${count} пройдено.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

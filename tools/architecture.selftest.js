#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { processModel, allowedReference } = require('./process-model');
const { normalizeFixture } = require('./sdd-data');
const { parseFrontmatter } = require('./markdown');
const { validRunFolderName } = require('./paths');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-contracts-'));
const source = path.join(__dirname, '..');
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true }); fs.writeFileSync(path.join(tmp, file), text); };
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }
function validate(args, success, contains) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'validate.js'), '--root', tmp, '--json', ...args], { encoding: 'utf8' });
  assert.equal(result.status, success ? 0 : 1, result.stdout + result.stderr);
  if (contains) assert.ok(result.stdout.includes(contains), result.stdout);
}
function model(body) { return processModel(`---\nname: sample\nentry: a\n---\n## Шаги\n${body}`); }
try {
  for (const dir of ['processes', 'actions', 'context', 'config', 'adapters', '.gigacode']) fs.cpSync(path.join(source, dir), path.join(tmp, dir), { recursive: true });
  check('transform без конфига', () => validate(['--process', 'edit-text'], true));
  check('демо без конфига и MCP', () => validate(['--process', 'sdd-stories-report', '--demo'], true));
  check('живой источник без конфига', () => validate(['--process', 'sdd-stories-report'], false, 'нужна настройка'));
  const config = { schemaVersion: 1, taskStores: [{ id: 'tasks', enabled: true, adapter: 'adapters/jira.md', mcpServer: 'test', baseUrl: 'https://example.invalid', issueUrlTemplate: '{key}', projects: ['TEST'], modules: [] }], codeStores: [{ id: 'code', adapter: 'adapters/bitbucket.md', mcpServer: 'test', baseUrl: 'https://example.invalid', repositories: [{ projectKey: 'TEST', slug: 'repo', defaultBranch: 'master' }], acceptTargetBranches: ['master'] }], defaults: { taskStore: 'tasks', codeStore: 'code' } };
  const save = () => write('config/sources.json', JSON.stringify(config)); save();
  check('только выбранные записи', () => { config.taskStores.push({ id: 'other', projects: ['TODO'] }); save(); validate(['--process', 'sdd-stories-report'], true); });
  check('частично заполненный массив', () => { config.taskStores[0].projects.push('TODO'); save(); validate(['--process', 'sdd-stories-report'], false, 'projects'); config.taskStores[0].projects.pop(); save(); });
  check('вложенный TODO в репозитории', () => { config.codeStores[0].repositories[0].slug = 'TODO'; save(); validate(['--process', 'sdd-stories-report'], false, 'repositories[].slug'); config.codeStores[0].repositories[0].slug = 'repo'; save(); });
  check('disabled', () => { config.taskStores[0].enabled = false; save(); validate(['--process', 'sdd-stories-report'], false, 'выключено'); config.taskStores[0].enabled = true; save(); });
  check('не подставлять первую запись', () => { config.defaults.taskStore = 'missing'; save(); validate(['--process', 'sdd-stories-report'], false, 'missing'); config.defaults.taskStore = 'tasks'; save(); });
  check('явный выбор записи приоритетнее defaults', () => { write('params.json', '{"taskStore":"other"}'); validate(['--process', 'sdd-stories-report', '--params', path.join(tmp, 'params.json')], false, 'other'); });
  check('точный запрос, без fallback', () => { write('params.json', '{"query":"missing"}'); validate(['--process', 'sdd-stories-report', '--demo', '--params', path.join(tmp, 'params.json')], false, 'queries/missing.md'); });
  check('посторонний запрос не блокирует', () => { write('actions/run-query/queries/unused.md', 'taskStores[].missing\n'); validate(['--process', 'sdd-stories-report'], true); });
  check('цикл маршрута', () => assert.ok(model('### a\n- действие: edit-text\n- следующий: a').errors.some(e => e.includes('цикл'))));
  check('неизвестный переход', () => assert.ok(model('### a\n- действие: edit-text\n- следующий: missing').errors.some(e => e.includes('отсутствующий'))));
  check('повтор шага', () => assert.ok(model('### a\n- действие: edit-text\n### a\n- действие: edit-text').errors.some(e => e.includes('повтор'))));
  check('branch требует default', () => assert.ok(model('### a\n- branch:\n - когда: true → goto: end').errors.some(e => e.includes('default'))));
  check('ссылка между командами запрещена', () => assert.equal(allowedReference('team-a-report', 'team-b-query'), false));
  check('личный на общий разрешён', () => assert.equal(allowedReference('my-report', 'run-query'), true));
  check('неверная календарная дата', () => assert.equal(validRunFolderName('2026-02-30_отчёт'), false));
  check('не более четырёх слов', () => assert.equal(validRunFolderName('2026-11-02_раз-два-три-четыре-пять'), false));
  check('суффикс повтора не слово', () => assert.equal(validRunFolderName('2026-11-02_раз-два-три-четыре-2'), true));
  check('длина имени', () => assert.equal(validRunFolderName(`2026-11-02_${'я'.repeat(41)}`), false));
  check('обратная ссылка даже при существующем файле', () => {
    write('actions/my-edit/ACTION.md', '---\nname: my-edit\ndescription: text\nkind: transform\nconsumes: []\nproduces: []\n---\n');
    write('processes/sample.md', '---\nname: sample\ndescription: sample\nentry: a\n---\n## Шаги\n### a\n- действие: my-edit\n');
    validate(['--only', 'processes'], false, 'ссылка вниз');
  });
  check('числовой токен отклоняется', () => {
    write('.gigacode/settings.json', '{"headers":{"x-jira-token":12345}}');
    validate(['--only', 'settings'], false, 'должно быть ссылкой');
  });
  check('ссылка внутри произвольного токена не разрешается', () => {
    write('.gigacode/settings.json', '{"headers":{"x-jira-token":"prefix $secret:jira/token suffix"}}');
    validate(['--only', 'settings'], false, 'вместо ссылки');
  });
  check('несовместимый вход действия', () => {
    write('processes/sample.md', '---\nname: sample\nversion: 1.0.0\narea: тест\nstatus: действует\ndescription: sample\nexample: test\nentry: compose\nrequires:\n  actions: [compose-report]\n---\n## Шаги\n### compose\n- действие: compose-report\n- параметры: `template: report`\n- артефакт: report-text\n');
    validate(['--only', 'processes'], false, 'вход report-data недоступен');
  });
  const fx = JSON.parse(fs.readFileSync(path.join(source, 'tests/sdd-stories-report/fixture.json')));
  check('положительный PR достаточен при неизвестной метке', () => {
    const input = structuredClone(fx); delete input.stories[1].labels;
    assert.ok(normalizeFixture(input).sddStories.some(s => s.key === 'DEMO-202'));
  });
  check('повтор поля в шапке', () => assert.ok(parseFrontmatter('---\nname: one\nname: two\n---').error));
  check('неподдерживаемая шапка', () => assert.ok(parseFrontmatter('---\nname: one\nnot yaml\n---').error));
  console.log(`Архитектурные проверки: ${passed} пройдено.`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

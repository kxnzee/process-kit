'use strict';
const fixture = require('../fixture');
const ctx = fixture();
const { fs, path, assert, tmp, source, write, check, validate, model, allowedReference, validRunFolderName, parseFrontmatter } = ctx;
try {
  check('живой источник без конфига', () => validate(['--process', 'sdd-stories-report'], false, 'нужна настройка'));
  const config = { schemaVersion: 2, team: {id:'test',name:'Test',owners:[]}, taskStores: [{ id: 'tasks', enabled: true, adapter: 'adapters/jira/ADAPTER.md', mcpServer: 'test', baseUrl: 'https://example.invalid', issueUrlTemplate: '{key}', projects: ['TEST'], modules: [] }], codeStores: [{ id: 'code', adapter: 'adapters/bitbucket/ADAPTER.md', mcpServer: 'test', baseUrl: 'https://example.invalid', repositories: [{ projectKey: 'TEST', slug: 'repo', defaultBranch: 'master' }], acceptTargetBranches: ['master'] }], defaults: { taskStore: 'tasks', codeStore: 'code' } };
  const save = () => write('config/team/config.json', JSON.stringify(config)); save();
  check('только выбранные записи', () => { config.taskStores.push({ id: 'other', projects: ['TODO'] }); save(); validate(['--process', 'sdd-stories-report'], true); });
  check('частично заполненный массив', () => { config.taskStores[0].projects.push('TODO'); save(); validate(['--process', 'sdd-stories-report'], false, 'projects'); config.taskStores[0].projects.pop(); save(); });
  check('вложенный TODO в репозитории', () => { config.codeStores[0].repositories[0].slug = 'TODO'; save(); validate(['--process', 'sdd-stories-report'], false, 'repositories[].slug'); config.codeStores[0].repositories[0].slug = 'repo'; save(); });
  check('disabled', () => { config.taskStores[0].enabled = false; save(); validate(['--process', 'sdd-stories-report'], false, 'выключено'); config.taskStores[0].enabled = true; save(); });
  check('не подставлять первую запись', () => { config.defaults.taskStore = 'missing'; save(); validate(['--process', 'sdd-stories-report'], false, 'missing'); config.defaults.taskStore = 'tasks'; save(); });
  check('явный выбор записи приоритетнее defaults', () => { write('params.json', '{"taskStore":"other"}'); validate(['--process', 'sdd-stories-report', '--params', path.join(tmp, 'params.json')], false, 'other'); });
  check('точный запрос, без fallback', () => { write('params.json', '{"queryFile":"processes/sdd-stories-report/queries/missing.md"}'); validate(['--process', 'sdd-stories-report', '--demo', '--params', path.join(tmp, 'params.json')], false, 'queries/missing.md'); });
  check('query parameters must be an object before execution', () => {
    write('params.json', '{"parameters":[]}');
    validate(['--process', 'sdd-stories-report', '--demo', '--params', path.join(tmp, 'params.json')], false, 'Нужен объект аргументов');
  });
  check('посторонний запрос не блокирует', () => { write('processes/sdd-stories-report/queries/unused.md', 'taskStores[].missing\n'); validate(['--process', 'sdd-stories-report'], true); });
} finally { ctx.close(); }

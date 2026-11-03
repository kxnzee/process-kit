#!/usr/bin/env node
// Самопроверка валидатора: во временной папке собирается эталонная расстановка
// файлов, затем каждая проверка кладёт один файл и смотрит на ответ validate.js.
// Набор проверяет, что базовые сущности не ломаются: процесс ссылается на
// существующее действие, у действия его данные рядом, скилл лежит плоско,
// контекст — плоский Markdown, доступы — ссылкой, результат запуска — в своей папке.
// Набор не про полноту и ничего не блокирует: проверки независимы.
// Запуск: node tools/validate.selftest.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VALIDATE = path.join(__dirname, 'validate.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-validate-'));
const root = path.join(tmp, 'kit');

function w(rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
function rm(rel) { fs.rmSync(path.join(root, rel), { recursive: true, force: true }); }
function run() {
  return JSON.parse(spawnSync(process.execPath, [VALIDATE, '--root', root, '--json'], { encoding: 'utf8' }).stdout);
}

// Эталон: файлы, которые раскладка разрешает, плюс один готовый прогон.
const BASE = {
  '.gitignore': 'outputs/\n.history/\nProcess Kit/\n.runs/\n',
  '.gigacode/skills/pp-ai-mentor/SKILL.md': '---\nname: pp-ai-mentor\ndescription: Помощник.\ninternal: вызывается мной\n---\nтекст\n',
  '.gigacode/settings.json': '{"mcpServers":{"pp-ai-jira":{"headers":{"x-jira-token":"$secret:pp-ai-jira/x-jira-token"}}}}',
  'processes/my-summary.md': [
    '---', 'name: my-summary', 'version: 1.0.0', 'area: задачи', 'status: действует',
    'description: Сводка просроченных задач', 'examples: ["сводка просрочки", "кто просрочил"]',
    'requires:', '  actions: [jira-search]', '  context: [my-terms.md]', '---', '',
    '## Шаги', '1. jira-search — запрос: просроченные', '',
  ].join('\n'),
  'actions/jira-search/ACTION.md': '---\nname: jira-search\ndescription: Ищет задачи\nkind: source\nadapter: jira\nconsumes: []\nproduces: { имя: issues }\n---\nВозьми queries/q.md.\n',
  'actions/jira-search/queries/q.md': 'project = TEST\n',
  'adapters/jira.md': '# Подключение: Jira\nMCP-сервер: pp-ai-jira\nОперации:\n- search\nПробный прогон: фикстура.\n',
  'adapters/bitbucket.md': '# Подключение: Bitbucket\nMCP-сервер: pp-ai-jira\nОперации:\n- listPullRequests\nПробный прогон: фикстура.\n',
  'context/my-terms.md': '# Термины\n- Просрочено: срок прошёл.\n',
  'config/sources.template.json': '{"schemaVersion":1,"taskStores":[{"id":"tasks","adapter":"adapters/jira.md","mcpServer":"TODO"}],"codeStores":[]}',
  'outputs/2026-10-29_сводка-просрочки/итог.md': '# Сводка\nДата: 2026-10-29 15:30\nЧем закончилось: готово\nФайлы в этой папке:\n- сводка.md — сводка\n',
  'outputs/2026-10-29_сводка-просрочки/сводка.md': 'x\n',
  'outputs/2026-10-29_сводка-просрочки/.run/state.json': '{"last_step":1,"last_step_name":"jira-search"}',
  'outputs/2026-10-29_сводка-просрочки/.run/01-jira-search.json': '{}',
  '.history/runs.jsonl': '{"ts":"2026-10-29T15:30:00","process":"my-summary","output":"2026-10-29_сводка-просрочки"}\n',
};
for (const [rel, text] of Object.entries(BASE)) w(rel, text);

// «E:<фрагмент>» — ошибка с таким фрагментом, «W:<фрагмент>» — предупреждение,
// «clean» — ни ошибок, ни предупреждений.
const BOUNDS = [
  // действие: имя шага процесса и его данные рядом, в папке действия
  ['процесс ссылается на несуществующее действие', ['processes/my-x.md', '---\nname: my-x\ndescription: Тест\n---\n## Шаги\n1. nope — x\n'], 'E:несуществующее действие nope'],
  ['шаг в подразделе с маркером списка', ['processes/my-step.md', '---\nname: my-step\ndescription: Тест\n---\n## Шаги\n\n### fetch\n\n- действие: nope-step\n- артефакт: data\n'], 'E:несуществующее действие nope-step'],
  ['подпроцесс не найден', ['processes/my-sub.md', '---\nname: my-sub\ndescription: Тест\n---\n## Шаги\n\n### call\n\n- процесс: nope-process\n'], 'E:подпроцесс nope-process не найден'],
  ['действие ссылается на несуществующий шаблон', ['actions/my-a/ACTION.md', '---\nname: my-a\ndescription: Тест\n---\ntemplates/нет.md\n'], 'E:нет файла templates/нет.md'],

  // скилл: только в .gigacode/skills и только плоско
  ['вложенный скилл', ['.gigacode/skills/my-n/inner/SKILL.md', 'x'], 'E:вложенный скилл'],

  // контекст: плоские файлы Markdown с заголовком
  ['пустой файл контекста', ['context/my-empty.md', '\n\n'], 'E:пустой файл контекста'],
  ['файл контекста без заголовка', ['context/my-nohead.md', 'просто текст\n'], 'E:нет заголовка'],
  ['подпапка в context/', 'mkdir:context/my-sub', 'E:подпапок в context/ нет'],
  ['не .md в context/', ['context/my-notes.txt', '# Заметка\n'], 'E:только файлы .md'],

  // настройки команды: записи taskStores/codeStores, а не прежний массив sources
  ['устаревший массив sources', ['config/sources.json', '{"sources":[{"id":"jira-team","adapter":"jira","mcpServer":"jira"}]}'], 'E:массив sources устарел'],
  ['taskStores: нет адаптера', ['config/sources.json', '{"taskStores":[{"id":"tasks","adapter":"adapters/nope.md","mcpServer":"pp-ai-jira"}]}'], 'E:подключение adapters/nope.md для «tasks» не найдено'],
  ['codeStores: имя адаптера без файла', ['config/sources.json', '{"codeStores":[{"id":"code","adapter":"nope","mcpServer":"pp-ai-jira"}]}'], 'E:подключение adapters/nope.md для «code» не найдено'],
  ['codeStores: повтор id', ['config/sources.json', '{"taskStores":[{"id":"tasks","adapter":"jira","mcpServer":"pp-ai-jira"}],"codeStores":[{"id":"tasks","adapter":"bitbucket","mcpServer":"pp-ai-jira"}]}'], 'E:повтор id tasks'],
  ['codeStores: сервер не объявлен в настройках', ['config/sources.json', '{"codeStores":[{"id":"code","adapter":"jira","mcpServer":"nope-server"}]}'], 'W:не объявлен в .gigacode/settings.json'],
  ['taskStores: пустой id', ['config/sources.json', '{"taskStores":[{"adapter":"jira","mcpServer":"pp-ai-jira"}]}'], 'E:нет id'],
  ['taskStores: нет mcpServer', ['config/sources.json', '{"taskStores":[{"id":"tasks","adapter":"jira"}]}'], 'E:нет mcpServer'],

  // доступы: только ссылкой $secret
  ['токен открытым текстом', ['.gigacode/settings.json', '{"a":{"x-jira-token":"abc123"}}'], 'E:вместо ссылки $secret'],
  ['устаревшая заглушка', ['.gigacode/settings.json', '{"a":{"x-jira-token":"$secret:jira/x","u":"$PK_URL"}}'], 'E:устаревшая заглушка'],

  // результат запуска: одна папка, служебное — в .run/
  ['папка .runs в корне', 'mkdir:.runs', 'E:в корне не должно быть'],
  ['файл прямо в outputs/', ['outputs/x.md', 'x'], 'E:только папки запусков'],
  ['подпапка по видам', 'mkdir:outputs/tasks', 'E:подпапок по видам нет'],
  ['имя папки с пробелом', 'mkdir:outputs/2026-10-29 сводка', 'E:имя папки'],
  ['есть .run/, но нет итог.md', ['outputs/2026-10-29_без-итога/.run/state.json', '{"last_step":1,"last_step_name":"a"}'], 'E:нет итог.md'],
  ['проба без пометки', ['outputs/2026-10-29_проба-x/итог.md', '# x\nДата: 2026-10-29 10:00\nЧем закончилось: готово\n'], 'E:Пробный прогон'],
  ['данные доступа в итоге', ['outputs/2026-10-29_сводка-просрочки/итог.md', '# x\nДата: 2026-10-29 10:00\nЧем закончилось: готово\nBearer abc\n'], 'E:данные доступа'],
  ['итог называет .run/', ['outputs/2026-10-29_сводка-просрочки/итог.md', '# Сводка\nДата: 2026-10-29 15:30\nЧем закончилось: готово\nФайлы в этой папке:\n- сводка.md — сводка\n- .run/ — служебные файлы\n'], 'E:не упоминается .run/'],

  // история: у строки есть адрес папки запуска
  ['история без output', 'append:.history/runs.jsonl:{"ts":"1","process":"p"}\n', 'E:нет поля output'],
];

let passed = 0;
let failed = 0;

for (const [name, step, want] of BOUNDS) {
  try {
    if (Array.isArray(step)) w(step[0], step[1]);
    else if (typeof step === 'string' && step.startsWith('mkdir:')) fs.mkdirSync(path.join(root, step.slice(6)));
    else if (typeof step === 'string' && step.startsWith('append:')) {
      const [, rel, text] = step.match(/^append:([^:]+):([\s\S]*)$/);
      fs.appendFileSync(path.join(root, rel), text);
    }
    const res = run();
    const seen = res.issues.map((x) => `${x.level}: ${x.msg}`);
    let miss;
    if (want === 'clean') miss = res.errors === 0 && res.warnings === 0 ? null : seen.join('; ');
    else {
      const [level, frag] = want.split(':');
      miss = res.issues.some((x) => x.level === level && x.msg.includes(frag)) ? null : `ждали ${level} «${frag}»; получили: ${seen.join('; ') || 'ничего'}`;
    }
    if (miss) { failed++; console.log(`✗ ${name}\n    ${miss}`); } else { passed++; console.log(`✓ ${name}`); }
  } catch (e) {
    failed++;
    console.log(`✗ ${name}\n    проверка не выполнилась: ${e.message}`);
  } finally {
    // вернуть эталон: удалить добавленное проверкой и перезаписать изменённое
    for (const rel of ['processes', 'actions', 'adapters', 'context', '.gigacode', 'config', '.runs', 'outputs', '.history']) rm(rel);
    for (const [rel, text] of Object.entries(BASE)) w(rel, text);
  }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* держится процессом — не результат проверки */ }
console.log(`\nОк ${passed}, с границами не сошлось ${failed}.`);
process.exitCode = failed ? 1 : 0;

# Эталон: структура, ветки, настройки

Этот файл — эталон для разработчика. Если реализация расходится с ним, права
реализация только после явного решения владельца Process Kit; иначе исправляется
реализация.

## Было → стало (что устарело и больше не используется)

| Устарело | Стало |
|---|---|
| папки system/, team/, user/, файл process-kit.local.json | одна структура во всех ветках; уровни — ветки master, team-<команда>, my |
| переменные PROCESS_KIT_TEAM_DIR, PROCESS_KIT_USER_DIR, CLAUDE_PLUGIN_ROOT | не используются |
| gigacode-extension.json в корне, хук process-guard, CODEOWNERS | не используются; защита — правила веток Bitbucket и pre-push |
| токены в .gigacode/.env, подстановки $PK_*, заглушки ВАШ_ТОКЕН_* | ссылки $secret:<имя>/<ключ> в .gigacode/settings.json; значение в хранилище секретов GigaCode |
| папка результатов «Process Kit/» (с пробелом), служебная .runs/ | outputs/<дата>_<коротко>/, служебное — в её .run/ |
| подпапки outputs/tasks, setup, requests, .runs | одна папка на запуск, без подпапок по видам |
| новый процесс человека с префиксом команды | новый процесс человека — my-<имя> |
| team-<команда> и my с привязкой к origin/master | ветки создаются с --no-track |
| настройка и задача в одном прогоне и одном коммите | два этапа, два коммита |

## Ветки

| Ветка | От чего | Привязка (git branch -vv) | Куда отправляется |
|---|---|---|---|
| master | — | [origin/master] | только через PR из master-* |
| team-<команда> | origin/master, с --no-track | [origin/team-<команда>] после git push -u | только через PR |
| my | origin/team-<команда> или последний тег vX.Y.Z (без команды), с --no-track | нет привязки | никуда (pushRemote=no_push) или в remote mine |

Пример вывода у человека из команды test, личное только на компьютере:

```
$ git branch -vv
* my  3f2a1c9 Настройка Process Kit
$ git config branch.my.pushRemote
no_push
$ git remote -v
origin  https://bitbucket.example/scm/pk/process-kit.git (fetch)
origin  https://bitbucket.example/scm/pk/process-kit.git (push)
```

Если человек выбрал «ещё в вашем репозитории»: есть remote mine и
branch.my.pushRemote=mine.

Если человек создал команду urmepk и отправка прошла:

```
$ git branch -vv
  team-urmepk 8b11d02 [origin/team-urmepk] Новая команда: URMEPK
* my          5c0e7aa Настройка Process Kit
$ git ls-remote origin team-urmepk
8b11d02...  refs/heads/team-urmepk
```

## Дерево папки в ветке my после настройки и одного запуска

```
<корень>/
├── GIGACODE.md
├── README.md
├── TEAM.md                          только если есть команда (из командной ветки)
├── .gitignore
├── .gigacode/
│   ├── settings.json                ссылки $secret:…, значений доступа нет
│   ├── hooks/pre-push               исходник; копия ставится в .git/hooks/
│   └── skills/
│       ├── pp-ai-mentor/SKILL.md
│       ├── pp-ai-init/SKILL.md
│       ├── pp-ai-run-process/SKILL.md
│       ├── pp-ai-create-process/SKILL.md
│       ├── pp-ai-promote-changes-team/SKILL.md
│       └── pp-ai-promote-changes-master/SKILL.md
├── processes/                       общие, team-<команда>-*, my-*
├── actions/<имя>/ACTION.md          общие, team-<команда>-*, my-*
├── adapters/
├── context/                         общие, team-<команда>-*, my-*
├── config/
│   ├── sources.template.json
│   └── sources.json                 из командной ветки или из шаблона
├── tests/<имя>/                     fixture.json, fetch.json, report.md
├── tools/
│   ├── validate.js                  правила раскладки и структуры
│   ├── validate.selftest.js         самопроверка правил
│   ├── prepush.selftest.js             интеграционная проверка pre-push во временных репозиториях
│   ├── check-report.js              сверка наборов tests/<имя>/ и артефактов прогона
│   ├── check-layout.js              прежнее имя, вызывает validate.js
│   └── paths.js                     единственное место, где код вычисляет ROOT
├── docs/reference/                  эталоны: как должно быть (этот файл и соседние)
├── docs/templates/                  заготовки: что копируют, заменяя <…>
├── .history/                        в .gitignore
│   ├── runs.jsonl                   память помощника, не чистится
│   └── cache/                       можно удалить в любой момент
└── outputs/                         в .gitignore; см. outputs.md
```

В корне нет: system/, team/, user/, process-kit.local.json, «Process Kit/», .runs/,
runs/, trace.jsonl, run.md, .gigacode/.env. Отдельного каталога `config/fixtures/` тоже
нет: вымышленные данные лежат в наборе `tests/<имя>/fixture.json`.

## .gitignore (обязательные строки)

```
outputs/
.history/
# старые имена папок результатов, удалить в следующей версии
Process Kit/
.runs/
```

Плюс строки для файлов, которые GigaCode пишет в папку проекта сам (как уже есть).

## .gigacode/settings.json: доступ к системам

Структура MCP-серверов — как в текущем файле. Эталон касается только значения доступа:
везде, где нужен токен, стоит ссылка вида

```
$secret:pp-ai-jira/x-jira-token
```

Имя (pp-ai-jira — имя MCP-сервера в `mcpServers`) и ключ (x-jira-token) — это то, что
человек вводит в настройках GigaCode.
В поставляемом файле — ссылки на секреты. Историю исходного корпоративного
репозитория нужно проверять отдельно: восстановленный экспорт её не доказывает.

## config/sources.json (командная ветка, пример)

```json
{
  "schemaVersion": 1,
  "taskStores": [
    {
      "id": "tasks",
      "kind": "jira",
      "adapter": "adapters/jira.md",
      "displayName": "Jira",
      "mcpServer": "pp-ai-jira",
      "enabled": true,
      "baseUrl": "https://jira.example",
      "issueUrlTemplate": "{baseUrl}/browse/{key}",
      "projects": ["TEST"],
      "statusesExclude": ["TODO"],
      "capabilities": [],
      "limits": { "jqlMustIncludeIssueType": true, "getIssuesBatchMax": 20, "pageSize": 50 }
    }
  ],
  "codeStores": [
    {
      "id": "code",
      "kind": "bitbucket-server",
      "adapter": "adapters/bitbucket.md",
      "displayName": "Bitbucket",
      "mcpServer": "TODO",
      "enabled": true,
      "baseUrl": "https://bitbucket.example",
      "repositories": [{ "projectKey": "TEST", "slug": "test-repo", "defaultBranch": "master" }],
      "acceptTargetBranches": ["master"]
    }
  ],
  "defaults": { "process": "my-summary", "taskStore": "tasks", "codeStore": "code" }
}
```

Поля `mcpServer` — имя сервера из `.gigacode/settings.json` (в этом наборе объявлен
`pp-ai-jira`), операции используются только реально объявленные этим сервером; имя метода не угадывается. Токенов нет.
`TODO` допустим: настройка спросит его, если он понадобится.

## TEAM.md (командная ветка, пример)

```
# Тестовая команда
Код: test
Владельцы: Иванов И., Петрова А.
Как предложить изменение: PR в ветку team-test, проверяют владельцы.
```

## Коммиты настройки и нового процесса

Настройка и новый процесс — разные коммиты:

```
$ git log --oneline -3
a91d3e2 Новый процесс: my-stale-issues
5c0e7aa Настройка Process Kit
<тег или коммит командной ветки>
$ git show --stat 5c0e7aa
 config/sources.json | 2 +-
```

В коммите настройки — только config/sources.json и файлы my-*. Если менять было
нечего, коммита настройки нет — это нормально.

Записи в git без описания из refs/notes/ai — служебные заметки GigaCode, они не
отправляются и не мешают.

## Защита отправки (pre-push)

```
$ git push origin my
Личную копию нельзя отправить в общий репозиторий.
error: failed to push some refs ...
$ git push mine my          # если человек выбрал свой репозиторий
... успешно
$ git push origin refs/notes/ai
Служебные заметки GigaCode не отправляются в общий репозиторий.
error: failed to push some refs ...
```

Нигде в скиллах и README нет git push --all, --mirror, --tags в общий репозиторий и
отправки refs/notes.

## Уточнения проверенной реализации

- Защита устанавливается tools/install-hooks.js и сохраняет прежний hook; не
  копируйте новый файл поверх пользовательского. Hook проверяет ref-обновления,
  а серверные ограничения веток настраиваются отдельно владельцем.
- Манифест процесса содержит version, area, status, requires.actions/context и
  taskFields/codeFields для сетевых шагов; точные формы — docs/templates/process.md.
- Общий контекст — common.md, дополнительные файлы — requires.context; чужие
  командные контексты не загружаются.
- Физический артефакт — .run/<NN>-<шаг>.<ext>, логическое имя сопоставляется через
  state.artifacts. Продолжение требует identity и хеши; подробности — outputs.md.
- Конфиг нужен только сетевому live. Transform/demo не требуют адресов или секретов.
- Данные и запросы переиспользуются по точной ссылке, не обязаны повторять имя процесса.

## Атомарность действий

Один экшен — одна законченная операция с фиксированными входами и одним именованным
результатом. Пагинация/батчи и проверка собственного выхода остаются внутри операции.
Разные режимы с разными контрактами, чтение нескольких независимых источников,
бизнес-классификация и оформление отчёта разделяются в маршруте процесса.
Валидатор проверяет форму входов/единственного выхода и доступность артефактов;
смысловую границу операции проверяет автор/ревьюер.

SDD 1.1: run-query → task-records; read-code-evidence → code-evidence;
assess-sdd → report-data; compose-report → report-text;
prepare-mail-draft → mail-draft (необязательно). Контракты — artifacts.md.
Это явное изменение интерфейса: прежний run-query больше не возвращает report-data,
а send-mail переименован в prepare-mail-draft. Оба поставляемых процесса проверены;
собственные процессы со старыми ссылками нужно обновить перед запуском.

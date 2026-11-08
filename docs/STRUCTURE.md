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
├── .gitignore
├── .gigacode/
│   ├── settings.json                ссылки $secret:…, значений доступа нет
│   ├── hooks/pre-push               исходник; копия ставится в .git/hooks/
│   └── skills/
│       ├── pp-ai-mentor/SKILL.md   общение с человеком
│       ├── pp-ai-dispatch/SKILL.md выбор операций и исполнителя
│       ├── pp-ai-guide/SKILL.md
│       ├── pp-ai-init/SKILL.md     факты через setup-status; детали в references/
│       ├── pp-ai-diagnose/SKILL.md
│       ├── pp-ai-run-process/SKILL.md
│       ├── pp-ai-run-action/SKILL.md
│       ├── pp-ai-create-process/SKILL.md
│       ├── pp-ai-create-action/SKILL.md
│       ├── pp-ai-create-adapter/SKILL.md
│       ├── pp-ai-promote-changes-team/SKILL.md
│       └── pp-ai-promote-changes-master/SKILL.md
├── processes/<имя>/                 общие, team-<команда>-*, my-*
│   ├── PROCESS.md                  точка входа и маршрут
│   ├── queries/, rules/            запросы и предметные вычисления, если нужны
│   ├── contracts/, templates/      схемы данных и инструкции оформления, если нужны
│   └── renderers/                  формирование и проверка точного текста, если нужны
├── actions/<имя>/ACTION.md          общие, team-<команда>-*, my-*
├── adapters/<имя>/ADAPTER.md
├── context/<master|team|my>/<тема>/CONTEXT.md          уровни master/team/my, без префиксов у тем
├── config/
│   ├── master/                      общие безопасные defaults
│   ├── team/                        EXAMPLE.json и командный config.json
│   └── my/                          EXAMPLE.json и личный config.json
├── tools/
│   ├── kit.js                      единый CLI и каталог команд (--help / --json)
│   └── lib/                        внутренние модули, не отдельные инструменты
│       ├── actions/                поддержка функций-экшенов
│       ├── config/                 загрузка и контракты настроек
│       ├── contracts/              проверка результатов и JSON-схем
│       ├── core/                   пути и Markdown
│       ├── entities/               сущности, контекст и зависимости
│       ├── runtime/                журнал и история
│       ├── git/                    hooks и план переноса
│       └── validation/             структурный и предпусковой валидатор
├── tests/                          тестовый код, отдельно от рабочих инструментов
│   ├── actions/                    общие контракты и переиспользование экшенов
│   ├── processes/                  маршруты и sdd-stories-report/
│   ├── config/                     выбор подключений и перенос
│   ├── context/                    уровни контекста
│   ├── .gigacode/                  настройки агента
│   ├── outputs/                    имена результатов
│   └── tools/                      проверки инструментов
├── docs/                           общая архитектура и структура
│                                  инструкции и копируемые примеры — у владельцев сущностей
├── .history/                        в .gitignore
│   ├── runs.jsonl                   память помощника, не чистится
│   └── cache/                       можно удалить в любой момент
└── outputs/                         в .gitignore; см. docs/ARCHITECTURE.md
```

В корне нет: system/, team/, user/, process-kit.local.json, «Process Kit/», .runs/,
runs/, trace.jsonl, run.md, .gigacode/.env. Отдельного каталога `config/fixtures/` тоже
нет: вымышленные данные лежат в файле `processes/<имя>/fixture.json`.
У каждой фикстуры должно быть соответствующее определение `processes/<имя>/PROCESS.md`.
Ресурсы экшена хранятся в `actions/<имя>/`; запросы, правила и оформление конкретного
сценария — в `processes/<имя>/`. Создавай только используемые подпапки.
В tests/ хранится только тестовый код; рабочие данные остаются у процессов и экшенов. Общая fixtures/ не используется.

## .gitignore (обязательные строки)

```
outputs/
.history/
# старые имена папок результатов, удалить в следующей версии
Process Kit/
.runs/
```

Плюс строки для файлов, которые GigaCode пишет в папку проекта сам (как уже есть).

## Настройки клиента, подключений и команды

Поля, шаблоны и правила заполнения находятся рядом с владельцами:

- `GIGACODE.md` — правила агента, доступ и ссылки на секреты.
- `config/team/README.md` и `config/team/EXAMPLE.json` — подключения и значения по умолчанию.
- `config/team/EXAMPLE.json` — метаданные команды и общие подключения; `config/my/EXAMPLE.json` — личные настройки.

## Коммиты настройки и нового процесса

Настройка и новый процесс — разные коммиты:

```
$ git log --oneline -3
a91d3e2 Новый процесс: my-stale-issues
5c0e7aa Настройка Process Kit
<тег или коммит командной ветки>
$ git show --stat 5c0e7aa
 config/ | 2 +-
```

В коммите личной настройки — только config/my/config.json и файлы my-*. Если менять было
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

- Защита устанавливается tools/lib/git/install-hooks.js и сохраняет прежний hook; не
  копируйте новый файл поверх пользовательского. Hook проверяет ref-обновления,
  а серверные ограничения веток настраиваются отдельно владельцем.
- Requires процесса содержит actions/processes (имена) и context/config (уровни).
  Внутренние файлы разрешаются владельцами. tools/lib/entities/entities.js возвращает точки входа,
  каталоги тем и готовые подключения; снимок файлов не означает чтение всего в модель.
- Контексты master/team/my подключаются уровнями; аргументы выбирают темы внутри них.
  Чужие уровни/команды не загружаются, тексты не сливаются по приоритету.
- Физический артефакт — .run/<NN>-<шаг>.<ext>, логическое имя сопоставляется через
  state.artifacts. Продолжение требует identity и хеши; подробности — docs/ARCHITECTURE.md.
- Конфиг нужен только сетевому live. Transform/demo не требуют адресов или секретов.
- Данные и запросы переиспользуются по точной ссылке, не обязаны повторять имя процесса.

## Атомарность действий

Один экшен — одна законченная операция с фиксированными входами и одним именованным
результатом. Пагинация/батчи и проверка собственного выхода остаются внутри операции.
Границу функции задают операция, аргументы и результат. Число источников и вызовов
инструментов само по себе не требует новых экшенов. Процесс связывает нужные функции.
Валидатор проверяет форму входов/единственного выхода и доступность артефактов;
смысловую границу операции проверяет автор/ревьюер.

SDD 1.1: run-query → task-records; read-code-evidence → code-evidence;
evaluate-data с SDD-правилом процесса → report-data; compose-report → report-text;
prepare-mail-draft → mail-draft (необязательно). Контракт — processes/sdd-stories-report/reference.md.

Устройство CLI и группы внутренних модулей: docs/ARCHITECTURE.md.

Одиночная локальная утилита: kit.js action, без процесса-обёртки. Исполнитель процесса:
kit.js run next/execute либо begin/save для работы модели. Формирование и проверка
предметного отчёта принадлежат renderers/ процесса, общий compose-report переиспользуется.

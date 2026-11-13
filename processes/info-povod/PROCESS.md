---
name: info-povod
version: 1.2.0
area: отчётность
status: действует
publication: required
requires:
  actions: [run-query, evaluate-data, compose-report, check-methodology, classify-issuance]
  processes: []
  context: [master]
  config: [master, team, my]
title: Инфо-поводы Release Notes: неделя внедрений и планы на следующую
description: >
  Собирает релизы Release 2.0 периметра КЭ из двух инсталляций Jira, у каждого читает состав,
  отделяет содержательные задачи от технических и печатает один отчёт: таблица из двух колонок —
  текущие инфоповоды и планы на следующую неделю, построчно по КЭ. Перед чтением данных по
  желанию сверяется со страницей методики. Результат — файл прогона: текстовая форма и
  одностраничник в html.
example: собери инфо-поводы release notes на эту неделю
examples:
  - покажи инфо-поводы текущей недели и планы релизов на следующую
  - сверь процесс со сценарием release notes и собери отчёт за окно семь дней
branchRule: rules/branches.js
entry: methodology-gate
params:
  # Страница сценария Release Notes, по которой сверяется процесс: значение по умолчанию этой
  # поставки. Копия переопределяет её настройками или аргументом запуска — например когда у
  # команды своя страница сценария. Пустое значение вместе с ответом «сверяем» останавливает
  # прогон на предпусковой проверке, а не превращается в сверку по памяти или прошлому прогону.
  methodologyUrl: https://confluence.delta.sbrf.ru/pages/viewpage.action?pageId=19710117485
  methodologyName: сценарий Release Notes
  # Чем читается страница: операции чтения, выбор сервера по домену адреса и признаки
  # полноты описаны в этом адаптере. Копия может выбрать свой — например когда у команды
  # другая вики: тогда путь меняется здесь или аргументом запуска.
  methodologyAdapterFile: adapters/wiki-page/ADAPTER.md
  # Раздел методики: [где значение в процессе, метод сверки]. Список списков-объектов
  # парсер шапки не поддерживает.
  methodologyMap:
    Тип задачи — Release 2.0: [params.releaseType, list-diff]
    КЭ — поле КЭ в задаче: [taskStores[].taskFields.ke + taskStores[].modules, set-match]
    Домен sigma и delta, ключ проекта Jira: [taskStores[], rule-apply]
    Начало внедрения (план): [taskStores[].taskFields.startDate, set-match]
    Окно текущих поводов (за неделю назад): [params.lookBackDays, window-match]
    Окно планов (с понедельника следующей недели): [params.lookAheadDays, window-match]
    Исключить все технические Story: [params.classifyRules, rule-apply]
    Исключить задачи с типом Bug: [params.excludeIssueTypes, list-diff]
    Нет инфоповодов и релиз технический: [processes/info-povod/rules/info-povod.js, rule-apply]
    Форма отчёта — таблица из двух колонок: [processes/info-povod/templates/report.md, manual-note]
  methodologyAliases:
    releaseType: [Release 2.0, «Release 2.0», релиз 2.0]
    statusesExclude: [Cancelled, Отменено]
    technicalStory: [техническая Story, техническая история, tech]
  # Меняется только решением владельца процесса: инстанция задаёт коды полей, тип задачи и
  # исключения заданы методикой и подтверждены живой выборкой.
  methodologyReadOnly:
    - params.releaseType
    - params.excludeIssueTypes
    - taskStores[].taskFields
  # Файл решений уровня по этому процессу (снятые значения и разобранные расхождения). В общем
  # уровне его нет: решения относятся к конкретной копии. Без него сверка идёт честно и
  # показывает такие места расхождениями со сноской «не разобрано».
  methodologyNotes: ""
  # ask — помощник спрашивает ДО начала прогона и продолжает с явным yes или no.
  methodologyCheck: ask
  # Чтение внешних систем исполняет отдельный агент по одному на шаг; локальные вычисления
  # (assess, compose, render-html) остаются у координатора. Порядок — раздел «Шаг в
  # отдельном агенте» в .gigacode/skills/pp-ai-run-process/SKILL.md.
  agentSteps: [check-methodology, fetch-sigma, fetch-delta, classify-sigma, classify-delta]
  releaseType: Release 2.0
  # Имя статуса исключение подтверждено живым запросом 2026-11-07 в обеих инсталляциях;
  # «Отменено» не проверялось: несуществующее имя отбивает весь запрос ответом 400.
  statusesExclude: [Cancelled]
  excludeIssueTypes: [Bug]
  # Дату прогона считает один раз и передаёт в оба чтения и в расчёт координатор. Пустое
  # значение — прогон останавливается и спрашивает дату: окна по часам машины в разных шагах
  # разошлись бы.
  runDate: ""
  lookBackDays: 7
  lookAheadDays: 7
  # Домен — выбранное подключение, а не поле задачи: в обеих инсталляциях поле «Домен» не
  # используется. Метки нужны оговоркам и сводке, чтобы было видно, какое чтение что дало.
  instanceLabels:
    sigma: Jira (sigma): релизы Release 2.0
    delta: Jira (delta): релизы Release 2.0
  # Имена подключений задач задаёт конкретная копия — свои настройки или аргументы запуска,
  # поэтому в общем уровне они пустые. Подключение не угадывается и не подставляется соседним:
  # живой прогон без них останавливается на предпусковой проверке и называет недостающее.
  taskStoreSigma: ""
  taskStoreDelta: ""
  classifyRules: classify-issuance
  relatedDepth: 1
  commentsLimit: 20
  releaseQueryFile: processes/info-povod/queries/releases.md
  templateFile: processes/info-povod/templates/report.md
  rendererFile: processes/info-povod/renderers/report.js
  # Вторая форма того же отчёта — одностраничник в стиле примеров about/examples. Текст она
  # берёт у markdown-рендера, поэтому формы не могут разойтись по содержимому: способ выдачи —
  # про оболочку, а не про новые выводы. Файл страницы и есть результат прогона.
  htmlRendererFile: processes/info-povod/renderers/report-html.js
  resultContract: processes/info-povod/contracts/report-data.json
  # Заголовок отчёта: {currentFrom} {currentTo} {planFrom} {planTo} — дд.мм границ окон;
  # собирается правилом расчёта из тех же границ, что и выборка.
  pageTitleTemplate: Release Notes {currentFrom}–{planTo}
---

# Процесс: инфо-поводы Release Notes

Считает по сценарию Release Notes: какие релизы внедряются на этой неделе и что запланировано
на следующую. Отчёт нужен читателю КЭ — не список задач, а что изменилось в данных, методах и
ответах систем.

Процесс читает две инсталляции Jira двумя шагами одного и того же запроса с разными
подключениями (`taskStoreSigma`, `taskStoreDelta`). Общий `run-query` не меняется: различия
инсталляций — адрес, коды custom-полей и периметр КЭ — лежат в записях подключения, а не в
тексте запроса и не в этой шапке.

## Что важно знать при исполнении

- **Окна считаются от одной даты.** `runDate` вычисляется один раз в начале прогона и передаётся
  в оба чтения и в расчёт: `[runDate − lookBackDays ; runDate]` и
  `[runDate + 1 ; runDate + lookAheadDays]`. Правило шире буквы сценария («за неделю назад»,
  «с понедельника следующей недели»): окно задаётся параметрами, а не выводится молча по часам
  машины в каждом шаге.
- **Периметр КЭ — в настройках подключения, и он не делит инсталляции поровну.** Часть кодов
  встречается только в одной инсталляции, часть — в обеих; код, дающий релизы в обеих, лежит в
  обеих записях подключения. Проект фильтром не является: релизы периметра лежат в разных
  проектах, отбор делает поле «КЭ».
- **Код поля принадлежит записи подключения.** В запросе и в шапке номеров `customfield_*`
  нет; шаг читает `taskStores[].taskFields`. Переносить код из одной инсталляции в другую
  нельзя — рассинхрон виден как пустая выборка, а не как ошибка.
- **Состав релиза — связи `PartOf` («consists of»).** Прочие связи и упоминания в описании
  составом не считаются. Задачи типа `Bug` из состава исключаются. Не удалось прочитать связи —
  релиз остаётся в отчёте с пометкой «состав прочитан не полностью», а не с «нет инфоповодов».
- **Техничность определяет шаг классификации**, а не слово в заголовке: суждение по смыслу с
  дословной цитатой-основанием и сверка с файлом признаков. Класс не установлен — задача
  остаётся в отчёте с вопросом.
- **Релиз с несколькими КЭ попадает в группу каждого своего КЭ** (решение владельца от
  2026-11-07). Строк поэтому больше, чем релизов: в сводке оба числа называются раздельно, чтобы
  доли не складывались от строк.
- **Имя КЭ печатается дословно из значения поля задачи**, в настройках оно не дублируется.
  Поле «ИТ-услуга» в таблицу не попадает: группу определяет КЭ, а пустая услуга попадает
  в оговорки.
- **Поле «Домен» не используется**: домен — выбранное подключение. Его метки (`instanceLabels`)
  нужны оговоркам, чтобы отличить чтение sigma от delta.
- **Шаги исполняются последовательно по карточкам контроллера.** Отдельный контекст
  допускается для уже разрешённого шага из agentSteps: координатор сначала вызывает
  begin, затем передаёт ACTION.md и attemptId исполнителю. Исполнитель сохраняет
  результат через run save и возвращает краткую сводку. Будущие чтения и классификации
  до своего begin не запускаются. Порядок исполнения проверяется журналом.
- **Сверка с методикой** идёт до чтения данных и не обязательна: `methodologyCheck` = `ask` —
  помощник спрашивает до начала прогона; развилка `methodology-review` решает, продолжать ли.
  Координатор пересказывает человеку сводку агента целиком, молчание = остановка на сверке.
  Страница методики задаётся `methodologyUrl` — в поставке это страница сценария Release Notes,
  а копия переопределяет её своей. Сервер чтения выбирается по домену этого адреса (адаптер из
  `params.methodologyAdapterFile`), поэтому адрес и сервер — одно решение, а не два.
- **Внешних изменений нет.** Процесс только читает системы и пишет в папку прогона: ни
  публикации, ни правок в трекере. Результат — файл прогона, и выбирать способ выдачи некому:
  текстовая форма сохраняется как `отчёт-инфо-поводы.md`, а шаг `render-html` добавляет сверху
  одностраничник, который finish сохраняет как `отчёт-инфо-поводы.html`. Демо-прогон помечен
  «ДАННЫЕ ДЕМО» в обеих формах.
- **Форма страницы не меняет содержимого**: шаг `render-html` собирает одностраничник из текста
  той же markdown-формы, поэтому различие только в оболочке — правка формулировки в правиле или
  в форме видна сразу в обеих.

## Вход и завершение

Внешнего входа нет: периметр, окна, тип задачи и статусы — параметры процесса и настройки
подключений. Аргументами запуска передают то, что меняется: `runDate`, `lookBackDays`,
`lookAheadDays`, `methodologyCheck`, `methodologyUrl` и имена подключений задач
(`taskStoreSigma`, `taskStoreDelta`), при необходимости `pageTitleTemplate`.

Маршрут заканчивается одним из двух способов: файл страницы `отчёт-инфо-поводы.html` в папке
прогона (артефакт `report-page-html`) — штатный итог, или только текстовый отчёт прогона
(артефакт `report-page`) — если человек остановился после сверки с методикой и отчёта нет,
журнал сохраняет сводку сверки. Содержание отчёта даёт артефакт `report-page`: тот же текст
становится файлом для человека и основой формы страницы. `итог.md` журнал пишет сам; finish
побайтно копирует последний артефакт под именем `resultName`, поэтому расширение файла для
человека задаёт именно оно.
Демоданные: `processes/info-povod/fixture.json` (передать как `dataFile` только для demo;
в демо оба чтения получают один набор вымышленных релизов — условие остаётся в оговорках).

## Шаги

### methodology-gate

- decision: code

- branch:
  - когда: `params.methodologyCheck` = `yes` → goto: check-methodology
  - иначе (default): goto: fetch-sigma

### check-methodology

- действие: check-methodology
- параметры:
  - `methodologyUrl: {params.methodologyUrl}`
  - `methodologyName: {params.methodologyName}`
  - `methodologyAdapterFile: {params.methodologyAdapterFile}`
  - `parameters: {"methodologyMap":{params.methodologyMap},"methodologyAliases":{params.methodologyAliases},"methodologyReadOnly":{params.methodologyReadOnly},"methodologyNotes":"{params.methodologyNotes}"}`
- артефакт: methodology-check
- следующий: methodology-review

### methodology-review

- decision: user

Развилку решает человек. Координатор показывает ему сводку сверки целиком — сколько разделов
сопоставлено, что разошлось и в какую сторону, что не проверено, — полный путь артефакта
`methodology-check` и список вопросов; затем одним сообщением спрашивает, продолжать ли.
Ответ агента человеку не виден, поэтому пересказ обязателен. Продолжение выбирается отдельным choose для fetch-sigma с approval receipt доверенного
хоста и пояснением decision. Обычная реплика «да» или confirmed=true не доказывают
происхождение согласия. Пока интеграция не предоставляет verifyApproval, продолжение
заблокировано; можно завершить прогон на сводке через терминальную цель end. Молчание означает остановку на
сверке: finish сохранит её сводку, а не числа, которые ещё не на чем считать.

- branch:
  - когда: человек получил сводку и подтвердил продолжение → goto: fetch-sigma
  - иначе (default): goto: end

### fetch-sigma

Для объёмной выдачи допускается отдельный контекст только после begin этого шага.
Исполнитель получает сохранённый attemptId и фиксирует результат через run save;
самостоятельно выбирать или начинать следующий шаг он не может.
- действие: run-query
- параметры:
  - `queryFile: {params.releaseQueryFile}`
  - `taskStore: {params.taskStoreSigma}`
  - `parameters: {"instanceLabel":"sigma","releaseType":"{params.releaseType}","statusesExclude":"{params.statusesExclude}","runDate":"{params.runDate}","lookBackDays":"{params.lookBackDays}","lookAheadDays":"{params.lookAheadDays}"}`
- артефакт: task-records-sigma
- следующий: fetch-delta

### fetch-delta

Чтение второй инсталляции начинается после сохранения fetch-sigma, когда контроллер
вернул этот шаг. Подключение берётся из его фактических параметров.
- действие: run-query
- параметры:
  - `queryFile: {params.releaseQueryFile}`
  - `taskStore: {params.taskStoreDelta}`
  - `parameters: {"instanceLabel":"delta","releaseType":"{params.releaseType}","statusesExclude":"{params.statusesExclude}","runDate":"{params.runDate}","lookBackDays":"{params.lookBackDays}","lookAheadDays":"{params.lookAheadDays}"}`
- артефакт: task-records-delta
- следующий: classify-sigma

### classify-sigma

Классификация первой выборки начинается только после begin этого шага. Отдельный
контекст получает одну сохранённую выборку и сохраняет результат с текущим attemptId.
- действие: classify-issuance
- параметры:
  - `taskStore: {params.taskStoreSigma}`
  - `records: {task-records-sigma}`
  - `rules: {params.classifyRules}`
  - `relatedDepth: {params.relatedDepth}`
  - `commentsLimit: {params.commentsLimit}`
- артефакт: classified-sigma
- следующий: classify-delta

### classify-delta

Классификация второй выборки начинается после сохранения classify-sigma, по карточке
контроллера. В журнал одновременно пишет только текущий исполнитель.
- действие: classify-issuance
- параметры:
  - `taskStore: {params.taskStoreDelta}`
  - `records: {task-records-delta}`
  - `rules: {params.classifyRules}`
  - `relatedDepth: {params.relatedDepth}`
  - `commentsLimit: {params.commentsLimit}`
- артефакт: classified-delta
- следующий: assess

### assess

Локальное вычисление: оба чтения уже на диске, сети здесь нет — шаг остаётся у координатора и
исполняется штатным `run execute`.

- действие: evaluate-data
- параметры:
  - `inputs: {"releasesSigma":"{task-records-sigma}","releasesDelta":"{task-records-delta}","classifiedSigma":"{classified-sigma}","classifiedDelta":"{classified-delta}"}`
  - `rulesFile: processes/info-povod/rules/info-povod.js`
  - `parameters: {"runDate":"{params.runDate}","lookBackDays":"{params.lookBackDays}","lookAheadDays":"{params.lookAheadDays}","releaseType":"{params.releaseType}","excludeIssueTypes":"{params.excludeIssueTypes}","pageTitleTemplate":"{params.pageTitleTemplate}","methodologyCheck":"{params.methodologyCheck}"}`
  - `resultContract: {params.resultContract}`
- артефакт: report-data
- следующий: compose

### compose

- действие: compose-report
- параметры:
  - `data: {report-data}`
  - `templateFile: {params.templateFile}`
  - `rendererFile: {params.rendererFile}`
- артефакт: report-page
- следующий: render-html

### render-html

Внешних вызовов нет: тот же текст собирается одностраничником по тем же данным, поэтому формы не
расходятся — правка формулировки в правиле расчёта или в markdown-форме видна сразу в обеих.
Отличие только в оболочке: колонок ровно две — «Текущие инфоповоды» и «Планы на следующую
неделю», имя ИТ-услуги жирной первой строкой каждой ячейки, КЭ строкой ниже, релиз жирной
ссылкой, задачи строками с «•» — то есть состав таблицы тот же, что в текстовой форме. Переносы
ячейки становятся абзацами, ссылки markdown — ссылками.

- действие: compose-report
- параметры:
  - `data: {report-data}`
  - `templateFile: {params.templateFile}`
  - `rendererFile: {params.htmlRendererFile}`
- артефакт: report-page-html
- следующий: end

### end

Терминальный шаг. Finish побайтно копирует последний артефакт, поэтому имя результата зависит от
того, дошёл ли маршрут до формы страницы; журнал хранит артефакт шага под расширением текстового
порта (`.md`), а расширение файла для человека задаёт `resultName`:

- штатный итог: последний артефакт — `report-page-html`,
  `resultName: "отчёт-инфо-поводы.html"`; текстовую форму при надобности отдают командой журнала
  `run publish {"output":"<папка прогона>","artifact":"report-page","name":"отчёт-инфо-поводы.md"}`;
  в папке прогона кроме них лежит `итог.md` с коротким итогом и списком файлов;
- остановка на `methodology-review` — отчёта нет: последний артефакт — сводка сверки, finish
  сохраняет её как `сверка-с-методикой.json`, а в `итог.md` перечисляются расхождения и
  вопросы без решения.

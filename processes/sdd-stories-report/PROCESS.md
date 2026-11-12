---
name: sdd-stories-report
version: 1.2.0
area: отчётность
status: действует
publication: required
requires:
  actions: [run-query, read-code-evidence, evaluate-data, compose-report, prepare-mail-draft]
  context: [master]
  processes: []
  config: [master, team, my]
title: Доля стори, выполненных по SDD
description: >
  Считает долю историй проекта, выполненных по SDD: начало работы в заданном окне,
  текущий статус от тестирования и далее, отбор по КЭ команды. SDD подтверждается
  меткой или изменениями спецификаций в принятом запросе на изменения.
example: посчитай долю стори, выполненных по SDD, с 01.01.2026
examples:
  - посчитай долю историй по SDD с начала года
  - покажи отчёт SDD и подготовь письмо по историям без SDD
branchRule: rules/branches.js
entry: fetch
params:
  wantsMail: false
  startDate: 01.01.2026
  endDate: today
  label: SDD
  watchPath: openspec/changes
  keField: customfield_18300
  statusesAccepted: IFT, Ready for UAT, Done, Resolved
  taskQueryFile: processes/sdd-stories-report/queries/stories.md
  codeQueryFile: processes/sdd-stories-report/queries/code-evidence.md
  recipients: ""
  templateFile: processes/sdd-stories-report/templates/report.md
---

# Процесс: отчёт SDD по стори

Делит стори проекта из координат подключения на две группы и считает процент. В отбор попадают только стори,
у которых в поле «КЭ» есть одна из КЭ отбора — их список лежит в координатах подключения
к системе задач (`taskStores[].modules`), здесь он не повторяется. Остальные стори
в расчёт не идут. Стори выполнена **по SDD**, если есть метка `SDD` **или** подтверждённый принятый PR с изменениями
под переданным watchPath (по умолчанию `openspec/changes`); **без SDD** — только если нет ни того, ни другого.

## Что важно знать при исполнении

- Отбор строится от историй: шаг `fetch` читает историю статусов каждой стори; `read-code` читает код,
  `assess` сопоставляет свидетельства и рассчитывает показатели без сети.
- Процент считается только по прошедшим отбор стори: стори, которые не удалось проверить,
  в знаменатель не входят и перечисляются отдельно.
- Проект, сервер подключения и адреса систем в этом файле не повторяются: они берутся из
  координат подключений по `defaults.taskStore` и `defaults.codeStore`.
- Письмо — необязательный шаг: маршрут заканчивается после отчёта, если человек не просил
  письмо.

## Вход и завершение

Период, label, watchPath, keField и statusesAccepted — аргументы этого процесса.
statusesAccepted задаёт статусы «тестирование и далее»: стори в другом текущем статусе
из выборки выпадает. taskQueryFile и codeQueryFile задают независимые запросы,
templateFile — общий отчёт; параметры конкретных функций передаются каждым шагом явно.
Подключения выбираются по переданным id либо сохранённым defaults. При отсутствии необходимых значений — остановка и уточнение.

Запрос на письмо передаётся явным wantsMail: true; иначе остаётся false. Код проверяет
число историй без SDD и выбирает переход. Если письмо запрошено, recipients может явно задать строку получателей. Иначе берутся
только ответственные из группы без SDD; пустой результат требует уточнения, адреса не
выдумываются. Для тела письма готовится отдельный набор и отдельный текст; общий отчёт
не отправляется адресатам вместо него. Отправки нет, результат — только черновик.

Без письма finish сохраняет sdd-report как отчёт.md. С письмом finish сохраняет
mail-draft как письмо.md, а отчёт sdd-report дополнительно публикуется рядом как
отчёт.md; сам отчёт при этом остаётся артефактом compose в .run/.


## Шаги

### fetch

- действие: run-query
- параметры:
  - `queryFile: {params.taskQueryFile}`
  - `parameters: {"startDate":"{params.startDate}","endDate":"{params.endDate}","keField":"{params.keField}","statusesAccepted":"{params.statusesAccepted}"}`
- артефакт: task-records
- следующий: read-code

### read-code

- действие: read-code-evidence
- параметры:
  - `queryFile: {params.codeQueryFile}`
  - `parameters: {"watchPath":"{params.watchPath}"}`
- артефакт: code-evidence
- следующий: assess

### assess

- действие: evaluate-data
- параметры:
  - `inputs: {"tasks":"{task-records}","code":"{code-evidence}"}`
  - `rulesFile: processes/sdd-stories-report/rules/sdd.js`
  - `parameters: {"label":"{params.label}","watchPath":"{params.watchPath}","statusesAccepted":"{params.statusesAccepted}"}`
  - `resultContract: processes/sdd-stories-report/contracts/report-data.json`
- артефакт: report-data
- следующий: compose

### compose

- действие: compose-report
- параметры:
  - `data: {report-data}`
  - `templateFile: {params.templateFile}`
  - `rendererFile: processes/sdd-stories-report/renderers/report.js`
- артефакт: sdd-report
- следующий: gate

### gate

- decision: code

- branch:
  - когда: человек попросил письмо, И в артефакте `report-data` есть стори в группе «без SDD» → goto: prepare-mail-data
  - иначе (default): goto: end

### prepare-mail-data

- действие: evaluate-data
- параметры:
  - `inputs: {"report":"{report-data}"}`
  - `rulesFile: processes/sdd-stories-report/rules/mail.js`
  - `parameters: {"recipients":"{params.recipients}"}`
  - `resultContract: processes/sdd-stories-report/contracts/mail-data.json`
- артефакт: mail-data
- следующий: compose-mail

### compose-mail

- действие: compose-report
- параметры:
  - `data: {mail-data}`
  - `templateFile: processes/sdd-stories-report/templates/mail.md`
  - `rendererFile: processes/sdd-stories-report/renderers/mail.js`
- артефакт: report-text
- следующий: notify

### notify

- действие: prepare-mail-draft
- параметры:
  - `to: {mail-data} → поле to`
  - `subject: {mail-data} → поле subject`
- артефакт: mail-draft
- следующий: end

### end

Терминальный шаг: маршрут закончен. Если письмо не запрошено, результат — sdd-report. Если запрошено, последний шаг
возвращает mail-draft: в поставке нет почтового подключения, ничего не отправляется.
Что сохранить человеку: без письма — отчёт.md из sdd-report; с письмом — письмо.md из
mail-draft, затем отчёт.md из sdd-report.
Демоданные: `processes/sdd-stories-report/fixture.json` (передать как `dataFile` только для demo).

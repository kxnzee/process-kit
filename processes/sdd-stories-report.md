---
name: sdd-stories-report
version: 1.1.0
area: отчётность
status: действует
requires:
  actions: [run-query, read-code-evidence, assess-sdd, compose-report, prepare-mail-draft]
  context: [common.md, writing-style.md]
  taskFields: [baseUrl, issueUrlTemplate, projects, modules[].name, modules[].code]
  codeFields: [baseUrl, repositories[].projectKey, repositories[].slug, repositories[].defaultBranch, acceptTargetBranches]
title: Доля стори, выполненных по SDD
description: >
  Считает долю историй проекта, выполненных по SDD: начало работы в заданном окне,
  текущий статус от тестирования и далее, отбор по КЭ команды. SDD подтверждается
  меткой или изменениями спецификаций в принятом запросе на изменения.
example: посчитай долю стори, выполненных по SDD, с 01.01.2026
examples:
  - посчитай долю историй по SDD с начала года
  - покажи отчёт SDD и подготовь письмо по историям без SDD
entry: fetch
params:
  startDate: 01.01.2026
  endDate: today
  label: SDD
  watchPath: openspec/changes
  keField: customfield_18300
  query: sdd-stories-report
  template: report
---

# Процесс: отчёт SDD по стори

Делит стори проекта из координат подключения на две группы и считает процент. В отбор попадают только стори,
у которых в поле «КЭ» есть одна из КЭ отбора — их список лежит в координатах подключения
к системе задач (`taskStores[].modules`), здесь он не повторяется. Остальные стори
в расчёт не идут. Стори выполнена **по SDD**, если есть метка `SDD` **или** коммит с правками
файлов в папке `openspec/changes`; **без SDD** — только если нет ни того, ни другого.

## Что важно знать при исполнении

- Отбор строится от историй: шаг `fetch` читает историю статусов каждой стори; `read-code` читает код,
  `assess` сопоставляет свидетельства и рассчитывает показатели без сети.
- Процент считается только по прошедшим отбор стори: стори, которые не удалось проверить,
  в знаменатель не входят и перечисляются отдельно.
- Проект, сервер подключения и адреса систем в этом файле не повторяются: они берутся из
  координат подключений по `defaults.taskStore` и `defaults.codeStore`.
- Письмо — необязательный шаг: маршрут заканчивается после отчёта, если человек не просил
  письмо.

## Формат файла

- Шапка — `name`, `title`, `description`, `example`, `entry`, `params` процесса.
- Раздел «Шаги»: по подразделу на шаг, порядок задаётся `следующий:` и ветками.

## Шаги

### fetch

- действие: run-query
- параметры: `query: sdd-stories-report`
- артефакт: task-records
- следующий: read-code

### read-code

- действие: read-code-evidence
- параметры: `query: sdd-evidence`
- артефакт: code-evidence
- следующий: assess

### assess

- действие: assess-sdd
- параметры: `rule: sdd`
- артефакт: report-data
- следующий: compose

### compose

- действие: compose-report
- параметры: `template: report`
- артефакт: report-text
- следующий: gate

### gate

- branch:
  - когда: человек попросил письмо, И в артефакте `report-data` есть стори в группе «без SDD» → goto: notify
  - иначе (default): goto: end

### notify

- действие: prepare-mail-draft
- параметры:
  - `to: {report-data} → plainStories[] → поле responsible каждой задачи: имена через «; », повторы убрать, «—» пропустить; если не осталось ни одного — остановиться и спросить у человека`
  - `subject: SDD с {params.startDate}: стори, выполненные без SDD`
- артефакт: mail-draft
- следующий: end

### end

Терминальный шаг: маршрут закончен. Если письмо не запрошено, результат — report-text. Если запрошено, последний шаг
возвращает mail-draft: в поставке нет почтового подключения, ничего не отправляется.
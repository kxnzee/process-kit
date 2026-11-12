---
name: example
version: 1.0.0
area: примеры
status: действует
publication: required
title: Копируемый пример подготовки письма
description: Учебный процесс для копирования; редактирует переданный текст и готовит черновик письма по явным получателям и теме.
example: пример процесса
examples:
  - покажи структуру процесса
  - создай процесс по примеру
entry: edit
requires:
  actions: [edit-text, prepare-mail-draft]
  processes: []
  context: [master]
  config: []
params:
  to: TODO
  subject: TODO
  режим: коротко
  styleFile: context/master/writing-style/CONTEXT.md
---

# Пример процесса

При создании своего скопируй всю папку и выполни README.md. Это учебная заготовка,
не отдельная пользовательская возможность. Для пробного выполнения передай текст
как start.inputText; используй возвращённый params.input. Выход: отредактированный
текст без изменения фактов и черновик письма. До start уточни текст, получателей
и тему; передай to и subject явными параметрами вместо TODO. Отправки нет.

## Шаги

### edit

- действие: edit-text
- параметры:
  - `text: {params.input}`
  - `режим: {params.режим}`
  - `styleFile: {params.styleFile}`
- артефакт: report-text
- следующий: draft

### draft

- действие: prepare-mail-draft
- параметры:
  - `to: {params.to}`
  - `subject: {params.subject}`
- артефакт: mail-draft
- следующий: end

### end

Выполни finish с resultName=письмо.md после сохранения результата draft.

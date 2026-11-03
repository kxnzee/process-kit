---
name: read-code-evidence
description: Читает свидетельства изменений кода для уже выбранных задач
kind: source
adapter: из config/sources.json: codeStores[].adapter
consumes:
  artifacts: [task-records]
  params: [query, codeStore, dataFile, watchPath]
produces:
  code-evidence: PR и полнота проверки кода по ключам выбранных задач
---

# Прочитать свидетельства кода

1. Возьми ключи из task-records и точный queries/<query>.md. Прочитай только
   адаптер выбранного codeStore; в систему задач не обращайся, отбор не повторяй.
2. Выполни объявленное чтение кода с пагинацией/батчами. Сохрани связи ключей с PR,
   state и changedPaths, свидетельства commit и полноту чтения по каждому ключу.
3. Неполное чтение не означает отсутствие PR/изменений. Пометь prsComplete=false
   и причину. Отсутствующий сервер не подменяй другим.
4. В demo используй только раздел кода той же фикстуры через splitFixture().code;
   ограничь его ключами task-records. Сеть и чтение expected запрещены.
5. Сохрани selectionId входного task-records без изменения. Верни code-evidence. Не меняй task-records, не классифицируй SDD, не вычисляй
   бизнес-счётчики и не готовь текст отчёта.

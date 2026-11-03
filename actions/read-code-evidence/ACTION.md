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
4. В demo загрузи task-records именно из файла предыдущего save и вызови
   evidenceFromFixture(fixture, savedTasks) из tools/sdd-data.js. Функция берёт
   его selectionId и ограничивает код выбранными ключами. Не получай code через
   новый независимый splitFixture: метаданные сохранённого отбора могли измениться. Сеть и чтение expected запрещены.
5. Сохрани selectionId входного task-records без изменения. Верни code-evidence. Не меняй task-records, не классифицируй SDD, не вычисляй
   бизнес-счётчики и не готовь текст отчёта.


Пример формы результата: docs/templates/artifacts/code-evidence.json. Прочитай его при
создании файла; значения возьми из текущих входов, не копируй пример и не запускай тесты.

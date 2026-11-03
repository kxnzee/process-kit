# Контракт данных SDD

Расчёт assess-sdd и оформление compose-report опираются на этот контракт.
Источники отдают свидетельства, не читают шаблон и не рассчитывают группы.
report-data — JSON-объект:
- meta: reportTitle, generatedAt, window, label, watchPath, statusesAccepted,
  taskStoreName, codeStoreName, queryFile, demo;
- sddStories[], plainStories[]: key, summary, url, status, inProgressAt, assignee,
  responsible. У SDD дополнительно via и commit (допустимо «—»);
- excluded[]: key, reason; unverified[]: key, summary, reason;
- counters: storyCount, sddCount, plainCount, labelCount, commitCount, sddShare,
  unverifiedCount. Статистика вызовов pagesRead/prCount — если действительно измерена.

Ключи внутри группы уникальны; группы взаимно исключаются. storyCount = sddCount +
plainCount, unverifiedCount — отдельно. sddShare = 100*sddCount/storyCount с одним
знаком после запятой, при нуле — 0. Метка и PR могут пересекаться; их суммы не равны sddCount.
Нельзя считать отсутствие ответа доказательством отсутствия PR или метки.
Положительная метка достаточна для SDD; непроверенный второй признак явно отмечается.
Для plain оба отрицательных признака должны быть подтверждены полностью.

fixture.json — вымышленные уже отобранные stories плюс excluded/unverified и query.
labels и prs[].changedPaths позволяют независимо вычислить группировку. fetch.json
содержит ожидаемые ключи/счётчики, не является результатом источника или расчёта. report.md —
ожидаемые факты текста; формулировки могут отличаться, числа и ключи — нет.
check-report.js сравнивает реальные артефакты по state.artifacts; поддержка старых
report-data.json/report-text.md оставлена только для чтения прежних прогонов.
Положительные проверки на подготовленных данных не доказывают качество отбора живой Jira.

## Атомарные входы SDD, версия процесса 1.1

- task-records: meta, stories[], excluded[], unverified[], selectionId. Stories — уже
  отобранные задачи с key/summary/url/status/inProgressAt/assignee/responsible/labels.
  Без prs, prsComplete, commit, via и бизнес-счётчиков. Неизвестные labels не равны [].
  selectionId фиксируется run-journal save по окончательному содержимому
  отбора; метаданные после сохранения не изменяются. В demo код формируется
  evidenceFromFixture(fixture, savedTasks) по сохранённому входу.
- code-evidence: тот же selectionId, records[] с уникальными key из task-records,
  prs[] (state, changedPaths и подтверждённые id/url), prsComplete, commit при наличии.
  Нет записи/нет списка/неполная пагинация/отсутствующий prsComplete — неизвестность,
  не отрицательный ответ. Для отрицательного вывода нужен явный prsComplete=true.
  Stories, excluded и unverified должны быть уникальны внутри и не пересекаться.
- Только assess-sdd объединяет свидетельства по key и возвращает report-data по
  контракту выше. Счётчики рассчитываются один раз; compose-report отображает их.

splitFixture разделяет старую общую вымышленную фикстуру на два независимых входа
чтения, не классифицируя их. assessSdd — чистая проверка и расчёт для demo и live;
live не получает отметку demo автоматически. normalizeFixture оставлен как обёртка
для прежних тестов и эталонов. fetch.json теперь эталон шага assess; имя сохранено
для совместимости check-report.js. Не использовать его как результат чтения.

Обязательные selectors query/template/rule, объявленные в consumes.params действия,
должны быть разрешены до исполнения через validate.js --process. Отсутствующее, null
или пустое значение останавливает проверку; соседний файл автоматически не выбирается.

Демо-варианты запроса поддерживаются splitFixture(fixture, selectedQuery): имя
передаётся явно и должно совпадать с fixture.query. Имя по умолчанию оставлено для
старого общего запроса. При личном/командном query обновите fixture.query и query
в fetch.json; check-report сверяет выбранное имя по пути query эталонного набора.
В task-records.meta.query сохраняется имя исходного запроса. Чтение кода использует
его для той же фикстуры, а не имя собственного запроса sdd-evidence.

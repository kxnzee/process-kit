# Контракт данных SDD

Расчёт evaluate-data по rules/sdd.js и оформление compose-report опираются на этот контракт.
Источники отдают свидетельства, не читают шаблон и не рассчитывают группы.
report-data — JSON-объект:
- meta: reportTitle, generatedAt, window, label, watchPath, statusesAccepted,
  taskStoreName, codeStoreName, queryFile, demo. statusesAccepted приходит из параметра
  процесса и пишется в meta правилом; собственного значения процесса в расчёте нет;
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

`processes/sdd-stories-report/fixture.json` хранит вымышленные входы: query — точный
queryFile процесса, result — записи задач, codeEvidence — факты кода. Готового расчёта нет.
Положительные проверки на подготовленных данных не доказывают качество отбора живой Jira.

## Атомарные входы SDD, версия процесса 1.1

- task-records: meta, records[], excluded[], unverified[], selectionId. Records — уже
  отобранные задачи с key/summary/url/status/inProgressAt/assignee/responsible/labels.
  Без prs, prsComplete, commit, via и бизнес-счётчиков. Неизвестные labels не равны [].
  statusesAccepted — эффективный аргумент запроса: передан процессом, сохранён в meta.
  selectionId фиксируется run-journal save по окончательному содержимому
  отбора; метаданные после сохранения не изменяются. В demo код формируется
  evidenceFromFixture(fixture, savedTasks, codeQueryFile) из tools/lib/actions/code-data.js по сохранённому входу.
- code-evidence: тот же selectionId, queryFile запроса к коду, records[] с уникальными key из task-records,
  prs[] (state, changedPaths и подтверждённые id/url), prsComplete, commit при наличии.
  Нет записи/нет списка/неполная пагинация/отсутствующий prsComplete — неизвестность,
  не отрицательный ответ. Для отрицательного вывода нужен явный prsComplete=true.
  Stories, excluded и unverified должны быть уникальны внутри и не пересекаться.
- Правило процесса rules/sdd.js объединяет свидетельства по key и возвращает report-data по
  контракту выше. Счётчики рассчитываются один раз; compose-report отображает их.

queryFixture из tools/lib/actions/query-data.js читает только общий result. splitFixture из
SDD-модуля объединяет этот вход с codeEvidence для проверки расчёта; run-query
этот модуль не использует. Специфические поля records проверяет assessSdd.

Обязательные selectors query/template/rule, объявленные в consumes.params действия,
должны быть разрешены до исполнения через validate.js --process. Отсутствующее, null
или пустое значение останавливает проверку; соседний файл автоматически не выбирается.

queryFile задаётся процессом и сохраняется в task-records.meta.queryFile.
Чтение кода использует сохранённый набор records и selectionId. При изменении
метаданных queryFixture вычисляет новый идентификатор до передачи свидетельств кода.

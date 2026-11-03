# Контракт данных SDD

Источник run-query не читает шаблон следующего шага. Оба опираются на этот контракт.
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
содержит ожидаемые ключи/счётчики, не является результатом источника. report.md —
ожидаемые факты текста; формулировки могут отличаться, числа и ключи — нет.
check-report.js сравнивает реальные артефакты по state.artifacts; поддержка старых
report-data.json/report-text.md оставлена только для чтения прежних прогонов.
Положительные проверки на подготовленных данных не доказывают качество отбора живой Jira.

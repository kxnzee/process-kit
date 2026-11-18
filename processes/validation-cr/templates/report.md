# Отчёт валидации CR — {{meta.runDate}}

<!-- Форма отчёта: переменные заполняются из report-data; новых фактов не добавлять.
     Счётчики печатаются из counters без пересчёта; пустой раздел — «нет записей».
     Пропущенные проверки печатаются в оговорках как «не выполнялась». -->

Сводка: обработано {{counters.total}}, {{meta.okLabel}} — {{counters.okCount}}, {{meta.errorLabel}} — {{counters.errorCount}}, попыток вмешательства — {{counters.securityViolationCount}}, нечитаемых — {{counters.unreadableCount}}.

## Результаты по CR

| CR | Исход |
|---|---|
<!-- для каждого items[]: -->
| [{{item.key}}]({{item.url}}) {{item.summary}} | {{item.verdict}} |

## Причины по CR

<!-- для каждого items[] с хотя бы одной причиной: -->
### [{{item.key}}]({{item.url}})

<!-- каждая причина отдельной строкой: -->
- Бизнес-поле {{field.label}} ({{field.fieldId}}): {{field.requirement}} — {{field.status}}; значение: {{field.value}}.
- Правило поля «{{rule.field}}» {{rule.ruleId}}: {{rule.status}} — {{rule.note}}.
- Попытка вмешательства: {{finding.category}} — «{{finding.quote}}» ({{finding.place}}).

## Проверить не удалось

<!-- для каждого unverified[]: -->
- [{{row.key}}]({{row.url}}): {{row.reason}}.

## Исключены

<!-- для каждого excluded[]: -->
- [{{row.key}}]({{row.url}}): {{row.reason}}.

## Оговорки

<!-- для каждого notes[]: -->
- {{note}}.

Авторитетная форма: renderers/report.js. Данные: meta.*, counters.* и массивы историй. При наличии rendererFile используйте штатный execute; этот файл объясняет структуру и не является программой подстановки.

<!--
Словарь данных для подстановки (больше ничего агент в отчёт не выдумывает):

Мета:  {{meta.reportTitle}} {{meta.generatedAt}} {{meta.window}} {{meta.label}} {{meta.statusesAccepted}}
       {{meta.taskStoreName}} {{meta.codeStoreName}} {{meta.queryFile}} {{params.templateFile}}
Счётчики: {{counters.storyCount}} {{counters.sddCount}} {{counters.plainCount}} {{counters.labelCount}} {{counters.commitCount}} {{counters.sddShare}} {{counters.unverifiedCount}}
Цикл:  {{#each …}} … {{/each}}   Условие: {{#if …}} … {{/if}}

sddStories[]  — выполнены по SDD: key, summary, url, status, inProgressAt,
                via (метка | PR с артефактами | метка и PR), commit, assignee, responsible
plainStories[]— выполнены без SDD: key, summary, url, status, inProgressAt, assignee, responsible
unverified[]  — проверить не удалось: key, summary, reason

responsible — то, что пишется в колонке «Ответственный» и годится для адреса письма:
              assignee; если пусто — «—».

Пустой раздел выводить словами «нет записей», заголовки разделов не удалять.
Ссылки в ячейках — только ключом задачи плоским текстом; адреса собрать списком под таблицей.
-->

# {{meta.reportTitle}}

Дата: {{meta.generatedAt}} · Окно: {{meta.window}} · Метка: `{{meta.label}}` · Засчитаны статусы: {{meta.statusesAccepted}}
Задачи: {{meta.taskStoreName}} · Код: {{meta.codeStoreName}}
Запрос: `{{meta.queryFile}}` · Шаблон: `{{params.templateFile}}`

## Итог

| Показатель | Значение |
|---|---|
| Стори в выборке (прошли отбор) | {{counters.storyCount}} |
| Выполнено по SDD | {{counters.sddCount}} — из них с меткой {{counters.labelCount}}, через PR с артефактами {{counters.commitCount}} |
| Выполнено без SDD | {{counters.plainCount}} |
| **Доля SDD от общего числа** | **{{counters.sddShare}} %** |
| Проверить не удалось (в расчёт не входят) | {{counters.unverifiedCount}} |

## Стори, выполненные по SDD

| Задача | Статус | В работе с | Засчитано по | Коммит | Ответственный |
|---|---|---|---|---|---|
{{#each sddStories}}
| {{key}} | {{status}} | {{inProgressAt}} | {{via}} | {{commit}} | {{responsible}} |
{{/each}}

## Стори, выполненные без SDD

| Задача | Статус | В работе с | Ответственный |
|---|---|---|---|
{{#each plainStories}}
| {{key}} | {{status}} | {{inProgressAt}} | {{responsible}} |
{{/each}}

## Проверить не удалось

{{#if counters.unverifiedCount}}

| Задача | Причина |
|---|---|
{{#each unverified}}
| {{key}} | {{reason}} |
{{/each}}

{{else}}нет записей{{/if}}

## Ссылки

{{#each sddStories}}
- {{key}}: {{url}}
{{/each}}
{{#each plainStories}}
- {{key}}: {{url}}
{{/each}}

## Как читать этот отчёт

- В выборку попадают стори, переведённые в работу в окне и дошедшие до тестирования.
- «Выполнено по SDD» — есть метка `{{meta.label}}` **или** стори упомянута в слитом PR, в котором есть коммит с изменениями папки спецификаций; достаточно одного.
- «Выполнено без SDD» — ни метки, ни такого PR.
- Доля SDD считается от числа прошедших отбор: непроверенные стори в знаменатель не входят.

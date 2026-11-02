<!--
Словарь данных для подстановки (больше ничего агент в отчёт не выдумывает):

Мета:  {{reportTitle}} {{generatedAt}} {{window}} {{label}} {{statusesAccepted}}
       {{taskStoreName}} {{codeStoreName}} {{queryFile}} {{templateFile}}
Счётчики: {{storyCount}} {{sddCount}} {{plainCount}} {{labelCount}} {{commitCount}} {{sddShare}} {{unverifiedCount}}
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

# {{reportTitle}}

Дата: {{generatedAt}} · Окно: {{window}} · Метка: `{{label}}` · Засчитаны статусы: {{statusesAccepted}}
Задачи: {{taskStoreName}} · Код: {{codeStoreName}}
Запрос: `{{queryFile}}` · Шаблон: `{{templateFile}}`

## Итог

| Показатель | Значение |
|---|---|
| Стори в выборке (прошли отбор) | {{storyCount}} |
| Выполнено по SDD | {{sddCount}} — из них с меткой {{labelCount}}, через PR с артефактами {{commitCount}} |
| Выполнено без SDD | {{plainCount}} |
| **Доля SDD от общего числа** | **{{sddShare}} %** |
| Проверить не удалось (в расчёт не входят) | {{unverifiedCount}} |

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

{{#if unverifiedCount}}

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
- «Выполнено по SDD» — есть метка `{{label}}` **или** стори упомянута в слитом PR, в котором есть коммит с изменениями папки спецификаций; достаточно одного.
- «Выполнено без SDD» — ни метки, ни такого PR.
- Доля SDD считается от числа прошедших отбор: непроверенные стори в знаменатель не входят.
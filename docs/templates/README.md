# Заготовки файлов Process Kit

Перед созданием любого файла скопируй заготовку, замени `<…>` и удали строки-подсказки «#».
После правки запусти `node tools/validate.js`: 0 ошибок — готово.
Заготовка — то, что копируют; как устроен набор — в docs/reference/.

| Что создаёшь | Заготовка | Куда кладётся | Проверка (--only) |
|---|---|---|---|
| Процесс | process.md | processes/<префикс><имя>.md | processes |
| Действие | action/ACTION.md (+ queries/, templates/) | actions/<префикс><имя>/ | actions |
| Подключение | adapter.md | adapters/<префикс><система>.md | adapters |
| Контекст | context.md | context/<префикс><тема>.md | context |
| Служебный скилл | skill/SKILL.md | .gigacode/skills/<имя>/SKILL.md | skills |
| Команда | TEAM.md | TEAM.md (только в team-<команда>) | team |
| Настройки команды | sources.json | config/sources.json (только в team-<команда> и my) | sources |
| Итог запуска | итог.md | outputs/<имя>/итог.md | outputs |
| Отчёт настройки | что-сделано.md | outputs/<дата>_настройка/что-сделано.md | outputs |
| Заявка | заявка.md | outputs/<дата>_заявка-…/заявка.md | outputs |
| Состояние прогона | state.json | outputs/<имя>/.run/state.json | outputs |
| Строка истории | runs.jsonl | .history/runs.jsonl (одна строка на запуск) | history |

Префикс: общий уровень (master и master-<имя>) — без префикса; командный (`team-<команда>`
и рабочая ветка команды) — имя ветки целиком, `team-<команда>-`; личный — `my-`.
Новый процесс или действие, собранные человеком, — всегда `my-`.
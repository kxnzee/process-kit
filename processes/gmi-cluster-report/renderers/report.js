'use strict';
// Форма отчёта «GigaCode Maturity Index»: две таблицы как в сценарии — цифры кластера и сводная
// таблица сотрудников от меньшего итога к большему. Числа берёт из данных расчёта как есть:
// здесь только представление, без пересчётов и без новых выводов.
const cell = value => String(value === undefined || value === null ? '' : value).replace(/\|/g, '/').replace(/\r?\n/g, ' ');
// Баллы печатаются с фиксированным числом знаков: «3» и «3,0» в одной колонке читаются как
// разная точность, а порог «6» перестаёт похож на порог.
const num = (value, digits = 1) => (value === null || value === undefined ? '—' : Number(Number(value).toFixed(digits)).toFixed(digits).replace('.', ','));

function check(data) {
  if (!data || typeof data !== 'object') throw new Error('Нет данных отчёта');
  const m = data.meta, c = data.counters;
  if (!m || !c) throw new Error('Нет meta или counters');
  for (const key of ['reportTitle', 'generatedAt', 'perimeter']) {
    if (!m[key]) throw new Error(`Нет обязательного meta.${key}`);
  }
  if (!m.goal || typeof m.goal.total !== 'number') throw new Error('Нет целевого значения в meta.goal');
  if (!m.source || !m.source.file) throw new Error('Нет ссылки на файл-источник: отчёт неотличим от догадки');
  for (const key of ['employees', 'counted', 'belowGoal', 'reachedGoal']) {
    if (typeof c[key] !== 'number') throw new Error(`Нет обязательного counters.${key}`);
  }
  if (c.belowGoal + c.reachedGoal + c.withoutTotal !== c.employees) throw new Error('Число сотрудников не сходится с разбивкой по статусам');
  if (!Array.isArray(data.cluster) || !data.cluster.length) throw new Error('Нет строк «Цифры кластера»');
  for (const key of ['people', 'levers', 'mismatches', 'gaps', 'notes', 'questions']) {
    if (!Array.isArray(data[key])) throw new Error(`Нет массива ${key}`);
  }
  if (data.people.length !== c.employees) throw new Error(`Строк сотрудников (${data.people.length}) больше или меньше, чем в счётчике (${c.employees})`);
  data.people.forEach((row, index) => { if (row.ordinal !== index + 1) throw new Error(`Порядковый номер строки ${row.who} не соответствует месту в таблице`); });
  const sorted = data.people.every((row, index) => index === 0 || (data.people[index - 1].total === null || row.total === null || data.people[index - 1].total <= row.total));
  if (!sorted) throw new Error('Сводная таблица не отсортирована от меньшего общего итога к большему');
  return data;
}

function table(labels, values) {
  return [`| ${labels.map(cell).join(' | ')} |`, `|${labels.map(() => '---').join('|')}|`, `| ${values.map(cell).join(' | ')} |`];
}

function render(data) {
  const d = check(data), m = d.meta, c = d.counters;
  const lines = [`# ${m.reportTitle}`, ''];
  if (m.demo) lines.push('**ДАННЫЕ ДЕМО**', '');
  lines.push(
    `Дата прогона: ${cell(m.generatedAt)} · Периметр: ${cell(m.perimeter)}`,
    `Цель: ${num(m.goal.total, 1)} балла из ${num(m.goal.max, 0)} — по блокам: обучение ${num(m.goal.training, 1)}, навыки ${num(m.goal.skills, 1)}, продуктивность ${num(m.goal.productivity, 1)}`,
    `Источник: ${cell(m.source.file)}${m.source.sheet ? `, лист ${cell(m.source.sheet)}` : ''} · строк данных ${m.source.dataRowCount}, сотрудников ${c.employees}${c.skipped ? `, строк без номера ${c.skipped}` : ''}`,
    `ФИО: ${m.names.source === 'колонка таблицы' ? `колонка выгрузки «${cell(m.names.column)}», заполнено ${m.names.matched} из ${c.employees}` : m.names.source === 'справочник' ? `справочник ${cell(m.names.file)}, совпало ${m.names.matched} из ${c.employees}` : `не взяты (${c.withoutName} человек подписаны табельным номером)`}`,
    `Методика: ${m.methodologyVersion ? cell(m.methodologyVersion) : 'версия не закреплена — сверить шкалы перед тем, как показывать отчёт'}`,
    '');

  lines.push('## Цифры кластера', '');
  lines.push(...table(d.cluster.map(row => row.label), d.cluster.map(row => row.value)));
  lines.push('', `Средние — по ${c.counted} строкам с заполненным «Общий итог», всего строк сотрудников ${c.employees}.`, '');

  const labels = ['№', 'ФИО', 'Команда', 'Роль', 'Обучение и применение', 'Навыки', 'Продуктивность', 'Общий итог', 'Рекомендация', 'Статус'];
  lines.push('## Сводная таблица', '', `Отсортирована от меньшего общего итога; ниже цели ${c.belowGoal} из ${c.counted}, цель достигли ${c.reachedGoal}.`, '');
  lines.push(`| ${labels.join(' | ')} |`, `|${labels.map(() => '---').join('|')}|`);
  if (!d.people.length) lines.push('| — | нет записей | | | | | | | | |');
  for (const row of d.people) {
    // Тем, кому ниже цели, подробности печатаются списком под таблицей: в ячейке остаётся
    // только то, что можно отправить человеку, поэтому строка таблицы пролезает в колонку.
    const detailed = row.status === 'ниже цели';
    const advice = row.gaps.length && !detailed ? `${row.recommendation} · не подтверждено в выгрузке: ${row.gaps.map(cell).join('; ')}` : row.recommendation;
    lines.push(`| ${row.ordinal} | ${cell(row.who)} | ${cell(row.team || '—')} | ${cell(row.role || '—')} | ${num(row.training, 1)} | ${num(row.skills, 1)} | ${num(row.productivity, 1)} | ${num(row.total, 1)} | ${cell(advice)} | ${cell(row.grade ? `${row.grade} — ${row.status}` : row.status)} |`);
  }
  lines.push('');

  const goalBall = num(m.goal.total, 1);
  lines.push('## Что делать каждому ниже цели', '',
    `Список по ${c.belowGoal} человекам ниже цели: сначала короткое действие — именно тем же текстом собирается письмо сотруднику (в файле страницы под каждым блоком ссылка «Письмо сотруднику»); степень улучшения — отдельным списком под ним, в письмо она не входит.`);
  lines.push('');
  const need = d.people.filter(row => row.status === 'ниже цели');
  if (!need.length) lines.push('нет записей — ниже цели никого');
  for (const row of need) {
    lines.push(`**${row.ordinal}. ${cell(row.who)}** — ${num(row.total, 1)} балла из ${goalBall}${row.grade ? `, оценка ${row.grade}` : ''}`, '');
    if (!row.levers.length) { lines.push(cell(row.recommendation), ''); continue; }
    for (const lever of row.levers) lines.push(`- ${cell(lever.text)}`);
    lines.push('', `Степень улучшения: +${num(row.potential, 1)} балла${row.reachesGoal ? ` — этого хватает до цели ${goalBall}` : row.leftToGoal === null ? '' : ` — до цели ${goalBall} остаётся ${num(row.leftToGoal, 1)}`}:`, '');
    for (const lever of row.levers) {
      lines.push(`- ${cell(lever.brief)}: +${num(lever.gain, 1)} балла${lever.steps.length ? ` — ${lever.steps.map(cell).join('; ')}` : ''}`);
    }
    if (row.gaps.length) lines.push('', `Не подтверждено в выгрузке: ${row.gaps.map(cell).join('; ')}.`);
    lines.push('');
  }

  lines.push('## Общие рычаги периметра', '');
  if (!d.levers.length) lines.push('нет записей — ниже цели никого, кому помогали бы эти шаги');
  else {
    lines.push('| Что мешает | Человек | Потенциал, баллов |', '|---|---|---|');
    for (const lever of d.levers) lines.push(`| ${cell(lever.lever)} | ${lever.people} | ${num(lever.potential, 1)} |`);
    lines.push('', 'Что именно стоит за каждой строкой таблицы:');
    for (const lever of d.levers) {
      const details = lever.details || [];
      if (!details.length) continue;
      lines.push(`- ${cell(lever.lever)}: ${details.map(item => `${cell(item.item)} — ${item.people}`).join('; ')}`);
    }
  }
  lines.push('');

  lines.push('## Расхождения пересчёта с выгрузкой', '');
  if (!d.mismatches.length) lines.push('нет записей: каждый блок сошёлся с баллом файла');
  else {
    lines.push('| Сотрудник | Блок | В файле | Посчитано правилом | Разница |', '|---|---|---|---|---|');
    for (const row of d.mismatches.slice(0, 15)) lines.push(`| ${cell(row.id)} | ${cell(row.block)} | ${cell(row.file)} | ${cell(row.recomputed)} | ${cell(row.delta)} |`);
    if (d.mismatches.length > 15) lines.push('', `и ещё ${d.mismatches.length - 15} таких же строк — полный список в артефакте расчёта.`);
  }
  lines.push('');

  lines.push('## Чего не хватает в выгрузке', '');
  if (!d.gaps.length) lines.push('нет записей');
  else {
    const sorted = [...d.gaps].sort((a, b) => b.count - a.count || a.field.localeCompare(b.field, 'ru'));
    for (const gap of sorted.slice(0, 12)) lines.push(`- ${cell(gap.field)}: пусто в ${gap.count} строках`);
    if (sorted.length > 12) lines.push(`- и ещё ${sorted.length - 12} полей — в артефакте чтения`);
    lines.push('', 'Пустое значение — это «в файле нет», а не ноль: неподтверждённые части блоков не считаются потерянными, они помечены в строке «Не подтверждено».');
  }
  lines.push('');

  lines.push('## Вопросы', '');
  if (!d.questions.length) lines.push('нет записей');
  for (const question of d.questions) lines.push(`- ${cell(question.scope)}: ${cell(question.text)} Почему: ${cell(question.why)}.`);
  lines.push('');

  lines.push('## Оговорки прогона', '');
  if (!d.notes.length) lines.push('нет записей');
  for (const note of d.notes) lines.push(`- ${cell(note)}`);
  lines.push('');

  lines.push('## Как читать этот отчёт', '',
    `- Строка сводной таблицы — сотрудник; «Общий итог» взят из выгрузки, а блоки пересчитаны правилом процесса по шкалам методики. Строк ${c.employees}, знаменатель средних — ${c.counted} строк с заполненным итогом.`,
    `- «Статус» — оценка A–E и сравнение с целью ${num(m.goal.total, 1)}: A сильнее всех, E хуже предупреждающего порога (границы оценок — в оговорках прогона); «итог в файле не заполнен» без буквы означает, что сравнения не было, а не что цель не достигнута.`,
    '- «Рекомендация» в таблице — короткие действия без баллов и ссылок на шкалы: их можно переслать человеку как есть, порядок — от большего прироста к меньшему. Полные формулировки со значениями и степень улучшения по каждой шкале печатаются в разделе «Что делать каждому ниже цели».',
    '- Рычаг берётся только из колонок выгрузки: курсы, частота и режим работы, навыки, когорта токенов, метрики продуктивности и Story. Прирост у каждого шага — следующая ступень той же шкалы, поэтому потенциал складывается в число.',
    '- Расхождение блока с выгрузкой — не ошибка округления: так видно, что формула процесса разошлась с формулой отчёта, на который смотрит штаб.',
    '- ФИО берутся из колонки выгрузки «ФИО сотрудника», а если её в снимке нет — из справочника владельца; без обоих человек подписан табельным номером, и это называется в оговорках, а не оставляется догадке.',
    '- Колонка «Команда» — название команды из выгрузки; код остаётся запасным вариантом для старых снимков, где названия ещё не было.',
    '- Трайбовый бонус («Оценка в БП») и средние трайба в оценку человека не входят.');
  return lines.join('\n') + '\n';
}

function validate(text, data) {
  if (String(text).replace(/\r\n/g, '\n').trim() !== render(data).trim()) {
    throw new Error('Отчёт не соответствует данным и форме процесса: используйте штатное формирование');
  }
}

module.exports = { render, validate };

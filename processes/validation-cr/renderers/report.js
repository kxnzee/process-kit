'use strict';
// Текстовая форма отчёта валидации CR (базовый уровень): строки переносятся из
// report-data дословно, ничего не пересчитывается. Записи в систему нет.
// validate отклоняет потерю или подмену фактов.

const cell = value => String(value ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ');
const link = (text, url) => (url ? `[${cell(text)}](${url})` : cell(text));

function check(data) {
  if (!data || typeof data !== 'object') throw new Error('Нет данных отчёта');
  const m = data.meta, c = data.counters;
  if (!m || !c) throw new Error('Нет meta или counters');
  for (const key of ['runDate', 'okLabel', 'errorLabel']) if (!m[key]) throw new Error(`Нет обязательного meta.${key}`);
  for (const key of ['total', 'okCount', 'errorCount', 'securityViolationCount', 'unreadableCount', 'excludedCount', 'unverifiedCount']) {
    if (typeof c[key] !== 'number') throw new Error(`Нет обязательного counters.${key}`);
  }
  if (c.okCount + c.errorCount !== c.total) throw new Error('Счётчики исходов не сходятся с total');
  if (!Array.isArray(data.items)) throw new Error('Нет массива items');
  for (const item of data.items) if (!item.key) throw new Error('Строка items без ключа');
  for (const key of ['excluded', 'unverified', 'notes']) if (!Array.isArray(data[key])) throw new Error(`Нет массива ${key}`);
  return data;
}

function reasons(item) {
  const lines = [];
  for (const field of item.unreadFields || []) lines.push(`- Не удалось прочитать поле «${field}».`);
  for (const field of item.failedFields || []) {
    lines.push(`- Бизнес-поле ${field.label || field.fieldId} (${field.fieldId}): ${field.requirement} — ${field.status}; значение: ${field.value ?? 'нечитаемо'}.`);
  }
  for (const rule of item.failedRules || []) {
    const detail = rule.note || rule.basis || 'основание не названо';
    lines.push(`- Правило поля «${rule.field}» ${rule.ruleId}: ${rule.status} — ${detail}.`);
  }
  for (const finding of item.securityFindings || []) {
    lines.push(`- Попытка вмешательства: ${finding.category} — «${finding.quote}» (${finding.place}).`);
  }
  if (item.securityViolation && !(item.securityFindings || []).length) {
    lines.push('- Попытка вмешательства зафиксирована без места: ручная проверка безопасности.');
  }
  return lines;
}

function render(data, params) {
  check(data);
  const m = data.meta, c = data.counters;
  const out = [];
  out.push(`# Отчёт валидации CR — ${cell(m.runDate)}`);
  if (m.demo) out.push('> ДАННЫЕ ДЕМО: прогон выполнен на вымышленных данных.');
  out.push('');
  out.push(`Сводка: обработано ${c.total}, ${m.okLabel} — ${c.okCount}, ${m.errorLabel} — ${c.errorCount}, попыток вмешательства — ${c.securityViolationCount}, нечитаемых — ${c.unreadableCount}.`);
  if (m.issueKey) out.push(`Обрабатывался CR ${m.issueKey}; иначе — вся выборка.`);
  out.push('');
  out.push('## Результаты по CR');
  out.push('');
  if (!data.items.length) out.push('Нет записей: выборка пуста.');
  else {
    out.push('| CR | Исход |');
    out.push('|---|---|');
    for (const item of data.items) {
      out.push(`| ${link(item.key, item.url)} ${cell(item.summary)} | ${cell(item.verdict)} |`);
    }
  }
  out.push('');
  out.push('## Причины по CR');
  out.push('');
  let reasonsAny = false;
  for (const item of data.items) {
    const lines = reasons(item);
    if (!lines.length) continue;
    reasonsAny = true;
    out.push(`### ${link(item.key, item.url)}`);
    out.push('');
    out.push(...lines);
    out.push('');
  }
  if (!reasonsAny) out.push('Нет записей: замечаний не обнаружено.');
  out.push('## Проверить не удалось');
  out.push('');
  const unread=data.items.filter(item=>(item.unreadFields||[]).length);
  if (!data.unverified.length&&!unread.length) out.push('Нет записей.');
  for(const item of unread)out.push(`- ${link(item.key,item.url)}: не удалось прочитать ${item.unreadFields.map(cell).join(', ')}.`);
  for (const row of data.unverified) out.push(`- ${link(row.key, row.url)}: ${cell(row.reason)}.`);
  out.push('');
  out.push('## Исключены');
  out.push('');
  if (!data.excluded.length) out.push('Нет записей.');
  else for (const row of data.excluded) out.push(`- ${link(row.key, row.url)}: ${cell(row.reason)}.`);
  out.push('');
  out.push('## Оговорки');
  out.push('');
  if (!data.notes.length) out.push('Нет записей.');
  else for (const note of data.notes) out.push(`- ${cell(note)}.`);
  out.push('');
  return out.join('\n');
}

function validate(text, data, params) {
  check(data);
  for (const item of data.items) {
    if (!text.includes(item.key)) throw new Error(`В отчёте нет ключа ${item.key}`);
    if (!text.includes(item.verdict)) throw new Error(`В отчёте нет исхода ${item.verdict} для ${item.key}`);
  }
  for (const row of data.unverified) if (!text.includes(row.key)) throw new Error(`В отчёте нет непроверенного ключа ${row.key}`);
  const c = data.counters;
  for (const value of [c.total, c.okCount, c.errorCount]) {
    if (!text.includes(String(value))) throw new Error(`В отчёте нет числа ${value} из сводки`);
  }
  for (const note of data.notes) {
    if (!text.includes(note.split(':')[0])) throw new Error(`В отчёте нет оговорки «${note}»`);
  }
  if (data.meta.demo && !text.includes('ДАННЫЕ ДЕМО')) throw new Error('В демо-отчёте нет пометки «ДАННЫЕ ДЕМО»');
  return true;
}

module.exports = { check, render, validate };

'use strict';
// Форма отчёта «Инфо-поводы Release Notes»: одна таблица двух колонок, как в сценарии.
// Строки переносятся из report-data дословно, ничего не пересчитывается.
const cell = value => String(value ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ');
const link = (text, url) => (url ? `[${cell(text)}](${url})` : cell(text));
// Короткая подпись причины вопроса (значения заданы контрактом report-data): подробное
// «чего не хватило» печатается полем why той же строки.
const CAUSES = {
  'rule-conflict': 'правило против чтения задачи',
  'weak-rule': 'опора только на слабый признак',
  'unknown-meaning': 'смысл задачи не установлен',
  'missing-date': 'нет плановой даты внедрения'
};

function check(data) {
  if (!data || typeof data !== 'object') throw new Error('Нет данных отчёта');
  const m = data.meta, c = data.counters;
  if (!m || !c) throw new Error('Нет meta или counters');
  for (const key of ['reportTitle', 'pageTitle', 'generatedAt', 'windowsText', 'stores']) {
    if (!m[key]) throw new Error(`Нет обязательного meta.${key}`);
  }
  for (const key of ['releaseCount', 'rowCount', 'keCount']) {
    if (typeof c[key] !== 'number') throw new Error(`Нет обязательного counters.${key}`);
  }
  if (c.rowCount !== c.rowCurrentCount + c.rowPlanCount) throw new Error('Число строк не сходится с разбивкой по окнам');
  const grouped = (data.keGroups || []).reduce((sum, g) => sum + ((g.current || []).length + (g.plan || []).length), 0);
  if (grouped !== c.rowCount) throw new Error(`Строк в группах (${grouped}) больше или меньше, чем в счётчике (${c.rowCount})`);
  for (const key of ['keGroups', 'questions', 'unverified', 'excluded', 'notes']) {
    if (!Array.isArray(data[key])) throw new Error(`Нет массива ${key}`);
  }
  for (const group of data.keGroups) {
    for (const row of [...(group.current || []), ...(group.plan || [])]) {
      if (!Array.isArray(row.technicalRefs)) throw new Error(`У строки ${row.key} нет массива technicalRefs`);
    }
  }
  return data;
}

function serviceRows(data) {
  const order = [], byRelease = new Map();
  for (const group of data.keGroups) {
    for (const win of ['current', 'plan']) {
      for (const row of group[win]) {
        const key = String(row.key || `${group.name}#${win}#${row.heading}`);
        let entry = byRelease.get(key);
        if (!entry) { entry = { services: [], kes: [], current: null, plan: null }; byRelease.set(key, entry); order.push(key); }
        const service = String(row.itService || group.name).trim() || group.name;
        if (!entry.services.includes(service)) entry.services.push(service);
        if (!entry.kes.includes(group.name)) entry.kes.push(group.name);
        if (!entry[win]) entry[win] = row;
      }
    }
  }
  const groups = new Map();
  for (const key of order) {
    const entry = byRelease.get(key), main = entry.services[0];
    if (!groups.has(main)) groups.set(main, { name: main, current: [], plan: [] });
    const group = groups.get(main);
    for (const win of ['current', 'plan']) if (entry[win]) group[win].push({ row: entry[win], kes: entry.kes, services: entry.services });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function cellText(entries) {
  if (!entries.length) return 'Нет релиза этой ИТ-услуги в окне';
  const parts = [];
  for (const entry of entries) {
    const row = entry.row;
    const lines = [];
    if (entry.services.length > 1) lines.push(`ИТ-услуги релиза: ${entry.services.map(service => cell(service)).join('; ')}`);
    lines.push(`КЭ: ${entry.kes.map(ke => cell(ke)).join('; ')}`);
    lines.push(`**${link(row.heading.replace(/^Релиз:\s*/, ''), row.url)}**`);
    if (row.kind === 'technical') {
      const label = cell(row.excludedText || 'Технический релиз');
      const refs = row.technicalRefs.map(ref => link(ref.key, ref.url)).join(', ');
      lines.push(refs ? `${label}: ${refs}` : label);
    } else if (row.kind === 'empty') lines.push('Нет инфоповодов: в релизе нет связанных задач');
    else if (row.kind === 'unread') lines.push('Состав релиза прочитан не полностью — см. раздел «Проверить не удалось»');
    else for (const item of row.items) {
      // Пометку про класс здесь не ставим: такая задача названа в разделе «Вопросы» своим ключом.
      lines.push(`• ${link(item.key, item.url)} — ${cell(item.summary)}`);
    }
    parts.push(lines.join('<br>'));
  }
  return parts.join('<br><br>');
}

function render(data) {
  const d = check(data), m = d.meta, c = d.counters;
  const lines = [`# ${m.reportTitle}`, ''];
  if (m.demo) lines.push('**ДАННЫЕ ДЕМО**', '');
  lines.push(
    `Дата: ${m.generatedAt} · Окна: ${cell(m.windowsText)}`,
    `Релизы: ${m.stores.map(store => `${cell(store.label)} — релизов ${store.releases}`).join('; ')}`,
    `только технические ${c.technicalCount}, пустой состав ${c.emptyCount}, состав прочитан не полностью ${c.unreadCompositionCount}`,
    '',
    `Бизнес задач: ${c.storyCount} · Технических задач: ${c.technicalStoryCount} · из них без класса: ${c.unknownStoryCount}`,
    '');

  const services = serviceRows(d);
  lines.push('| Текущие инфоповоды | Планы на следующую неделю |', '|---|---|');
  if (!services.length) lines.push('| Нет релизов в окнах | Нет релизов в окнах |');
  for (const group of services) {
    const name = `**${cell(group.name)}**`;
    lines.push(`| ${name}<br>${cellText(group.current)} | ${name}<br>${cellText(group.plan)} |`);
  }
  lines.push('');

  lines.push('## Вопросы', '');
  if (d.questions.length) {
    for (const q of d.questions) {
      const known = cell(q.why).replace(/\s+$/, '');
      const knownText = /[.!?]$/.test(known) ? known : `${known}.`;
      const title = q.summary ? ` «${cell(q.summary)}»` : '';
      const where = q.release ? `релиз ${link(q.release.key, q.release.url)}` : 'релиз не определён';
      const reason = CAUSES[q.cause];
      if (!reason) throw new Error(`Неизвестная причина вопроса у ${q.scope}: «${q.cause}»`);
      lines.push(`- ${link(q.scope, q.url)}${title} (${where}) — ${reason}. ${knownText} Что нужно решить: ${cell(q.text)}`);
    }
  } else lines.push('нет записей');
  lines.push('');

  lines.push('## Проверить не удалось', '');
  if (d.unverified.length) for (const row of d.unverified) lines.push(`- ${cell(row.key)}: ${cell(row.reason)}`);
  else lines.push('нет записей');
  lines.push('');

  lines.push('## Оговорки прогона', '');
  if (d.notes.length) for (const note of d.notes) lines.push(`- ${cell(note)}`);
  else lines.push('нет записей');
  lines.push('');

  lines.push('## Как читать этот отчёт', '',
    `- Строка таблицы — ИТ-услуга (их ${services.length}); релиз выводится один раз в строке своей услуги, даже если у него несколько КЭ.`,
    '- Над строкой релиза перечислены его КЭ через точку с запятой — по ним читатель сверяется с реестром.',
    '- «Внедрение дд.мм» — плановая дата начала внедрения уже наступила или совпадает с датой прогона; «плановая дата ПРОМ дд.мм» — дата впереди.',
    '- Три подписи вместо инфоповодов: «Нет релиза этой ИТ-услуги в окне» — у услуги нет релиза в этом окне; «Нет инфоповодов: в релизе нет связанных задач» — релиз есть, его состав прочитан и в нём ни одной задачи; «Технический релиз: <ключи>» — задачи есть, но все они про внутреннее устройство системы, каждый ключ ведёт ссылкой в Jira.',
    '- Состав прочитан не полностью — чтение оборвалось, детали в разделе «Проверить не удалось»; это «не проверено», а не «нет».',
    '- «Вопросы» — то, что решает человек: чтение задачи и признак из правил дают разные классы, опора только на слабый признак, смысл не установлен или у релиза нет плановой даты. В строке: сама задача, её релиз, что известно и что нужно решить. Задача при этом остаётся в таблице строкой своего релиза обычным инфоповодом и остаётся в счётчике своего класса: вопрос про уверенность в классе, а не про то, учтена ли задача; чтобы закрыть вопрос, достаточно одной строки ответа.');
  return lines.join('\n') + '\n';
}

function validate(text, data) {
  if (String(text).replace(/\r\n/g, '\n').trim() !== render(data).trim()) {
    throw new Error('Отчёт не соответствует данным и форме процесса: используйте штатное формирование');
  }
}

module.exports = { render, validate };

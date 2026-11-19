'use strict';
const { isDeepStrictEqual } = require('node:util');
const s = require('../../tools/lib/actions/action-support');
const FIELDS = ['summary', 'description'];
module.exports = { validate(ctx) {
  const records = s.read(ctx.cwd, ctx.params.records), value = ctx.value;
  if (value.items.length !== records.records.length || value.checkedCount !== records.records.length) throw new Error('Неполная проверка безопасности');
  for (const [i, item] of value.items.entries()) {
    const row = records.records[i];
    if (item.key !== row.key || item.summary !== (typeof row.summary === 'string' ? row.summary : '')) throw new Error('Подменена запись проверки безопасности');
    if (item.violation !== !!item.findings.length) throw new Error('Нарушение и находки не согласованы');
    for (const finding of item.findings) if (!FIELDS.includes(finding.place) || typeof row[finding.place] !== 'string' || !row[finding.place].includes(finding.quote)) throw new Error('Находка должна цитировать исходное поле');
    const unread = FIELDS.filter(field => typeof row[field] !== 'string');
    if (!isDeepStrictEqual([...item.unreadFields].sort(), unread.sort())) throw new Error('Неполный или неверный список нечитаемых полей');
  }
  if (value.violationCount !== value.items.filter(item => item.violation).length || value.unreadableCount !== value.items.filter(item => item.unreadFields.length).length) throw new Error('Неверные счётчики безопасности');
} };

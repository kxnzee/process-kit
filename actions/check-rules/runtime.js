'use strict';
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { inside } = require('../../tools/lib/core/safe-path');
const s = require('../../tools/lib/actions/action-support');

function ruleIds(ctx, file) {
  const ids = [];
  let table = false, fenced = false;
  const add = id => {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u.test(id) || ids.includes(id)) throw new Error('Неверный или повторный id правила: ' + id);
    ids.push(id);
  };
  for (const line of fs.readFileSync(inside(ctx.cwd, file), 'utf8').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      const id = cells[0].replace(/[`*]/g, '');
      if (/^(id|ruleid|идентификатор|код)$/i.test(id)) { table = true; continue; }
      if (/^:?-+:?$/.test(id)) continue;
      if (table && cells[1]) add(id);
      continue;
    }
    table = false;
    const item = line.match(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s+(?:\*\*|`)?([\p{L}\p{N}][\p{L}\p{N}_.-]*)(?:\*\*|`)?\s*[:：—–]\s*\S/u);
    if (item) add(item[1]);
  }
  if (!ids.length) throw new Error('В файле правил нет явных id: ' + file);
  return ids;
}
function manifest(ctx) {
  const file = s.resource(ctx.cwd, ctx.processName, ctx.params.manifestFile, ctx.requires);
  const list = s.read(ctx.cwd, file);
  if (!Array.isArray(list)) throw new Error('manifestFile: нужен массив');
  return list.map(item => {
    if (!item || typeof item.field !== 'string' || !item.field.trim()) throw new Error('Манифест: нужно поле');
    const rulesFile = s.resource(ctx.cwd, ctx.processName, item.rulesFile, ctx.requires);
    return { ...item, ids: ruleIds(ctx, rulesFile) };
  });
}
const empty = value => typeof value === 'string' && /^(?:-|—|null|н\/д)?$/i.test(value.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim());
function execute(ctx) {
  if (manifest(ctx).length) throw new Error('Текстовые правила проверяет агент после begin');
  const records = s.read(ctx.cwd, ctx.params.records);
  return { manifestFile: ctx.params.manifestFile, processedCount: records.records.length, totalFailedCount: 0, skipped: true, sections: [] };
}
function validate(ctx) {
  const list = manifest(ctx), value = ctx.value, records = s.read(ctx.cwd, ctx.params.records);
  if (value.manifestFile !== ctx.params.manifestFile || value.processedCount !== records.records.length || value.skipped !== !list.length || value.sections.length !== list.length) throw new Error('Проверка правил не соответствует манифесту или выборке');
  let total = 0;
  for (const [index, section] of value.sections.entries()) {
    const declared = list[index];
    if (section.field !== declared.field || section.rulesFile !== declared.rulesFile || section.items.length !== records.records.length || section.ruleCount !== declared.ids.length) throw new Error('Неверная секция или неполный состав правил');
    const counts = { pass: 0, fail: 0, unknown: 0, unreadable: 0 };
    for (const [i, item] of section.items.entries()) {
      const row = records.records[i], text = row[section.field];
      if (item.key !== row.key || item.summary !== (typeof row.summary === 'string' ? row.summary : '')) throw new Error('Подменена запись проверки');
      if (!isDeepStrictEqual(item.results.map(result => result.ruleId), declared.ids)) throw new Error('Неполный состав или неверный порядок правил');
      if (item.emptyOrPlaceholder !== empty(text)) throw new Error('Неверный признак пустого поля');
      for (const result of item.results) {
        counts[result.status]++;
        if (typeof text !== 'string' && result.status !== 'unreadable' || empty(text) && result.status !== 'fail') throw new Error('Нечитаемое или пустое поле не может пройти правила');
        if (result.status === 'pass' && !result.basis || result.basis && (typeof text !== 'string' || !text.includes(result.basis))) throw new Error('Основание должно быть цитатой поля');
      }
      const failed = item.results.filter(result => result.status !== 'pass').length;
      if (item.failedCount !== failed) throw new Error('Неверный failedCount');
      total += failed;
    }
    for (const key of Object.keys(counts)) if (section.statusCounts[key] !== counts[key]) throw new Error('Неверные счётчики правил');
  }
  if (value.totalFailedCount !== total) throw new Error('Неверный totalFailedCount');
}
module.exports = { dependencies(ctx) { return [ctx.params.manifestFile, ...manifest(ctx).map(item => item.rulesFile)]; }, canExecute(ctx) { return !manifest(ctx).length; }, execute, validate };

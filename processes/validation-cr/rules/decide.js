'use strict';
// Свод включённых проверок CR в один исход на запись: CHECK_OK или CHECK_ERROR.
// Правило чистое: читает переданные артефакты (объекты или пути к файлам прогона);
// внешних вызовов, шаблона комментария и адресатов нет — запись в систему делает
// не этот процесс. Значения уровня (метки) приходят параметрами.
// Пропущенные проверки (skipped: уровень задал пустые данные) не участвуют в
// исходе и фиксируются в notes — отчёт печатает их как «не выполнялась».

function fail(text) { throw new Error(text); }

function object(value, at) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (e) { fail(`${at}: нужен JSON-объект`); } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${at}: нужен объект`);
  return value;
}

// Действие расчёта передаёт сохранённые артефакты уже прочитанными объектами; путь
// к файлу тоже принимается — иначе правило нельзя проверить отдельно от прогона.
function content(value, at) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return structuredClone(value);
  const textValue = typeof value === 'string' ? value.trim() : '';
  if (!textValue || /^\{[a-z0-9-]+\}$/.test(textValue)) fail(`${at}: нужен сохранённый артефакт — объект или путь к файлу прогона`);
  let raw; try { raw = require('node:fs').readFileSync(textValue, 'utf8'); } catch (e) { fail(`${at}: файл артефакта не читается (${textValue})`); }
  return object(raw, `${at}: файл артефакта`);
}

function byKey(list, at) {
  const map = new Map();
  for (const item of list || []) {
    if (!item || typeof item.key !== 'string' || !item.key.trim()) fail(`${at}: запись без ключа`);
    if(map.has(item.key))fail(`${at}: повтор ключа ${item.key}`);
    map.set(item.key, item);
  }
  return map;
}

function evaluate(inputs, parameters) {
  const records = content(inputs.records, 'inputs.records');
  const fields = content(inputs.fields, 'inputs.fields');
  const rules = content(inputs.rules, 'inputs.rules');
  const security = content(inputs.security, 'inputs.security');

  const p = object(parameters, 'parameters');
  const okLabel = typeof p.okLabel === 'string' && p.okLabel.trim() ? p.okLabel.trim() : fail('parameters.okLabel: нужна непустая строка');
  const errorLabel = typeof p.errorLabel === 'string' && p.errorLabel.trim() ? p.errorLabel.trim() : fail('parameters.errorLabel: нужна непустая строка');
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(p.runDate || '')) === false) fail('parameters.runDate: нужна дата прогона ГГГГ-ММ-ДД; пусто — назвать дату параметром запуска runDate');
  const runDate = p.runDate;

  const fieldsSkipped = fields.skipped === true;
  const rulesSkipped = rules.skipped === true;
  const fieldBy = fieldsSkipped ? null : byKey(fields.items, 'fields.items');
  const secBy = byKey(security.items, 'security.items');
  // Секции правил: карта поле → (ключ записи → результат проверки по этому полю).
  const ruleSections = [];
  if (!rulesSkipped) {
    for (const section of rules.sections || []) {
      if (!section || typeof section.field !== 'string' || !section.field.trim()) fail('rules.sections: секция без имени поля');
      ruleSections.push({ field: section.field, by: byKey(section.items, `rules.sections[${section.field}].items`) });
    }
  }

  const notes = [];
  if (fieldsSkipped) notes.push('Проверка бизнес-полей не выполнялась: уровень задал пустой список проверок');
  if (rulesSkipped) notes.push('Проверки по правилам не выполнялись: уровень задал пустой манифест');
  const items = [];
  let okCount = 0, errorCount = 0, securityViolationCount = 0, unreadableCount = 0;

  for (const record of records.records || []) {
    if (!record || typeof record.key !== 'string' || !record.key.trim()) fail('выборка содержит запись без ключа');
    const key = record.key;
    const fieldRes = fieldsSkipped ? null : (fieldBy.get(key) || fail(`нет результатов проверки полей для ${key}`));
    const secRes = secBy.get(key) || fail(`нет результатов проверки безопасности для ${key}`);

    const failedFields = fieldRes ? (fieldRes.results || []).filter(r => r.status !== 'pass') : [];
    const failedRules = [];
    for (const section of ruleSections) {
      const ruleRes = section.by.get(key) || fail(`нет результатов проверки поля ${section.field} для ${key}`);
      for (const r of ruleRes.results || []) {
        if (r.status !== 'pass') failedRules.push({ field: section.field, ruleId: r.ruleId, status: r.status, basis: r.basis ?? null, note: r.note ?? null });
      }
    }
    const rulesFailedCount = ruleSections.reduce((sum, section) => sum + ((section.by.get(key) || fail(`нет результатов проверки поля ${section.field} для ${key}`)).failedCount || 0), 0);

    const unreadFields = [...(secRes.unreadFields || [])];
    for (const r of (fieldRes && fieldRes.results) || []) {
      if (r.status === 'unreadable' && !unreadFields.includes(r.fieldId)) unreadFields.push(r.fieldId);
    }

    const violation = secRes.violation === true;
    const unreadable = unreadFields.length > 0;
    const isError = ((fieldRes && fieldRes.failedCount) || 0) > 0 || rulesFailedCount > 0 || violation || unreadable;
    const verdict = isError ? errorLabel : okLabel;
    if (isError) errorCount += 1; else okCount += 1;
    if (violation) securityViolationCount += 1;
    if (unreadable) unreadableCount += 1;

    items.push({
      key,
      url: typeof record.url === 'string' ? record.url : '',
      summary: typeof record.summary === 'string' ? record.summary : '',
      verdict,
      label: verdict,
      failedFields: failedFields.map(r => ({ fieldId: r.fieldId, label: r.label || '', requirement: r.requirement, status: r.status, value: r.value ?? null })),
      failedRules,
      securityViolation: violation,
      securityFindings: (secRes.findings || []).map(f => ({ place: String(f.place || ''), category: String(f.category || ''), quote: String(f.quote || '') }))
    });
  }

  const counters = {
    total: items.length, okCount, errorCount, securityViolationCount, unreadableCount,
    excludedCount: (records.excluded || []).length, unverifiedCount: (records.unverified || []).length
  };

  const meta = {
    runDate,
    project: String((records.meta || {}).project ?? ''),
    issueType: String((records.meta || {}).issueType ?? ''),
    issueKey: String((records.meta || {}).issueKey ?? ''),
    queryFile: String((records.meta || {}).queryFile ?? ''),
    taskStore: String((records.meta || {}).taskStore ?? ''),
    okLabel, errorLabel,
    demo: (records.meta || {}).demo === true
  };

  return { meta, counters, items, excluded: records.excluded || [], unverified: records.unverified || [], notes };
}

module.exports = { evaluate };

'use strict';
// HTML-форма того же отчёта (базовый уровень): факты те же, что в текстовой форме —
// обе рендерятся из одного report-data, содержимое не переписывается. Записи в
// систему нет. validate сверяет отчёт с data.

const form = require('./report.js');

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const safeUrl=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!/[\u0000-\u0020\u007f]/.test(value);}catch{return false;}};
const link = (text, url) => (safeUrl(url) ? `<a href="${esc(url)}">${esc(text)}</a>` : esc(text));

const STYLE = `
:root{--bg:#0f1115;--panel:#171a21;--panel2:#1d212a;--line:#2b313d;--ink:#e8eaee;--muted:#9aa3b2;--acc:#63b3ed;--ok:#68d391;--warn:#f6ad55;--bad:#fc8181}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:24px 18px 60px}
h1{font-size:25px;margin:0 0 8px}
.badge{display:inline-block;border-radius:999px;padding:3px 11px;font-size:13px;font-weight:600;margin:0 0 10px}
.badge.demo{background:#3b2a12;border:1px solid var(--warn);color:var(--warn)}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 22px}
.fact{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 11px;font-size:13px;min-width:140px}
.fact b{color:var(--acc);font-size:16px;display:block}
.fact i{display:block;color:var(--muted);font-style:normal;font-size:12px;margin-top:2px}
h2{font-size:19px;margin:26px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line)}
table{width:100%;border-collapse:collapse;margin:6px 0 4px}
th,td{text-align:left;padding:9px;border-bottom:1px solid var(--line);vertical-align:top;font-size:13.5px}
th{color:var(--muted);font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.03em}
.verdict{font-weight:700}
.verdict.ok{color:var(--ok)}.verdict.error{color:var(--bad)}
h3{font-size:15px;margin:16px 0 6px}
ul{margin:6px 0 0;padding-left:18px}
li{margin:4px 0}
.empty{color:var(--muted);font-style:italic;border-left:2px solid var(--line);padding-left:9px;margin:4px 0 8px}
a{color:var(--acc);text-decoration:none}
a:hover{text-decoration:underline}
small{color:var(--muted)}
`.trim();

function verdictClass(verdict, meta) { return verdict === meta.errorLabel ? 'error' : 'ok'; }

function section(title, rows, emptyText) {
  if (!rows.length) return `<h2>${esc(title)}</h2><p class="empty">${esc(emptyText || 'Нет записей.')}</p>`;
  return `<h2>${esc(title)}</h2><ul>${rows.map(row => `<li>${row}</li>`).join('')}</ul>`;
}

// Причины строки берутся тем же правилом, что в текстовой форме, чтобы ни одна
// причина не появилась только в одной из форм.
function reasonsOf(item) {
  const lines = [];
  for (const field of item.unreadFields || []) lines.push(`Не удалось прочитать поле «${field}».`);
  for (const field of item.failedFields || []) {
    lines.push(`Бизнес-поле ${field.label || field.fieldId} (${field.fieldId}): ${field.requirement} — ${field.status}; значение: ${field.value ?? 'нечитаемо'}.`);
  }
  for (const rule of item.failedRules || []) {
    lines.push(`Правило поля «${rule.field}» ${rule.ruleId}: ${rule.status} — ${rule.note || rule.basis || 'основание не названо'}.`);
  }
  for (const finding of item.securityFindings || []) {
    lines.push(`Попытка вмешательства: ${finding.category} — «${finding.quote}» (${finding.place}).`);
  }
  if (item.securityViolation && !(item.securityFindings || []).length) {
    lines.push('Попытка вмешательства зафиксирована без места: ручная проверка безопасности.');
  }
  return lines;
}

function render(data, params) {
  form.check(data);
  const m = data.meta, c = data.counters;
  const out = [];
  out.push('<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push(`<title>Отчёт валидации CR — ${esc(m.runDate)}</title><style>${STYLE}</style></head><body><div class="wrap">`);
  out.push(`<h1>Отчёт валидации CR — ${esc(m.runDate)}</h1>`);
  if (m.demo) out.push('<span class="badge demo">ДАННЫЕ ДЕМО: прогон выполнен на вымышленных данных</span><br>');
  out.push('<div class="facts">');
  out.push(`<div class="fact"><b>${c.total}</b><i>обработано CR</i></div>`);
  out.push(`<div class="fact"><b>${c.okCount}</b><i>${esc(m.okLabel)}</i></div>`);
  out.push(`<div class="fact"><b>${c.errorCount}</b><i>${esc(m.errorLabel)}</i></div>`);
  out.push(`<div class="fact"><b>${c.securityViolationCount}</b><i>попыток вмешательства</i></div>`);
  out.push(`<div class="fact"><b>${c.unreadableCount}</b><i>нечитаемых</i></div>`);
  out.push('</div>');
  if (m.issueKey) out.push(`<p><small>Обрабатывался CR ${esc(m.issueKey)}; иначе — вся выборка.</small></p>`);

  out.push('<h2>Результаты по CR</h2>');
  if (!data.items.length) out.push('<p class="empty">Нет записей: выборка пуста.</p>');
  else {
    out.push('<table><tr><th>CR</th><th>Исход</th></tr>');
    for (const item of data.items) {
      out.push(`<tr><td>${link(item.key, item.url)}<br><small>${esc(item.summary)}</small></td>`);
      out.push(`<td class="verdict ${verdictClass(item.verdict, m)}">${esc(item.verdict)}</td></tr>`);
    }
    out.push('</table>');
  }

  out.push('<h2>Причины по CR</h2>');
  let reasonsAny = false;
  for (const item of data.items) {
    const lines = reasonsOf(item);
    if (!lines.length) continue;
    reasonsAny = true;
    out.push(`<h3>${link(item.key, item.url)}</h3><ul>${lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul>`);
  }
  if (!reasonsAny) out.push('<p class="empty">Нет записей: замечаний не обнаружено.</p>');

  const unverified = data.unverified.map(row => `${link(row.key, row.url)}: ${esc(row.reason)}`).concat(data.items.filter(item=>(item.unreadFields||[]).length).map(item=>`${link(item.key,item.url)}: не удалось прочитать ${item.unreadFields.map(esc).join(', ')}`));
  out.push(section('Проверить не удалось', unverified));
  const excluded = data.excluded.map(row => `${link(row.key, row.url)}: ${esc(row.reason)}`);
  out.push(section('Исключены', excluded));
  const notes = data.notes.map(note => esc(note));
  out.push(section('Оговорки', notes));
  out.push(`</div></body></html>`);
  return out.join('\n');
}

function validate(text, data, params) {
  form.check(data);
  for (const item of data.items) {
    if (!text.includes(item.key)) throw new Error(`В отчёте нет ключа ${item.key}`);
    if (!text.includes(item.verdict)) throw new Error(`В отчёте нет исхода ${item.verdict} для ${item.key}`);
  }
  for (const row of data.unverified) if (!text.includes(row.key)) throw new Error(`В отчёте нет непроверенного ключа ${row.key}`);
  const c = data.counters;
  if (!text.includes(String(c.total))) throw new Error(`В отчёте нет числа ${c.total} из сводки`);
  if (data.meta.demo && !text.includes('ДАННЫЕ ДЕМО')) throw new Error('В демо-отчёте нет пометки «ДАННЫЕ ДЕМО»');
  return true;
}

module.exports = { render, validate };

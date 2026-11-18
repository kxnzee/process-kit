'use strict';
// Вторая форма того же отчёта — одностраничник в стиле примеров из about/examples.
// Содержимое здесь не переписывается: HTML собирается из текста report.js, поэтому формы
// не разъедутся — правка формулировки в правиле или в markdown-форме видна сразу в обеих.
const form = require('./report.js');

const STYLE = `
:root{--bg:#0f1115;--panel:#171a21;--panel2:#1d212a;--line:#2b313d;--ink:#e8eaee;--muted:#9aa3b2;--acc:#63b3ed;--ok:#68d391;--warn:#f6ad55;--dim:#5d6675}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:22px 18px 60px}
header h1{font-size:26px;margin:0 0 6px}
header p{color:var(--muted);margin:0 0 6px;font-size:14px}
.badge{display:inline-block;background:#3b2a12;border:1px solid var(--warn);color:var(--warn);border-radius:999px;padding:3px 11px;font-size:13px;font-weight:600;margin:0 0 8px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 22px;position:sticky;top:0;background:var(--bg);padding:10px 0;z-index:5;border-bottom:1px solid var(--line)}
nav button{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-size:14px;cursor:pointer}
nav button[aria-current="true"]{background:var(--acc);color:#0b1220;border-color:var(--acc);font-weight:600}
nav button .n{color:var(--muted);font-weight:400}
nav button[aria-current="true"] .n{color:#0b1220}
section{display:none}
section.on{display:block}
h2{font-size:20px;margin:4px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
p{margin:8px 0}
.small,p.small{color:var(--muted);font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 6px}
.chip{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 11px;font-size:13px;min-width:150px}
.chip b{color:var(--acc);font-size:16px;display:block}
.chip i{display:block;color:var(--muted);font-style:normal;font-size:12px;margin-top:2px}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;margin:6px 0 4px}
th,td{text-align:left;padding:8px 9px;border-bottom:1px solid var(--line);vertical-align:top;font-size:13.5px}
th{color:var(--muted);font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.03em}
td:first-child,th:first-child{white-space:nowrap}
ul{margin:6px 0 0;padding-left:20px}
li{margin:4px 0}
.lead{color:var(--ink);font-weight:600;margin:18px 0 4px;border-top:1px solid var(--line);padding-top:12px}
code{background:#11151c;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:13px}
.tag{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.tag.ok{color:var(--ok);border-color:#2f6b4a}
.tag.mid{color:var(--acc);border-color:#3f6f9e}
.tag.low{color:var(--warn);border-color:#7a5c2a}
.dim{color:var(--dim)}
a.mail{display:inline-block;background:var(--panel2);border:1px solid var(--acc);color:var(--acc);border-radius:6px;padding:3px 10px;font-size:13px;text-decoration:none;font-weight:600}
a.mail+a.mail{margin-left:6px}
a.mail:hover{background:var(--acc);color:#0b1220}
footer{color:var(--dim);font-size:13px;margin-top:26px;border-top:1px solid var(--line);padding-top:10px}
`.trim();

const SCRIPT = `
(function(){
  var nav=document.querySelector('nav');
  nav.addEventListener('click',function(e){
    var b=e.target.closest('button');
    if(!b){return;}
    nav.querySelectorAll('button').forEach(function(x){x.removeAttribute('aria-current');});
    b.setAttribute('aria-current','true');
    document.querySelectorAll('section').forEach(function(s){s.classList.remove('on');});
    document.getElementById(b.dataset.go).classList.add('on');
    window.scrollTo({top:0,behavior:'smooth'});
  });
})();
`.trim();

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = value => esc(value).replace(/"/g, '&quot;');
const inline = text => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
// Статус в сводной таблице печатается как «A — ниже цели»: букву оценки отдаём цветом,
// текст остаётся текстом — класс выбирается по самой букве, а не по догадке о строке.
const statusTag = text => {
  const grade = (String(text).match(/^([A-E]) — /) || [])[1];
  return grade ? `<span class="tag ${'AB'.includes(grade) ? 'ok' : grade === 'C' ? 'mid' : 'low'}">${inline(text)}</span>` : inline(text);
};

const cells = line => line.replace(/^\||\|$/g, '').split('|').map(part => part.trim());
const isRule = line => /^\|[\s|:-]+\|$/.test(line);
const filled = row => row.every(cell => cell && cell !== '—');

// Первая таблица отчёта — всегда «Цифры кластера» (порядок разделов закреплён в форме):
// одна строка на несколько коротких колонок читается карточками, как в примерах. Любая
// остальная одиночная строка (например, одна строка расхождения) остаётся таблицей —
// иначе перечень притворился бы набором цифр периметра.
function tableHtml(rows, first) {
  const body = rows.filter(line => !isRule(line)).map(cells);
  const head = body.shift() || [];
  if (first && body.length === 1 && filled(head) && filled(body[0])) {
    return {
      html: `<div class="chips">${head.map((label, index) => `<div class="chip"><b>${inline(body[0][index])}</b><i>${inline(label)}</i></div>`).join('')}</div>`,
      items: head.length
    };
  }
  const last = head.length - 1;
  return {
    html: `<div class="scroll"><table><thead><tr>${head.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`
      + `<tbody>${body.map(row => `<tr>${row.map((cell, index) => `<td>${index === last ? statusTag(cell) : inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
    items: body.filter(row => row.some(cell => cell && cell !== '—')).length
  };
}

function paragraph(line) {
  const badge = line.match(/^\*\*(.+)\*\*$/);
  if (badge) return { html: `<p class="badge">${esc(badge[1])}</p>`, items: 0 };
  const lead = line.match(/^\*\*.+\*\*/);
  return { html: `<p${lead ? ' class="lead"' : ''}>${inline(line)}</p>`, items: lead ? 1 : 0 };
}

// Разбирает ровно тот набор блоков, который печатает report.js: #, ##, списки «- »,
// таблицы и абзацы. Новый блок в markdown-форме требует случая здесь — иначе он молча
// вышел бы текстом абзаца, поэтому неизвестную строку лучше увидеть на самопроверке.
function split(markdown) {
  const doc = { title: '', intro: [], sections: [] };
  let target = doc.intro, list = null, rows = null, tables = 0;
  const push = html => { target.push(typeof html === 'string' ? { html, items: 1 } : html); };
  const closeList = () => {
    if (!list) return;
    push({ html: `<ul>${list.map(item => `<li>${item}</li>`).join('')}</ul>`, items: list.length });
    list = null;
  };
  const closeTable = () => { if (rows) { push(tableHtml(rows, tables++ === 0)); rows = null; } };
  for (const raw of String(markdown).replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { closeList(); closeTable(); continue; }
    if (line.startsWith('# ')) { closeList(); closeTable(); doc.title = line.slice(2); continue; }
    if (line.startsWith('## ')) { closeList(); closeTable(); target = []; doc.sections.push({ title: line.slice(3), parts: target }); continue; }
    if (line.startsWith('- ')) { closeTable(); (list || (list = [])).push(inline(line.slice(2))); continue; }
    if (line.startsWith('|')) { closeList(); (rows || (rows = [])).push(line); continue; }
    closeList(); closeTable(); push(paragraph(line));
  }
  closeList(); closeTable();
  return doc;
}

// Письмо сотруднику — черновик под каждым блоком раздела персональных рекомендаций. В письмо
// попадают только формулировки «что сделать»: баллов, степеней улучшения и оценок здесь нет,
// их человек читает на странице. Ссылка есть только у подтверждённого адреса (номер учётной
// записи из задач совпал с номером в почтовом справочнике); остальным пишется причина.
const LETTER_SECTION = /Что делать каждому/;
const spaces = value => String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();

function letterHref(person, address = person.email) {
  const actions = (person.levers || []).map(lever => lever.text);
  const body = [
    'Добрый день!', '',
    'Собрали персональные точки роста по итогам оценки — что сделать в первую очередь:', '',
    ...(actions.length ? actions : [person.recommendation]).map(text => `- ${text}`)
  ].join('\r\n');
  // Тема без ФИО и без названия инструмента: письмо уходит адресату лично, а план шире одного
  // GigaCode — в нём обучение, навыки и метрики.
  const subject = encodeURIComponent('Точки роста по итогам оценки: что сделать');
  const email = String(address || '');
  if (!email.isWellFormed()) throw new Error('Адрес письма: некорректная строка Unicode');
  const recipient = encodeURIComponent(email).replace(/%40/g, '@');
  return `mailto:${recipient}?subject=${subject}&body=${encodeURIComponent(body)}`;
}

// Раздел собирает report.js: блок человека начинается абзацем «**N. ФИО** — …», следом идёт
// список действий. Ссылка ставится сразу за этим списком — ровно под тем текстом, который
// уходит в письме. Номер блока и ФИО сверяются с данными: без совпадения ссылки нет, потому что
// письмо не имеет права уйти не тому человеку.
const optionLabel = one => [spaces(one.post), spaces(one.org)].filter(Boolean).join(', ') || spaces(one.email);

function withLetters(section, people) {
  if (!LETTER_SECTION.test(section.title) || !people.length) return section.parts;
  const byOrdinal = new Map(people.map(row => [row.ordinal, row]));
  const out = [];
  let block = null;
  for (const part of section.parts) {
    out.push(part);
    const head = String(part.html).match(/^<p class="lead"><strong>(\d+)\.\s([^<]*)<\/strong>/);
    if (head) {
      const row = byOrdinal.get(Number(head[1]));
      block = row && spaces(row.who) === spaces(head[2]) ? row : null;
      continue;
    }
    if (block && /^<(ul|p)[ >]/.test(part.html)) {
      const options = (block.letterOptions || []).filter(one => one && one.email).slice(0, 3);
      let letter;
      if (block.email) letter = `<a class="mail" href="${attr(letterHref(block, block.email))}">Письмо сотруднику</a>`;
      else if (options.length >= 2) {
        // Две-три живые записи на одно ФИО, различить которые нечем: кнопку на каждую запись,
        // с должностью и отделом. Выбирать должен человек, а не процесс.
        const crowded = new Set(options.map(optionLabel)).size < options.length;
        letter = 'адресатов несколько, выберите: ' + options.map(one => `<a class="mail" href="${attr(letterHref(block, one.email))}">Письмо сотруднику — ${esc(optionLabel(one))}${crowded ? ' · ' + esc(one.email) : ''}</a>`).join(' ');
      } else if (options.length === 1) {
        letter = `<a class="mail" href="${attr(letterHref(block, options[0].email))}">Письмо сотруднику — ${esc(optionLabel(options[0]))}</a>`;
      } else letter = `<span class="dim">письмо не создаём: ${esc(block.letterReason || 'адреса нет в почтовом справочнике')}</span>`;
      out.push({ html: `<p class="small">${letter}</p>`, items: 0 });
      block = null;
    }
  }
  return out;
}

function render(data, params) {
  const doc = split(form.render(data, params));
  const intro = doc.intro.map(part => part.html).join('\n');
  const people = (data && data.people) || [];
  const tabs = doc.sections.map((section, index) => {
    const parts = withLetters(section, people);
    const items = parts.reduce((sum, part) => sum + part.items, 0);
    const n = items ? ` <span class="n">${items}</span>` : '';
    return { id: `s${index + 1}`, title: section.title, items, button: `<button data-go="s${index + 1}"${index ? '' : ' aria-current="true"'}>${esc(section.title)}${n}</button>`, parts };
  });
  const source = data.meta && data.meta.source ? data.meta.source.file : '';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>
${STYLE}
</style>
</head>
<body>
<div class="wrap">
<header>
<h1>${esc(doc.title)}</h1>
${intro}
</header>
<nav>
${tabs.map(tab => tab.button).join('\n')}
</nav>
${tabs.map((tab, index) => `<section id="${tab.id}"${index ? '' : ' class="on"'}>\n<h2>${esc(tab.title)}</h2>\n${tab.parts.map(part => part.html).join('\n')}\n</section>`).join('\n')}
<footer>Файл собран прогоном процесса gmi-cluster-report; тот же текст — в markdown-форме прогона. Числа из выгрузки, пересчёт блоков — правило процесса.</footer>
</div>
<script>
${SCRIPT}
</script>
</body>
</html>
`;
}

function validate(text, data, params) {
  if (String(text).replace(/\r\n/g, '\n').trim() !== render(data, params).trim()) {
    throw new Error('HTML-форма не соответствует данным и форме процесса: используйте штатное формирование');
  }
}

module.exports = { render, validate };

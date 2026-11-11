'use strict';
// Вторая форма того же отчёта — одностраничник в стиле примеров из about/examples.
// Содержимое здесь не переписывается: HTML собирается из текста report.js, поэтому формы
// не разъедутся — правку формулировки видно сразу в обеих. Различается только оболочка:
// имя ИТ-услуги печатается один раз отдельной колонкой (в markdown оно напечатано дважды —
// по одному разу в каждой колонке), блоки ячейки становятся абзацами и списками, а ссылки
// markdown становятся ссылками.
const form = require('./report.js');

const STYLE = `
:root{--bg:#0f1115;--panel:#171a21;--panel2:#1d212a;--line:#2b313d;--ink:#e8eaee;--muted:#9aa3b2;--acc:#63b3ed;--ok:#68d391;--warn:#f6ad55;--dim:#5d6675}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding:22px 18px 60px}
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
.facts{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 6px}
.fact{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 11px;font-size:13px;min-width:150px}
.fact b{color:var(--acc);font-size:16px;display:block}
.fact i{display:block;color:var(--muted);font-style:normal;font-size:12px;margin-top:2px}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;margin:6px 0 4px}
th,td{text-align:left;padding:9px;border-bottom:1px solid var(--line);vertical-align:top;font-size:13.5px}
th{color:var(--muted);font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.03em}
td{width:50%}
td+td{border-left:1px solid var(--line)}
ul{margin:6px 0 0;padding-left:18px}
li{margin:4px 0}
p.svc{font-size:14.5px;font-weight:700;margin:0 0 6px}
p.item{margin:3px 0}
p.ke{color:var(--muted);font-size:12.5px;margin:2px 0 6px}
p.rel{margin:2px 0 6px;font-weight:600}
p.none{color:var(--muted);font-style:italic;border-left:2px solid var(--line);padding-left:9px;margin:4px 0 8px}
code{background:#11151c;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:13px}
a{color:var(--acc);text-decoration:none}
a:hover{text-decoration:underline}
.lead{color:var(--ink);font-weight:600;margin:18px 0 4px;border-top:1px solid var(--line);padding-top:12px}
footer{color:var(--dim);font-size:13px;margin-top:26px;border-top:1px solid var(--line);padding-top:10px}
@media(max-width:900px){td{width:auto}td+td{border-left:0}}
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

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = text => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
// Ссылка ищется сканером со счётом вложенности: заголовки релизов и задач печатаются дословно и
// содержат свои скобки («[ВСКМ] 2026-4-11-14», «[IRBIS][SELFSERVICE_ACSBAR_CBR]»), из-за чего
// плоский шаблон ссылку пропускает и адрес остаётся в странице текстом.
function links(text) {
  const source = String(text);
  let out = '', at = 0;
  while (at < source.length) {
    const open = source.indexOf('[', at);
    if (open < 0) { out += inline(source.slice(at)); break; }
    out += inline(source.slice(at, open));
    let depth = 1, close = open + 1;
    while (close < source.length && depth > 0) {
      if (source[close] === '[') depth++;
      else if (source[close] === ']') depth--;
      close++;
    }
    const found = depth === 0 ? /^\((https?:\/\/[^)\s]+)\)/.exec(source.slice(close)) : null;
    if (!found) { out += inline('['); at = open + 1; continue; }
    out += `<a href="${esc(found[1])}" target="_blank" rel="noreferrer">${inline(source.slice(open + 1, close - 1))}</a>`;
    at = close + found[0].length;
  }
  return out;
}
// Жирная строка релиза печатается как «**[ключ «название» — статус](ссылка)**»: выделение
// снимается до разбора ссылок, иначе звёздочки остались бы разнесёнными по обе стороны ссылки.
function rich(text) {
  const wrapped = /^\*\*([^*].*?)\*\*$/.exec(String(text));
  return wrapped ? `<strong>${links(wrapped[1])}</strong>` : links(text);
}

const cellsOf = line => line.replace(/^\||\|$/g, '').split('|').map(part => part.trim());
const isRule = line => /^\|[\s|:-]+\|$/.test(line);

// Три подписи вместо инфоповодов и строка пустой выборки печатаются основанием вместо
// списка: в странице они остаются приглушённой строкой с чертой, чтобы не читались как
// настоящий инфоповод.
const REASONS = [
  /^Нет релиза этой ИТ-услуги в окне$/,
  /^Нет инфоповодов/,
  /^Технический релиз/,
  /^Состав релиза прочитан не полностью/,
  /^Нет релизов в окнах$/
];

// Разбирает ровно те блоки, которые печатает cellText(): переносы <br>, имя ИТ-услуги жирной
// первой строкой, «ИТ-услуги релиза:», «КЭ:», строку релиза, задачи строками с «•» и подписи
// вместо инфоповодов — как в текстовой форме прогона. Неизвестный блок выходит
// абзацем и остаётся видимым: содержимое не теряется ни при каком раскладе.
function blocks(text) {
  const fragments = String(text).split('<br>').map(part => part.trim()).filter(Boolean);
  return fragments.map((fragment, index) => {
    let html;
    if (index === 0 && /^\*\*.+\*\*$/.test(fragment)) html = `<p class="svc">${rich(fragment)}</p>`;
    else if (/^ИТ-услуги релиза:/.test(fragment)) html = `<p class="small">${rich(fragment)}</p>`;
    else if (/^КЭ:/.test(fragment)) html = `<p class="ke">${rich(fragment)}</p>`;
    else if (/^\*\*.+\*\*$/.test(fragment)) html = `<p class="rel">${rich(fragment)}</p>`;
    else if (/^[•-]\s/.test(fragment)) html = `<p class="item">${rich(fragment)}</p>`;
    else if (REASONS.some(test => test.test(fragment))) html = `<p class="none">${rich(fragment)}</p>`;
    else html = `<p>${rich(fragment)}</p>`;
    return { html, items: 1 };
  });
}

// Таблица страницы повторяет текстовую форму: две колонки окон, имя ИТ-услуги
// жирной первой строкой каждой ячейки, КЭ строкой ниже, релиз жирной ссылкой, задачи строками
// с «•». Между колонками ничего не переносится и не сворачивается: читатель сверяет обе формы
// прогона построчно.
function table(rows) {
  const body = rows.filter(line => !isRule(line)).map(cellsOf);
  const head = body.shift() || [];
  return {
    html: `<div class="scroll"><table><thead><tr>${head.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`
      + `<tbody>${body.map(row => `<tr>${row.map(cell => `<td>${blocks(cell).map(part => part.html).join('\n')}</td>`).join('')}</tr>`).join('\n')}</tbody></table></div>`,
    items: body.length
  };
}

function paragraph(line) {
  if (/^\*\*(.+)\*\*$/.test(line)) return { html: `<p class="badge">${esc(line.slice(2, -2))}</p>`, items: 0 };
  // Строка счётчиков («Бизнес задач: 3 · Технических задач: 2 · …») — единственная, где
  // текст разбит на пары «подпись: число»; карточки только меняют её представление.
  if (/^Бизнес задач:.*\s·\s/.test(line)) {
    const cards = line.split(' · ').map(part => {
      const [label, ...value] = part.split(': ');
      return `<div class="fact"><b>${inline(value.join(': ') || '—')}</b><i>${inline(label)}</i></div>`;
    });
    return { html: `<div class="facts">${cards.join('')}</div>`, items: cards.length };
  }
  if (/^Релизы:|^только технические/.test(line)) return { html: `<p class="small">${rich(line)}</p>`, items: 1 };
  const lead = /^\*\*.+\*\*/.test(line);
  return { html: `<p${lead ? ' class="lead"' : ''}>${rich(line)}</p>`, items: lead ? 1 : 0 };
}

// Разбирает ровно тот набор блоков, который печатает report.js: #, ##, списки «- », таблицу
// и абзацы. Главная таблица открывает первый раздел страницы — иначе она осталась бы над
// навигацией и её пришлось бы искать прокруткой. Новый блок в markdown-форме требует случая
// здесь, поэтому неизвестную строку лучше увидеть на самопроверке, чем молча отдать текстом.
function split(markdown) {
  const doc = { title: '', intro: [], sections: [] };
  let target = doc.intro, list = null, rows = null;
  const push = part => { target.push(typeof part === 'string' ? { html: part, items: 1 } : part); };
  const closeList = () => {
    if (!list) return;
    push({ html: `<ul>${list.map(item => `<li>${rich(item)}</li>`).join('')}</ul>`, items: list.length });
    list = null;
  };
  const closeTable = () => { if (rows) { push(table(rows)); rows = null; } };
  for (const raw of String(markdown).replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { closeList(); closeTable(); continue; }
    if (line.startsWith('# ')) { closeList(); closeTable(); doc.title = line.slice(2); continue; }
    if (line.startsWith('## ')) { closeList(); closeTable(); target = []; doc.sections.push({ title: line.slice(3), parts: target }); continue; }
    if (line.startsWith('- ')) { closeTable(); (list || (list = [])).push(line.slice(2)); continue; }
    if (line.startsWith('|')) {
      closeList();
      // Первая таблица открывает свой раздел: сводная таблица над навигацией превратила бы
      // страницу в простыню, по которой надо листать вниз, чтобы добраться до остальных разделов.
      if (!doc.sections.length && doc.intro.length) { target = []; doc.sections.push({ title: doc.title, parts: target }); }
      (rows || (rows = [])).push(line);
      continue;
    }
    closeList(); closeTable(); push(paragraph(line));
  }
  closeList(); closeTable();
  return doc;
}

function render(data) {
  const doc = split(form.render(data));
  const intro = doc.intro.map(part => part.html).join('\n');
  const panels = doc.sections.map((section, index) => {
    const items = section.parts.reduce((total, part) => total + part.items, 0);
    const count = items ? ` <span class="n">${items}</span>` : '';
    const heading = section.title === doc.title ? '' : `<h2>${esc(section.title)}</h2>`;
    return {
      id: `s${index + 1}`,
      button: `<button data-go="s${index + 1}"${index ? '' : ' aria-current="true"'}>${esc(section.title)}${count}</button>`,
      body: `${heading}\n${section.parts.map(part => part.html).join('\n')}`
    };
  });
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
${panels.map(panel => panel.button).join('\n')}
</nav>
${panels.map(panel => `<section id="${panel.id}"${panel.id === 's1' ? ' class="on"' : ''}>\n${panel.body}\n</section>`).join('\n')}
<footer>Файл собран прогоном процесса info-povod; тот же текст — в markdown-форме прогона. Релизы и задачи читались из выбранных подключений Jira, класс задачи — шаг классификации.</footer>
</div>
<script>
${SCRIPT}
</script>
</body>
</html>
`;
}

function validate(text, data) {
  if (String(text).replace(/\r\n/g, '\n').trim() !== render(data).trim()) {
    throw new Error('HTML-форма не соответствует данным и форме процесса: используйте штатное формирование');
  }
}

module.exports = { render, validate };

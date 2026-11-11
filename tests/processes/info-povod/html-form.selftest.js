'use strict';
// Проверка второй формы отчёта «Инфо-поводы»: html-страница собирается из текста markdown-формы
// и не имеет права ни потерять, ни придумать содержимое. Проверяется парность ссылок, состав
// разделов, пустая выборка и то, что правка страницы руками не проходит проверку.
const { fs, path, assert, cwd, source, check, close } = (() => {
  const ctx = require('../../fixture')();
  return { ...ctx, cwd: ctx.tmp };
})();
const rules = require('../../../processes/info-povod/rules/info-povod');
const form = require('../../../processes/info-povod/renderers/report');
const page = require('../../../processes/info-povod/renderers/report-html');

const PROCESS = 'info-povod';
const fx = JSON.parse(fs.readFileSync(path.join(source, `processes/${PROCESS}/fixture.json`), 'utf8'));

// Классификацию пишет шаг-агент, в фикстуре её нет: строки собираются по составу релизов.
const PLAN = {
  'DEMO-601': { cls: 'contained', agreement: 'reasoned' },
  'DEMO-602': { cls: 'technical', agreement: 'confirmed', rules: ['T-SEC-01'] },
  'DEMO-603': { cls: 'contained', agreement: 'reasoned' },
  'DEMO-604': { cls: 'unknown', agreement: 'question', question: 'что именно меняется у читателя в этой задаче?' },
  'DEMO-606': { cls: 'contained', agreement: 'reasoned' }
};

function classifiedFrom(selection, plan) {
  const items = [];
  for (const release of selection.records) {
    for (const member of release.members || []) {
      const row = plan[member.key] || { cls: 'contained', agreement: 'reasoned' };
      items.push({
        key: member.key, release: release.key, classification: row.cls, subtype: null,
        basis: row.cls === 'unknown' ? null : member.summary,
        understanding: `что меняется у читателя по задаче ${member.key}`,
        rulesMatched: row.rules || [], ruleId: (row.rules || [])[0] || null,
        agreement: row.agreement, noDescription: false,
        question: row.question === undefined ? null : row.question,
        material: { read: [`заголовок задачи ${member.key}`], unread: [] }
      });
    }
  }
  const count = cls => items.filter(item => item.classification === cls).length;
  const byAgreement = {};
  for (const item of items) byAgreement[item.agreement] = (byAgreement[item.agreement] || 0) + 1;
  for (const status of ['confirmed', 'reasoned', 'conflict', 'weak', 'question']) if (!byAgreement[status]) byAgreement[status] = 0;
  return {
    policyFile: 'actions/classify-issuance/POLICY.md',
    rulesFile: 'actions/classify-issuance/rules/classify-issuance.md',
    mode: 'demo', store: 'demo-tasks', relatedDepth: 1, commentsLimit: 20,
    releaseCount: selection.records.length,
    byClass: { total: items.length, contained: count('contained'), technical: count('technical'), unknown: count('unknown') },
    byAgreement,
    conflicts: [], weak: [], questions: items.filter(item => item.agreement === 'question').map(item => item.key),
    compositionUnread: [], rulesGaps: [], understandingInsufficient: false, understandingInsufficientReason: null,
    items
  };
}

const assess = (selection, classified) => rules.evaluate({ releases_demo: selection, classified_demo: classified }, fx.parameters);
const data = assess(structuredClone(fx.result), classifiedFrom(fx.result, PLAN));
form.validate(form.render(data), data);

// Ссылку в markdown ищет сканер со счётом вложенности: заголовок релиза печатается дословно и
// содержит свои скобки («[ВСКМ] 2026-4-11-14»), а плоский шаблон на такой строке ссылку не
// видит — проверка с плоским шаблоном пропустила бы адрес задачи текстом на странице.
function scanMarkdownLinks(text) {
  const source = String(text), found = [];
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf('[', at);
    if (open < 0) break;
    let depth = 1, close = open + 1;
    while (close < source.length && depth > 0) {
      if (source[close] === '[') depth++;
      else if (source[close] === ']') depth--;
      close++;
    }
    const url = depth === 0 ? /^\((https?:\/\/[^)\s]+)\)/.exec(source.slice(close)) : null;
    if (!url) { at = open + 1; continue; }
    found.push({ label: source.slice(open + 1, close - 1), url: url[1].replace(/&amp;/g, '&'), start: open, end: close + url[0].length });
    at = close + url[0].length;
  }
  return found;
}
const mdUrls = text => scanMarkdownLinks(text).map(link => link.url);
function stripMdLinks(text) {
  const source = String(text);
  let plain = '', at = 0;
  for (const link of scanMarkdownLinks(source)) { plain += source.slice(at, link.start) + link.label; at = link.end; }
  return plain + source.slice(at);
}

// Видимый текст форм: разметка обеих форм своя, а слова обязаны совпасть. Каждая строка
// markdown-формы должна найтись в тексте страницы — иначе форма что-то потеряла.
function visible(markdown) {
  const plain = String(markdown).replace(/^#+\s*/gm, '').replace(/\*\*/g, '');
  return stripMdLinks(plain)
    .split('\n').flatMap(line => line.startsWith('|') ? line.split('|') : [line])
    .flatMap(line => line.split('<br>'))
    .map(line => line.replace(/^[-•]\s*/, '').trim()).filter(line => line && !/^[-:]+$/.test(line));
}
function text(html) {
  const decoded = String(html)
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:a|strong|b|em|i|code|span)[^>]*>/gi, '')
    .replace(/<\/(p|li|tr|td|th|div|section|header|footer)>/g, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return decoded.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const norm = line => line.replace(/\s+/g, ' ').trim();
const flatten = lines => lines.map(norm).join(' ');

try {
  const markdown = form.render(data), html = page.render(data);

  check('страница самостоятельная и проходит своей проверке', () => {
    page.validate(html, data);
    assert.ok(html.startsWith('<!doctype html>') && html.includes('</script>'), 'стили и переключение разделов должны быть внутри файла');
    assert.ok(!html.includes('<link') && !html.includes('src='), 'страница тянет что-то извне');
    assert.ok(!/\{\{[^{}]*\}\}/.test(html), 'в страницу попала незаполненная переменная формы');
    assert.ok(!/&lt;br&gt;/.test(html), 'перенос ячейки вышел текстом вместо разметки');
    assert.ok(!html.includes('](http'), 'в странице осталась ссылка текстом markdown');
    assert.ok(!/\*\*/.test(html), 'в странице осталось неразведённое **выделение**');
  });

  check('правка страницы руками не проходит проверку', () => {
    assert.throws(() => page.validate(`${html}\n<p>правка вручную</p>`, data), /штатное формирование/);
    assert.throws(() => page.validate(html.replace(/<b>[^<]*<\/b>/, '<b>99</b>'), data), /штатное формирование/);
  });

  check('разделы страницы — таблица инфоповодов и разделы формы, в том же порядке', () => {
    const expected = [data.meta.reportTitle, ...[...markdown.matchAll(/^## (.+)$/gm)].map(match => match[1])];
    assert.deepEqual([...html.matchAll(/<button data-go="s\d+"[^>]*>([^<]+)/g)].map(match => match[1].trim()), expected);
    assert.equal((html.match(/<button data-go=/g) || []).length, expected.length, 'кнопок навигации не по числу разделов');
    assert.equal((html.match(/<section id=/g) || []).length, expected.length);
  });

  check('каждая строка markdown-формы осталась в тексте страницы', () => {
    const pageText = flatten(text(html));
    const missing = visible(markdown).filter(line => !pageText.includes(norm(line)) && !line.startsWith('Бизнес задач:'));
    assert.deepEqual(missing, [], 'этих строк нет в странице');
    const cards = markdown.match(/^Бизнес задач:.*$/m)[0].split(' · ');
    assert.equal((html.match(/class="fact"/g) || []).length, cards.length, 'карточек счётчика не по числу значений');
    for (const part of cards) {
      const [label, ...value] = part.split(': ');
      assert.ok(pageText.includes(norm(label)), `подпись счётчика потеряна: ${part}`);
      assert.ok(pageText.includes(norm(value.join(': '))), `значение счётчика потеряно: ${part}`);
    }
  });

  check('ссылок столько же, и все они ведут на адреса из данных', () => {
    const inMarkdown = mdUrls(markdown);
    const inPage = [...html.matchAll(/<a href="([^"]+)"/g)].map(match => match[1].replace(/&amp;/g, '&'));
    assert.ok(inMarkdown.length > 5, `слишком короткая выборка для проверки ссылок: ${inMarkdown.length}`);
    assert.equal(inPage.length, inMarkdown.length, 'число ссылок разошлось с markdown-формой');
    for (const url of inPage) assert.ok(inMarkdown.includes(url), `ссылка ведёт не на адрес задачи: ${url}`);
  });

  // Название релиза печатается дословно и в работе содержит свои скобки
  // («[ВСКМ] 2026-4-11-14»): ровно на такой ссылке форма и спотыкалась, отдавая адрес текстом.
  check('название релиза со своими скобками остаётся ссылкой', () => {
    const bracketed = structuredClone(data);
    const row = bracketed.keGroups.flatMap(group => [...group.current, ...group.plan]).find(item => item.url);
    row.heading = `Релиз: ${row.key} «[ТЕСТ][СКЕЙП] название со скобками» — Внедрен 09.11`;
    const bracketedHtml = page.render(bracketed);
    page.validate(bracketedHtml, bracketed);
    assert.ok(bracketedHtml.includes(`href="${row.url.replace(/&/g, '&amp;')}"`), 'релиз со скобками в названии вышел текстом без ссылки');
    assert.ok(!bracketedHtml.includes('](http'), 'адрес задачи остался в странице текстом');
    assert.ok(flatten(text(bracketedHtml)).includes(norm('[ТЕСТ][СКЕЙП] название со скобками')), 'название релиза исказилось');
  });

  check('каждый релиз, КЭ и вопрос видны на странице', () => {
    const pageText = flatten(text(html));
    const keys = new Set();
    for (const group of data.keGroups) {
      assert.ok(pageText.includes(norm(group.name)), `КЭ не попал в страницу: ${group.name}`);
      for (const row of [...group.current, ...group.plan]) {
        keys.add(row.key);
        // Форма печатает релиз без префикса «Релиз: » — он остаётся только в данных.
        const label = String(row.heading).replace(/^Релиз:\s*/, '');
        assert.ok(pageText.includes(norm(label)), `релиз не попал в страницу: ${row.key}`);
        for (const item of row.items || []) assert.ok(pageText.includes(norm(item.summary)), `задача не попала в страницу: ${item.key}`);
      }
    }
    assert.ok(keys.size >= 3, 'слишком мало релизов, чтобы проверка чего-то стоила');
    const rows = markdown.split('\n').filter(line => line.startsWith('|') && !/^\|[\s|:-]+\|$/.test(line)).length - 1;
    assert.equal((html.match(/<th>/g) || []).length, 2, 'колонок окон на странице не две');
    assert.equal((html.match(/<td/g) || []).length, rows * 2, 'ячеек не по числу строк markdown-формы');
    assert.equal((html.match(/class="svc"/g) || []).length, rows * 2, 'имя ИТ-услуги напечатано не в каждой ячейке, как в текстовой форме');
    for (const question of data.questions) assert.ok(pageText.includes(norm(question.text)), `вопрос не попал в страницу: ${question.scope}`);
  });

  check('пустая выборка остаётся таблицей со строкой «Нет релизов в окнах»', () => {
    const empty = structuredClone(data);
    empty.keGroups = [];
    empty.counters.rowCount = 0; empty.counters.rowCurrentCount = 0; empty.counters.rowPlanCount = 0;
    const blankHtml = page.render(empty);
    page.validate(blankHtml, empty);
    assert.equal((blankHtml.match(/<td/g) || []).length, 2, 'пустая выборка потеряла колонки окон');
    assert.equal((blankHtml.match(/class="none">Нет релизов в окнах</g) || []).length, 2, 'строка-подпись не в обеих колонках');
    assert.ok(!/class="svc"/.test(blankHtml), 'пустая выборка притворилась строками ИТ-услуг');
  });

  check('демо-пометка сохраняется в странице', () => {
    assert.equal(html.includes('ДАННЫЕ ДЕМО'), Boolean(data.meta.demo), 'пометка о демо разошлась с данными');
    const demo = structuredClone(data);
    demo.meta.demo = !Boolean(demo.meta.demo);
    assert.notEqual(page.render(demo).includes('ДАННЫЕ ДЕМО'), html.includes('ДАННЫЕ ДЕМО'));
  });
} finally { close(); }

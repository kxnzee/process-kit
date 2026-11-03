'use strict';
const lines = text => text.split(/\r?\n/);
function parseScalar(v) {
  v = v.trim();
  if (v === '') return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => parseScalar(s));
  }
  return v;
}

// Многострочный скаляр YAML «ключ: >» — строки с большим отступом склеиваются через пробел.
function parseFold(rows, start, indent) {
  const parts = [];
  let i = start;
  for (; i < rows.length; i++) {
    const row = rows[i];
    if (!row.trim()) continue;
    if (row.length - row.trimStart().length <= indent) break;
    parts.push(row.trim());
  }
  return { value: parts.join(' '), next: i };
}

function parseYamlBlock(rows, start, indent) {
  const obj = {};
  let i = start;
  while (i < rows.length) {
    const raw = rows[i];
    if (!raw.trim() || raw.trim().startsWith('#')) { i++; continue; }
    const ind = raw.length - raw.trimStart().length;
    if (ind < indent) break;
    const m = raw.trim().match(/^([^:]+):(.*)$/);
    if (!m) throw new Error(`неподдерживаемая строка шапки: ${raw.trim()}`);
    const key = m[1].trim();
    const rest = m[2];
    if (Object.prototype.hasOwnProperty.call(obj, key)) throw new Error(`повтор поля ${key}`);
    const fold = rest.trim().match(/^([>|])[+-]?$/);
    if (fold) {
      const block = parseFold(rows, i + 1, ind);
      obj[key] = block.value; i = block.next; continue;
    }
    if (rest.trim() !== '') { obj[key] = parseScalar(rest); i++; continue; }
    // вложенный блок
    let j = i + 1;
    while (j < rows.length && !rows[j].trim()) j++;
    if (j < rows.length) {
      const ind2 = rows[j].length - rows[j].trimStart().length;
      if (ind2 > ind && rows[j].trim().startsWith('- ')) {
        const list = [];
        while (j < rows.length) {
          const r = rows[j];
          const ri = r.length - r.trimStart().length;
          if (!r.trim()) { j++; continue; }
          if (ri < ind2 || !r.trim().startsWith('- ')) break;
          list.push(parseScalar(r.trim().slice(2)));
          j++;
        }
        obj[key] = list; i = j; continue;
      }
      if (ind2 > ind) {
        const sub = parseYamlBlock(rows, j, ind2);
        obj[key] = sub.obj; i = sub.next; continue;
      }
    }
    obj[key] = ''; i++;
  }
  return { obj, next: i };
}

function parseFrontmatter(text) {
  const rows = lines(text);
  if (rows[0] !== '---') return { data: null, body: text, bodyLine: 1 };
  const end = rows.indexOf('---', 1);
  if (end < 0) return { data: null, body: text, bodyLine: 1, error: 'шапка не закрыта строкой ---' };
  try {
    const data = parseYamlBlock(rows.slice(1, end), 0, 0).obj;
    return { data, body: rows.slice(end + 1).join('\n'), bodyLine: end + 2 };
  } catch (error) { return { data: null, body: text, bodyLine: 1, error: error.message }; }
}


module.exports = { parseFrontmatter };

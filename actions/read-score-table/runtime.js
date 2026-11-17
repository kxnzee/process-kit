'use strict';
// Чтение сводной таблицы оценок: xlsx разбирается своим кодом (архив + общий словарь строк),
// JSON-таблица читается той же формой. Шаг ничего не пересчитывает и не дополняет: пустая
// ячейка и «-» остаются null и попадают в gaps, а не в ноль.
const fs = require('node:fs'), zlib = require('node:zlib'), { isDeepStrictEqual } = require('node:util');
const { inside } = require('../../tools/lib/core/safe-path'), s = require('../../tools/lib/actions/action-support');

const COL = {
  id: 'Номер сотрудника', idAlt: 'ТН', name: 'ФИО сотрудника', initiative: 'Инициатива',
  audience: 'ЦА GigaCode', team: 'Код Команды', teamTitle: 'Команда',
  teamType: 'Тип команды', expertise: 'Область экспертизы', role: 'Основная роль',
  frequency: 'Частота использования', mode: 'Режим использования', onTime: 'Обучения в срок',
  audienceContext: 'ЦА Обучение контекст', audienceSdd: 'ЦА Обучение SDD',
  ballCourses: 'Обучения БАЛЛ', ballFrequency: 'Частота использования БАЛЛ',
  ballMode: 'Режим использования БАЛЛ', ballTraining: 'Обучение и применение БАЛЛ',
  skillsPlan: 'Skills DONE', ballSkillsPlan: 'Skills DONE БАЛЛ', ballSkillsCount: 'Skills SUM БАЛЛ',
  tokens: 'Количество токенов CLI', cohort: 'Когорта', ballTokens: 'Токены БАЛЛ', ballSkillsTotal: 'Навыки и токены БАЛЛ',
  storyTeam: 'Команда Story', storyCluster: 'Кластер Story', storyCompare: 'Story сравнение',
  ballStory: 'Story БАЛЛ', ballProdTotal: 'Продуктивность и Story БАЛЛ', total: 'Общий итог',
  p25: 'Персентиль 25', p50: 'Персентиль 50', bp: 'Оценка в БП', tribeTotal: 'TRIBE_AVG Общий итог'
};
// Без этих столбцов строку нельзя ни отличить от соседней, ни сверить со шкалой: это ошибка входа.
const REQUIRED = [COL.id, COL.team, COL.role, COL.ballTraining, COL.ballSkillsTotal, COL.ballProdTotal, COL.total];
const COURSES = [['Контекст AI-агентов', 'управление контекстом'], ['AI-driven PDLC', 'ai-driven pdlc'],
  ['SDD', 'spec-driven development'], ['Agentic Coding', 'agentic coding'], ['Введение в GigaCode', 'введение в gigacode']];
const SKILLS = ['prompting', 'prompt engineering', 'context management', 'creating tools', 'creating skills', 'agent team'];
const METRICS = ['трудоемкость', 'строки кода', 'коммиты пром', 'коммиты', 'строки кода на коммит', 'pr'];
const BLOCKS = [['Обучение', 'персентиль 50 обучение', 'рекомендация обучение'],
  ['Навыки', 'персентиль 50 навыки', 'рекомендация навыки'],
  ['Продуктивность', 'персентиль 50 продуктивность', 'рекомендация продуктивность']];

const norm = value => String(value === undefined || value === null ? '' : value).replace(/ /g, ' ').trim().toLowerCase().replace(/ё/g, 'е');
// Номер сотрудника в разных снимках выгрузки подписан по-разному («Номер сотрудникА» и «ТН»).
// Запасной заголовок подставляется только когда основного нет: оба снимка читает один код,
// и запасной столбец не попадает в список неиспользуемых.
const ALTERNATES = { [norm(COL.id)]: [norm(COL.idAlt)] };
const text = value => { const raw = String(value === undefined || value === null ? '' : value).replace(/ /g, ' ').trim(); return !raw || raw === '-' ? null : raw; };
const number = value => { const raw = text(value); if (raw === null) return null; const parsed = Number(raw.replace(/[ ]/g, '').replace(',', '.')); return Number.isFinite(parsed) ? parsed : null; };
const colIndex = letters => [...letters].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0);
const unescape = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(+code)).replace(/&amp;/g, '&');
const stringText = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(part => unescape(part[1])).join('');

function entries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Файл не похож на xlsx: архив не читается');
  let at = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0, count = buf.readUInt16LE(eocd + 10); i < count; i++) {
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.slice(start, start + size);
    out.push({ name, data: (method === 8 ? zlib.inflateRawSync(body) : body).toString('utf8') });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function fromXlsx(cwd, file) {
  const map = {};
  for (const entry of entries(fs.readFileSync(inside(cwd, file)))) map[entry.name] = entry.data;
  const strings = [];
  for (const item of (map['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g))
    strings.push(stringText(item[1]));
  const sheet = Object.keys(map).filter(name => /^xl\/worksheets\/[^/]+\.xml$/.test(name)).sort()[0];
  if (!sheet) throw new Error('В файле нет ни одного листа');
  const title = (map['xl/workbook.xml'] || '').match(/<sheet[^>]*name="([^"]*)"/);
  const rows = [];
  for (const row of map[sheet].matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const line = {};
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const address = cell[1].match(/\br="([A-Z]+)\d+"/);
      if (!address) continue;
      const type = (cell[1].match(/\bt="([^"]*)"/) || [])[1], body = cell[2] || '';
      const stored = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      line[address[1]] = type === 'inlineStr' ? stringText(body) : stored === undefined ? '' : type === 's' ? (strings[+stored] || '') : unescape(stored);
    }
    rows.push(line);
  }
  if (rows.length < 2) throw new Error('В листе нет строк данных: есть только заголовки или пусто');
  const letters = Object.keys(rows[0]).sort((a, b) => colIndex(a) - colIndex(b));
  const pick = line => letters.map(letter => line[letter] === undefined ? '' : line[letter]);
  return { format: 'xlsx', sheet: title ? title[1] : sheet, headers: pick(rows[0]), rows: rows.slice(1).map(pick) };
}

function fromJson(cwd, file) {
  const value = s.read(cwd, file);
  const matrix = Array.isArray(value) ? value : value && Array.isArray(value.rows) ? value.rows : null;
  if (!matrix) throw new Error('JSON-таблица нужна в форме {"headers": […], "rows": [[…]]} или массивом строк');
  const headerRow = Array.isArray(value.headers) && value.headers.length ? value.headers : matrix[0];
  const body = Array.isArray(value.headers) && value.headers.length ? matrix : matrix.slice(1);
  return {
    format: 'json', sheet: null, headers: headerRow.map(x => String(x === undefined ? '' : x)),
    rows: body.map(row => headerRow.map((_, index) => row && row[index] !== undefined && row[index] !== null ? String(row[index]) : ''))
  };
}

// Справочник «номер → ФИО»: номер в файле бывает без ведущего нуля, поэтому ищутся оба вида.
function nameLookup(cwd, file) {
  if (!file) return () => null;
  const raw = s.read(cwd, file);
  const map = raw && typeof raw.names === 'object' && raw.names ? raw.names : raw;
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('Справочник ФИО нужен JSON-объектом вида «номер»: «ФИО»');
  const keys = {};
  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Справочник ФИО: у записи «${key}» нет имени`);
    keys[norm(key)] = value.trim();
  }
  return id => { const bare = norm(id).replace(/^0+/, ''); return keys[norm(id)] || keys[bare] || keys[bare.padStart(8, '0')] || null; };
}

function table(cwd, params) {
  if (typeof params.scoreFile !== 'string' || !params.scoreFile) throw new Error('Нужен точный путь scoreFile с таблицей оценок');
  const source = params.scoreFile;
  const raw = /\.json$/i.test(source) ? fromJson(cwd, source) : /\.xlsx$/i.test(source) ? fromXlsx(cwd, source) : (() => { throw new Error('scoreFile: нужен файл .xlsx или .json'); })();
  const at = {}, bare = {};
  raw.headers.forEach((header, index) => { const key = norm(header); if (key && !(key in at)) at[key] = index; });
  for (const key of Object.keys(at)) { const short = key.replace(/^\d+\.\s*/, ''); if (!(short in bare)) bare[short] = at[key]; }
  for (const [name, alternates] of Object.entries(ALTERNATES)) {
    if (name in at) continue;
    const found = alternates.map(alt => at[alt]).find(index => index !== undefined);
    if (found !== undefined) at[name] = found;
  }
  const missing = REQUIRED.filter(name => !(norm(name) in at));
  if (missing.length) throw new Error(`В таблице нет обязательных столбцов: ${missing.join(', ')} — сотрудников не отличить друг от друга, а баллы блоков не сверить`);
  const gaps = {}, used = new Set(), lookup = nameLookup(cwd, params.nameFile);
  used.add(at[norm(COL.id)]);
  // ФИО и название команды свежие снимки выгрузки несут своими колонками; справочник nameFile
  // остаётся подменой для старых снимков, где этих колонок не было. Колонка помечается
  // использованной один раз и не попадает в пропуски: незаполненное ФИО — не дырка в данных.
  const nameAt = norm(COL.name) in at ? at[norm(COL.name)] : null;
  if (nameAt !== null) used.add(nameAt);
  const named = { byColumn: 0, byFile: 0 };
  const bump = label => { gaps[label] = (gaps[label] || 0) + 1; };
  const column = key => (key in at ? at[key] : null);
  const read = (row, key, numeric) => {
    if (key === null || key === undefined) return null;
    const index = typeof key === 'number' ? key : at[key];
    used.add(index);
    const parsed = numeric ? number(row[index]) : text(row[index]);
    if (parsed === null) bump(String(raw.headers[index]).trim());
    return parsed;
  };
  const textField = (row, name) => read(row, column(norm(name)), false);
  const numberField = (row, name) => read(row, column(norm(name)), true);
  const courseText = prefix => Object.keys(at).find(key => key.startsWith(prefix)) || null;
  // Отсутствие целого столбца метрики — факт о файле, а не о строке: считается один раз,
  // иначе число пропусков превратилось бы в число сотрудников.
  const absent = new Set();
  const employees = [], skipped = [];
  raw.rows.forEach((row, position) => {
    const id = text(row[at[norm(COL.id)]]);
    if (!id) { skipped.push({ row: position + 2, reason: 'в файле не заполнен номер сотрудника' }); return; }
    const courses = COURSES.map(([name, prefix]) => {
      const key = courseText(prefix);
      return key === null ? null : { name, status: read(row, key, false) };
    }).filter(Boolean);
    const skills = SKILLS.map(name => {
      const levelKey = short => short in bare ? bare[short] : null;
      const level = levelKey(name), done = levelKey(`${name} done`);
      if (level === null && done === null) return null;
      const title = level !== null ? String(raw.headers[level]).replace(/^\d+\.\s*/, '').trim() : name;
      return { name: title, level: read(row, level, true), done: read(row, done, true) };
    }).filter(Boolean);
    const metrics = METRICS.map(name => {
      const keys = { value: column(name), band: column(`${name} top bot`), toMedian: column(`${name} к медиане`), median: column(`${name} медиана`), ball: column(`${name} балл`) };
      const parts = [['top bot', 'band'], ['к медиане', 'toMedian'], ['медиана', 'median'], ['балл', 'ball'], ['', 'value']];
      const present = Object.values(keys).filter(index => index !== null);
      if (!present.length) return null;
      const title = String(raw.headers[present[0]]).trim().replace(/ (top bot|балл|медиана|к медиане)$/i, '');
      for (const [header, field] of parts) if (keys[field] === null) absent.add(`${title}: в файле нет столбца «${(name + ' ' + header).trim()}»`);
      return {
        name: title, value: read(row, keys.value, true), band: read(row, keys.band, false),
        toMedian: read(row, keys.toMedian, true), median: read(row, keys.median, true), ball: read(row, keys.ball, true)
      };
    }).filter(Boolean);
    const blocks = BLOCKS.map(([block, medianKey, recKey]) => {
      if (column(medianKey) === null && column(recKey) === null) return null;
      return { block, p50: numberField(row, medianKey), recommendation: numberField(row, recKey) };
    }).filter(Boolean);
    const inTable = nameAt === null ? null : text(row[nameAt]);
    const fullName = inTable || lookup(id);
    if (inTable) named.byColumn += 1; else if (fullName) named.byFile += 1;
    employees.push({
      id, name: fullName,
      initiative: textField(row, COL.initiative), targetAudience: textField(row, COL.audience),
      team: textField(row, COL.team), teamTitle: textField(row, COL.teamTitle), teamType: textField(row, COL.teamType),
      role: textField(row, COL.role), expertise: textField(row, COL.expertise),
      usage: { frequency: textField(row, COL.frequency), mode: textField(row, COL.mode) },
      training: {
        onTime: numberField(row, COL.onTime),
        audience: { context: textField(row, COL.audienceContext), sdd: textField(row, COL.audienceSdd) },
        courses,
        balls: {
          courses: numberField(row, COL.ballCourses), frequency: numberField(row, COL.ballFrequency),
          mode: numberField(row, COL.ballMode), total: numberField(row, COL.ballTraining)
        }
      },
      skills: {
        planReached: textField(row, COL.skillsPlan),
        doneCount: skills.filter(item => item.done === 1).length, list: skills,
        tokens: numberField(row, COL.tokens), cohort: textField(row, COL.cohort),
        balls: {
          plan: numberField(row, COL.ballSkillsPlan), count: numberField(row, COL.ballSkillsCount),
          cohort: numberField(row, COL.ballTokens), total: numberField(row, COL.ballSkillsTotal)
        }
      },
      productivity: {
        metrics,
        story: {
          team: numberField(row, COL.storyTeam), cluster: numberField(row, COL.storyCluster),
          comparison: textField(row, COL.storyCompare), ball: numberField(row, COL.ballStory)
        },
        totalBall: numberField(row, COL.ballProdTotal)
      },
      total: numberField(row, COL.total),
      percentiles: {
        p25: numberField(row, COL.p25), p50: numberField(row, COL.p50), bpScore: numberField(row, COL.bp), blocks
      },
      tribeTotal: numberField(row, COL.tribeTotal)
    });
  });
  for (const label of absent) bump(label);
  return {
    source: {
      file: source, format: raw.format, sheet: raw.sheet, columnCount: raw.headers.length, dataRowCount: raw.rows.length,
      unknownColumns: raw.headers.filter((header, index) => norm(header) && !used.has(index)).map(header => String(header).trim())
    },
    names: {
      file: params.nameFile || null,
      column: nameAt === null ? null : String(raw.headers[nameAt]).trim(),
      source: named.byColumn ? 'колонка таблицы' : (named.byFile ? 'справочник' : null),
      matched: employees.filter(item => item.name).length, unmatched: employees.filter(item => !item.name).length
    },
    employees, skipped,
    gaps: Object.entries(gaps).sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([field, count]) => ({ field, count }))
  };
}

function run(ctx) {
  const value = table(ctx.cwd, s.object({ scoreFile: ctx.params.scoreFile, ...(ctx.params.nameFile ? { nameFile: ctx.params.nameFile } : {}) }));
  s.validateValue(s.loadContract(ctx.cwd, `actions/${ctx.actionName}/contracts/result.json`), value);
  return value;
}

module.exports = {
  dependencies(ctx) {
    const files = [s.resource(ctx.cwd, ctx.processName, ctx.params.scoreFile, ctx.requires)];
    if (ctx.params.nameFile) files.push(s.resource(ctx.cwd, ctx.processName, ctx.params.nameFile, ctx.requires));
    run(ctx);
    return [...files, `actions/${ctx.actionName}/contracts/result.json`];
  },
  prepare(ctx) { run(ctx); return ctx.params; },
  canExecute() { return true; },
  execute: run,
  validate(ctx) { if (!isDeepStrictEqual(ctx.value, run(ctx))) throw new Error('Артефакт не соответствует строкам файла: используйте штатное чтение шага'); }
};

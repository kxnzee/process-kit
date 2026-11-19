'use strict';
// Помощник развилки mail-gate: одна дешёвая проверка, есть ли почтовое подключение в этой сессии.
// Исполняется изолированным исполнителем (глобальные `tools` и `ALL_TOOLS`), файлов не касается.
//
//   аргумент NAME — любое ФИО из уже прочитанной таблицы оценок: нужен ровно один безопасный запрос
//
// Смысл проверки в том, что настроечные проверки её не делают: они разрешают хранилища задач и
// кода, а доступ к инструментам виден только в среде агента. Поэтому признак берётся отсюда, и он
// же различает три разных случая — подключения нет, доступ отвергнут, ответа не дождались.
//
// Наружу уходят только признаки: ни ФИО, ни адресов, ни содержимого выдач, ни текста ошибки
// (в нём иногда встречается сам запрос).
const MAIL = /email/i;
const CLASS = [
  [/(401|403)/, 'доступ отвергнут (401 или 403) — секрет или права'],
  [/unauthor|forbidden|denied|invalid.*token|token/i, 'доступ отвергнут — секрет или права'],
  [/429|лимит запросов|quota|rate/i, 'справочник ограничил частоту запросов'],
  [/timed?\s*out|ETIMEDOUT|ECONN|network|таймаут/i, 'соединение со справочником не установлено — проверки секретов не было'],
  [/TIMELIMIT|0x3/, 'справочник не ответил за отведённое время']
];

const replyText = value => typeof value === 'string' ? value : Array.isArray(value?.content) ? value.content.filter(part=>part.type==='text').map(part=>part.text||'').join('\n') : value?.output!==undefined ? String(value.output) : JSON.stringify(value||'');
const replyError = (value,text) => !!(value?.isError||value?.error)||/^\s*(?:Ошибка(?=\s|:|$)|Error\b|Request failed|HTTP(?:\/[\d.]+)?\s+[45]\d\d|401\b|403\b|429\b|Unauthorized\b|Forbidden\b)/i.test(text);

async function run(NAME, SERVER = '') {
  const keys = [];
  for (const bag of [typeof tools !== 'undefined' ? tools : null, typeof ALL_TOOLS !== 'undefined' ? ALL_TOOLS : null]) {
    if (!bag) continue;
    for (const key of Array.isArray(bag) ? bag : Object.keys(bag)) if (typeof key === 'string') keys.push(key);
  }
  const servers = new Set(keys.filter((k) => /^mcp__/i.test(k) && MAIL.test(k)).map((k) => k.split('__')[1] || ''));
  const callable = [...new Set(keys)].filter((k) => MAIL.test(k) && /search_ldap$/i.test(k) && (!SERVER || k.split('__')[1] === SERVER) && typeof (typeof tools !== 'undefined' ? tools[k] : undefined) === 'function');
  if (!callable.length) {
    return { найден: false, почтовыхСерверов: servers.size, почему: servers.size ? 'на почтовом сервере нет инструмента поиска контактов' : 'в этой копии нет почтового подключения (имя сервера со словом email)' };
  }
  if(callable.length>1)return {найден:false,почтовыхСерверов:servers.size,почему:'несколько почтовых серверов — нужно выбрать mailServer'};
  const tool = callable[0], сервер = tool.split('__')[1] || '';
  const фамилия = String(NAME === undefined ? '' : NAME).trim().split(/\s+/)[0] || '';
  if (!фамилия) return { найден: true, сервер, чтение: 'нечем проверить: пустой список людей', проверено: false };
  try {
    const answer = await tools[tool]({ query: фамилия });
    const text = replyText(answer);
    if(replyError(answer,text)){const why=CLASS.find(rule=>rule[0].test(text));return {найден:true,сервер,чтение:why?why[1]:'справочник ответил ошибкой',проверено:false};}
    if (/TIMELIMIT|0x3/i.test(text)) return { найден: true, сервер, чтение: 'справочник не ответил за отведённое время', проверено: false };
    const записей = (text.match(/👤/g) || []).length;
    return { найден: true, сервер, чтение: записей ? 'ок' : 'ок, на это ФИО записей нет — доступ работает', записей, проверено: true };
  } catch (error) {
    const message = String((error && error.message) || error || '');
    const why = CLASS.find((rule) => rule[0].test(message));
    return { найден: true, сервер, чтение: why ? why[1] : 'справочник ответил ошибкой (' + message.length + ' знаков текста)', проверено: false };
  }
}

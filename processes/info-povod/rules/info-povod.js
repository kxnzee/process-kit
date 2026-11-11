'use strict';
// Расчёт отчёта «Инфо-поводы Release Notes»: строки собираются из артефактов прогона,
// ничего не читается из систем и не вычисляется по часам машины — окна считаются из runDate.
const DAY = 86400000;

function fail(text) { throw new Error(text); }

function object(value, at) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (e) { fail(`${at}: нужен JSON-объект`); } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${at}: нужен объект`);
  return value;
}

// Действие расчёта передаёт сохранённые артефакты уже прочитанными объектами; путь к файлу
// тоже принимается — иначе правило нельзя проверить отдельно от прогона.
function content(value, at) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return structuredClone(value);
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || /^\{[a-z0-9-]+\}$/.test(text)) fail(`${at}: нужен сохранённый артефакт — объект или путь к файлу прогона`);
  let raw; try { raw = require('node:fs').readFileSync(text, 'utf8'); } catch (e) { fail(`${at}: файл артефакта не читается (${text})`); }
  return object(raw, `${at}: файл артефакта`);
}

function readDate(value, at) {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$|^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) fail(`${at}: нужна дата в виде ГГГГ-ММ-ДД или ДД.ММ.ГГГГ, получено «${value || 'пусто'}»`);
  const y = Number(m[1] || m[6]), mo = Number(m[2] || m[5]) - 1, d = Number(m[3] || m[4]);
  const stamp = Date.UTC(y, mo, d);
  const back = new Date(stamp);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo || back.getUTCDate() !== d) fail(`${at}: несуществующая дата «${value}»`);
  return stamp;
}

const iso = stamp => new Date(stamp).toISOString().slice(0, 10);
const short = stamp => new Date(stamp).toISOString().slice(8, 10) + '.' + new Date(stamp).toISOString().slice(5, 7);
const days = value => { const n = Number(value); if (!Number.isInteger(n) || n < 0) fail('ширина окна: нужно целое число дней не меньше 0'); return n; };

// Релиз лежит в одной инсталляции, поэтому ключ объединяет выборки; совпадение ключей
// из разных подключений отмечается отдельно — в живых данных его быть не должно.
function mergeReleases(sources) {
  const byKey = new Map(), collisions = [];
  for (const source of sources) {
    for (const release of source.records || []) {
      if (!release || typeof release.key !== 'string' || !release.key.trim()) fail(`выборка ${source.label}: запись без ключа`);
      const known = byKey.get(release.key);
      if (known) { collisions.push({ key: release.key, stores: [known.label, source.label] }); continue; }
      byKey.set(release.key, { ...structuredClone(release), label: source.label });
    }
  }
  return { releases: [...byKey.values()], collisions };
}

function classificationOf(classified, key) {
  for (const artifact of classified) {
    const found = (artifact.items || []).find(item => item.key === key);
    if (found) return { item: found, store: artifact.store };
  }
  return { item: null, store: null };
}

// Имя КЭ печатается дословно из значения поля задачи; в группу попадает только код из периметра.
function keysOfRelease(release, perimeter) {
  const values = Array.isArray(release.keValues) ? release.keValues : [];
  const codes = Array.isArray(release.codes) ? release.codes : [];
  return codes.map(code => {
    const named = values.find(value => String(value.id) === String(code));
    return { code: String(code), name: named && named.name ? named.name : `КЭ ${code}` };
  }).filter(key => perimeter.has(key.code));
}

function describeRelease(release, classified, parameters) {
  const excludeTypes = (parameters.excludeIssueTypes || []).map(type => String(type).toLowerCase());
  const items = [], dropped = [];
  for (const member of release.members || []) {
    if (excludeTypes.includes(String(member.issueType || '').toLowerCase())) {
      dropped.push({ key: member.key, reason: `тип задачи ${member.issueType} исключён` });
      continue;
    }
    const { item } = classificationOf(classified, member.key);
    if (!item) fail(`задача ${member.key} состава релиза ${release.key} не классифицирована: шаг классификации её не вернул`);
    items.push({
      key: member.key, summary: member.summary || '', url: member.url || '',
      classification: item.classification, agreement: item.agreement,
      subtype: item.subtype, basis: item.basis, question: item.question,
      text: [member.summary, member.description].filter(part => part && String(part).trim()).join(' — ')
    });
  }
  const shown = items.filter(item => item.classification !== 'technical');
  const technical = items.filter(item => item.classification === 'technical');
  let kind = 'news';
  if (!(release.members || []).length) kind = release.membersComplete === false ? 'unread' : 'empty';
  else if (!shown.length) kind = 'technical';
  const technicalNames = technical.map(item => item.key);
  return {
    kind, items: shown, technicalCount: technical.length, technicalKeys: technicalNames,
    technicalRefs: technical.map(item => ({ key: item.key, url: item.url || '' })),
    excludedText: kind === 'technical' && technicalNames.length ? 'Технический релиз' : null,
    dropped
  };
}

function rowHeading(release, runStamp) {
  const planned = release.plannedAt ? short(readDate(release.plannedAt, `релиз ${release.key}: начало внедрения (план)`)) : null;
  const when = !planned ? 'дата внедрения не заполнена'
    : readDate(release.plannedAt, '') <= runStamp ? `Внедрение ${planned}` : `плановая дата ПРОМ ${planned}`;
  const title = String(release.summary || '').trim();
  return `Релиз: ${release.key}${title ? ` «${title}»` : ''} — ${release.status || 'статус не отдан'} — ${when}`;
}

function evaluate(inputs, rawParameters) {
  const parameters = object(rawParameters, 'parameters');
  const runStamp = readDate(parameters.runDate, 'runDate');
  const lookBack = days(parameters.lookBackDays), lookAhead = days(parameters.lookAheadDays);
  const windowCurrent = { from: iso(runStamp - lookBack * DAY), to: iso(runStamp) };
  const windowPlan = { from: iso(runStamp + DAY), to: iso(runStamp + lookAhead * DAY) };
  const inWindow = (date, window) => date >= window.from && date <= window.to;

  const selections = Object.entries(inputs)
    .filter(([name]) => /releases/.test(name))
    .map(([name, value]) => {
      const artifact = object(content(value, `вход ${name}`), `вход ${name}`);
      const label = (artifact.meta && artifact.meta.instanceLabel) || name;
      return { ...artifact, label, name };
    });
  const classified = Object.entries(inputs)
    .filter(([name]) => /classified/.test(name))
    .map(([name, value]) => object(content(value, `вход ${name}`), `вход ${name}`));
  if (!selections.length || !classified.length) fail('нужны оба вида входов: выборки релизов и их классификации');

  const perimeter = new Map();
  for (const selection of selections) {
    for (const code of ((selection.meta || {}).modulesInScope || [])) perimeter.set(String(code.code ?? code), true);
  }
  if (!perimeter.size) fail('в выборках нет периметра КЭ (meta.modulesInScope): периметр берётся из настроек подключения');

  const { releases, collisions } = mergeReleases(selections);
  const notes = [], questions = [], unverified = [], excluded = [];
  // Одно и то же сообщение два раза читается как противоречие, а не как подтверждение:
  // в демо оба чтения дают один набор, поэтому строки совпадают дословно.
  const addNote = text => { if (!notes.includes(text)) notes.push(text); };
  const uniq = list => [...new Map(list.map(row => [JSON.stringify(row), row])).values()];

  const demo = selections.some(selection => (selection.meta || {}).demo);
  if (collisions.length) {
    if (demo) addNote(`демо: ключи ${collisions.length} релизов встретились в обеих выборках — оба чтения читают одну фикстуру; в живом прогоне релиз принадлежит одной инсталляции`);
    else for (const collision of collisions) addNote(`ключ ${collision.key} встретился в двух выборках (${collision.stores.join(' и ')}): в отчёте учтён один раз — проверьте, не зеркало ли это проекта`);
  }
  for (const selection of selections) {
    for (const row of selection.excluded || []) excluded.push({ key: row.key, kind: 'выборка', reason: `${selection.label}: ${row.reason}` });
    for (const row of selection.unverified || []) unverified.push({ key: row.key, reason: `${selection.label}: ${row.reason}` });
    const meta = selection.meta || {};
    for (const key of ['plannedAtMissing', 'itServiceMissing', 'linksUnread']) {
      for (const entry of meta[key] || []) addNote(`${selection.label}: ${typeof entry === 'string' ? entry : `${entry.key} — ${entry.reason}`}`);
    }
    if (meta.demo) addNote(`${selection.label}: демо — обе выборки читают один набор вымышленных релизов`);
  }
  // Индекс состава нужен, чтобы вопрос был понятен без открытия Jira: по задаче возвращаем
  // её формулировку и релиз, в котором она пришла.
  const releaseIndex = new Map(releases.map(release => [release.key, release]));
  const memberIndex = new Map();
  for (const release of releases) {
    for (const member of release.members || []) {
      if (!memberIndex.has(member.key)) memberIndex.set(member.key, { summary: member.summary || '', url: member.url || '', releaseKey: release.key });
    }
  }
  const storeLabels = new Map(selections.filter(selection => selection.store).map(selection => [String(selection.store), selection.label]));
  const classNames = { contained: 'содержательная', technical: 'техническая', unknown: 'без класса' };
  const ASKED = new Set(['conflict', 'weak', 'question']);
  // Причина вопроса для формы отчёта: у задачи она берётся из статуса сверки, у релиза —
  // своя. Значения закрытые, форма печатает по ним короткую подпись.
  const CAUSE = { conflict: 'rule-conflict', weak: 'weak-rule', question: 'unknown-meaning' };
  const askedByCalc = new Set();
  // Вопрос ставится по статусу сверки самой задачи, а не по списку из шапки артефакта:
  // списки — срез для чтения шапки, решение живёт в строке. Иначе статус, которого нет в
  // списках (так было с weak), исчезает из отчёта молча.
  const questionRow = (artifact, item, agreement) => {
    const key = item.key;
    const member = memberIndex.get(key) || null;
    const releaseKey = item.release || (member && member.releaseKey) || '';
    const releaseRec = releaseKey ? (releaseIndex.get(releaseKey) || null) : null;
    const byRule = item.ruleId || (item.rulesMatched || [])[0];
    const ruleText = byRule ? ` ${byRule}` : '';
    const named = classNames[item.classification] || 'не определён';
    // Класс правила расчёту неизвестен: признак живёт в файле правил шага классификации.
    // Поэтому аварийная формулировка называет только то, что видно, — класс напечатанный и
    // опору на признак; направление расхождения обязан назвать классификатор в question.
    const fallback = {
      conflict: `правило${ruleText} читается иначе, чем текст задачи — подтвердите напечатанный класс «${named}» или назовите свой`,
      weak: `класс «${named}» держится только на слабом признаке${ruleText} — подтвердите его или назовите свой`,
      question: 'класс задачи не установлен — скажите, что именно меняется для пользователя'
    }[agreement];
    if (!item.question) askedByCalc.add(key);
    return {
      scope: key,
      url: member && member.url ? member.url : '',
      summary: member && member.summary ? member.summary : '',
      why: item.understanding ? item.understanding : 'текст задачи прочитан, смысл для человека не установлен',
      text: item.question ? item.question : fallback,
      store: storeLabels.get(String(artifact.store)) || String(artifact.store || ''),
      release: releaseKey ? { key: releaseKey, url: releaseRec && releaseRec.url ? releaseRec.url : '' } : null,
      cause: CAUSE[agreement]
    };
  };
  const releaseQuestion = release => ({
    scope: release.key,
    url: release.url || '',
    summary: '',
    why: 'релиз пришёл из выборки, но поле «Начало внедрения (план)» пустое: по какой неделе его показывать, неизвестно',
    text: 'уточните плановую дату начала внедрения — без неё релиз не относится ни к одному окну',
    store: release.label || '',
    release: { key: release.key, url: release.url || '' },
    cause: 'missing-date'
  });
  for (const artifact of classified) {
    const artifactStore = storeLabels.get(String(artifact.store)) || String(artifact.store || '');
    for (const row of artifact.compositionUnread || []) unverified.push({ key: row.key, reason: `${artifactStore}: состав релиза прочитан не полностью — ${row.reason}` });
    for (const item of artifact.items || []) {
      if (ASKED.has(item.agreement)) questions.push(questionRow(artifact, item, item.agreement));
    }
    // Списки шапки обязаны совпадать со статусами строк: расхождение заметно только здесь.
    for (const [listName, status] of [['conflicts', 'conflict'], ['weak', 'weak'], ['questions', 'question']]) {
      const listed = (artifact[listName] || []).filter(key => {
        const found = (artifact.items || []).find(row => row.key === key);
        return found && found.agreement !== status;
      });
      if (listed.length) addNote(`${artifactStore}: список ${listName} в шапке артефакта расходится со статусами строк (${listed.slice(0, 5).join(', ')}${listed.length > 5 ? ', …' : ''}) — в отчёте разобрана каждая задача этого статуса`);
    }
  }

  const rows = [];
  const groups = new Map();
  const placements = { current: 0, plan: 0 };
  let storyCount = 0, technicalStories = 0, unknownStories = 0;
  const state = { news: 0, technical: 0, empty: 0, unread: 0 };
  const counted = new Set();

  for (const release of releases) {
    if (!release.plannedAt) {
      excluded.push({ key: release.key, kind: 'окно', reason: 'поле «Начало внедрения (план)» не заполнено: релиз не относится ни к одному окну' });
      questions.push(releaseQuestion(release));
      continue;
    }
    const planned = readDate(release.plannedAt, `релиз ${release.key}: начало внедрения (план)`);
    let windowName = null;
    if (planned <= runStamp && iso(planned) >= windowCurrent.from) windowName = 'current';
    else if (iso(planned) >= windowPlan.from && iso(planned) <= windowPlan.to) windowName = 'plan';
    if (!windowName) {
      excluded.push({ key: release.key, kind: 'окно', reason: `плановая дата ${iso(planned)} вне окон прогона (${windowCurrent.from}…${windowPlan.to})` });
      continue;
    }
    const keys = keysOfRelease(release, perimeter);
    if (!keys.length) {
      excluded.push({ key: release.key, kind: 'периметр', reason: 'в поле «КЭ» нет кода из периметра подключения' });
      continue;
    }
    const detail = describeRelease(release, classified, parameters);
    state[detail.kind] += 1;
    storyCount += detail.items.length;
    technicalStories += detail.technicalCount;
    unknownStories += detail.items.filter(item => item.classification === 'unknown').length;
    counted.add(release.key);
    const row = {
      key: release.key, url: release.url || '', status: release.status || '',
      plannedAt: iso(planned), window: windowName, heading: rowHeading(release, runStamp),
      kind: detail.kind, items: detail.items.map(item => ({ ...item })),
      technicalRefs: detail.technicalRefs.map(ref => ({ ...ref })),
      excludedText: detail.excludedText, itService: release.itService || null
    };
    rows.push(row);
    for (const key of keys) {
      const groupKey = key.code;
      if (!groups.has(groupKey)) groups.set(groupKey, { code: key.code, name: key.name, current: [], plan: [] });
      groups.get(groupKey)[windowName].push(row);
      placements[windowName] += 1;
      if (!row.url) notes.push(`${row.key}: подключение не отдало ссылку на релиз — строка напечатана без ссылки`);
    }
  }

  const keGroups = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.code.localeCompare(b.code, 'ru'))
    .map(group => ({ ...group, rowCount: group.current.length + group.plan.length }));
  const rowCount = keGroups.reduce((sum, group) => sum + group.rowCount, 0);
  if (rowCount !== placements.current + placements.plan) fail(`число строк не сходится: ${rowCount} из групп против ${placements.current + placements.plan} размещений`);
  const noNewsCount = keGroups.reduce((sum, group) => sum + [...group.current, ...group.plan].filter(row => row.kind !== 'news').length, 0);

  const titleTemplate = String(parameters.pageTitleTemplate || 'Release Notes {currentFrom}–{planTo}');
  const fill = text => String(text)
    .replace(/\{currentFrom\}/g, short(readDate(windowCurrent.from, '')))
    .replace(/\{currentTo\}/g, short(readDate(windowCurrent.to, '')))
    .replace(/\{planFrom\}/g, short(readDate(windowPlan.from, '')))
    .replace(/\{planTo\}/g, short(readDate(windowPlan.to, '')));
  const pageTitle = fill(titleTemplate);
  const windowName = (name, window) => `${name}: ${short(readDate(window.from, ''))}-${short(readDate(window.to, ''))}`;
  const questionList = uniq(questions), unverifiedList = uniq(unverified), excludedList = uniq(excluded).sort((a, b) => a.key.localeCompare(b.key, 'ru'));

  const data = {
    meta: {
      reportTitle: 'Инфо-поводы',
      pageTitle,
      generatedAt: iso(runStamp),
      releaseType: String(parameters.releaseType || 'Release 2.0'),
      windowCurrent, windowPlan,
      windowsText: `${windowName('текущие', windowCurrent)}; ${windowName('планы', windowPlan)}`,
      queryFile: String((selections[0].meta || {}).queryFile || ''),
      stores: selections.map(selection => ({ id: selection.store || '', label: selection.label, releases: (selection.records || []).length })),
      methodologyCheck: String(parameters.methodologyCheck || 'no'),
      demo
    },
    counters: {
      releaseCount: counted.size,
      rowCurrentCount: placements.current,
      rowPlanCount: placements.plan,
      rowCount,
      keCount: keGroups.length,
      newsCount: state.news, technicalCount: state.technical, emptyCount: state.empty, unreadCompositionCount: state.unread,
      storyCount, technicalStoryCount: technicalStories, unknownStoryCount: unknownStories,
      noNewsCount,
      unverifiedCount: unverifiedList.length, excludedCount: excludedList.length, questionCount: questionList.length
    },
    keGroups,
    questions: questionList, unverified: unverifiedList,
    excluded: excludedList,
    notes
  };
  if (!data.counters.releaseCount) {
    data.notes.push(`в окнах ${data.meta.windowsText} релизов периметра нет — в таблице одна строка «Нет инфоповодов» в обеих колонках`);
  }
  const idle = [...perimeter.keys()].filter(code => !groups.has(code));
  if (idle.length) {
    data.notes.push(`КЭ без релизов в окнах прогона: ${idle.length} из ${perimeter.size} — в таблицу не попали (первые: ${idle.slice(0, 5).join(', ')}${idle.length > 5 ? ', …' : ''})`);
  }
  data.notes.push('строка отчёта — это релиз в группе одного КЭ: релиз с несколькими КЭ попадает в группу каждого, поэтому строк может быть больше, чем релизов');
  if (askedByCalc.size) {
    data.notes.push(`причину вопроса для ${askedByCalc.size} задач сформулировал расчёт общей строкой, а не шаг классификации (первые: ${[...askedByCalc].slice(0, 5).join(', ')}${askedByCalc.size > 5 ? ', …' : ''}) — у этих задач пустое поле «вопрос» в артефакте классификации`);
  }
  return data;
}

module.exports = { evaluate };

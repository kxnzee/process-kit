'use strict';
// Помощник шага lookup-mail: разбор сохранённых выдач почтового справочника в карту адресов.
// Запускается как обычная программа, сети не касается: читает выдачи из папки прогона и файл
// выгрузки, пишет карту и spec сохранения, в консоль отдаёт только счётчики.
//
//   node actions/find-mail-contacts/scripts/build-map.js <выпуск или путь к .run> [выгрузка] [столбец организации] [имя сервера]
//
// Выгрузку, столбец и имя сервера передавать не нужно: они берутся из параметров прогона
// (state.json). Русские названия в аргументах шелла набирают редко и правильно, и зря — поэтому
// здесь они по умолчанию читаются из журнала.
//
// Правила разбора — по ACTION.md этого действия (правила 2–8): блоки записей `👤`, поля `📧 💼 🏢`
// и `DN:`, отключённые учётки по `OU=Disabled Objects`, различение тёзок столбцом выгрузки в два
// прохода (сначала точное совпадение, потом подстрока), кандидаты при двух-трёх неразличённых
// записях, таймлимит отличается от «записей нет».
//
// Артефакт, шаг и переход ниже должны совпадать с карточкой шага в PROCESS.md: журнал сверяет их
// при сохранении и отвергает расхождение.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');

const STEP = 'lookup-mail', ARTIFACT = 'people-map', NEXT_STEP = 'assess';
// Шаг `mail-off`: справочник не опрашивался, карта собирается из одного состояния пропуска.
// Причина одна на всех и она же попадает в отчёт под каждым персональным блоком.
const OFFLINE = '--без-подключения';
const OFFLINE_STEP = 'mail-off';
const DEFAULT_OFFLINE_REASON = 'почтовое подключение не найдено в этой копии — справочник не опрашивался';

// --- служебный столбец выгрузки -------------------------------------------------------------
function sheetCells(file, orgTitle, cwd=process.cwd()) {
  const rel=path.relative(cwd,path.resolve(cwd,file)).split(path.sep).join('/');
  const raw=require('../../read-score-table/runtime').readRawTable(cwd,rel);
  const nameCol=raw.headers.indexOf('ФИО сотрудника'),orgCol=raw.headers.indexOf(orgTitle);
  const kindCol=raw.headers.findIndex(title=>/Юридическое лицо/.test(title||''));
  if(nameCol<0)throw new Error('Нет столбца ФИО сотрудника');
  const org=new Map(),kind=new Map(),dup=new Map();
  for(const row of raw.rows){const who=String(row[nameCol]||'').trim();if(!who)continue;dup.set(who,(dup.get(who)||0)+1);if(!org.has(who))org.set(who,String(row[orgCol]||'').trim());if(!kind.has(who))kind.set(who,String(row[kindCol]||'').trim());}
  return {org,kind,dup,columns:{nameCol,orgCol,kindCol}};
}
function runContext(value,cwd=process.cwd()){
  const safe=require('../../../tools/lib/core/safe-path');
  const raw=String(value||'').replace(/\\/g,'/').replace(/\/$/,'').replace(/\/\.run$/,'');
  const output=path.basename(raw);
  if(!require('../../../tools/lib/core/paths').validRunFolderName(output))throw new Error('Нужен точный output прогона');
  const folder=safe.inside(cwd,'outputs/'+output);
  if(raw!==output&&path.resolve(cwd,raw)!==path.resolve(folder))throw new Error('Путь должен указывать на outputs/<output> этой копии');
  const card=require('../../../tools/lib/integrations/gigacode-run').run(cwd,'next',{output});
  const dir=safe.inside(folder,'.run'),state=JSON.parse(fs.readFileSync(safe.inside(dir,'state.json'),'utf8'));
  const artifact=state.artifacts?.['score-table'];if(!artifact)throw new Error('Нет сохранённой таблицы score-table');
  const scores=JSON.parse(fs.readFileSync(safe.inside(dir,artifact),'utf8'));
  return {output,dir,state,scores,card};
}
function pollInput(value,from,to){
  const ctx=runContext(value);
  if(ctx.card.operation!=='model'||ctx.card.action!=='find-mail-contacts')throw new Error('Опрос разрешён только после begin текущего find-mail-contacts');
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from||to-from>40)throw new Error('Нужен диапазон до 40 строк');
  const raw=require('../../../tools/lib/core/safe-path').inside(ctx.dir,'inputs/mail-batches/raw');
  fs.mkdirSync(raw,{recursive:true});
  return {goal:ctx.state.params.goal??'',names:ctx.scores.employees.slice(from,to).map((person,index)=>[from+index,String(person.name||''),person.total]),files:fs.existsSync(raw)?fs.readdirSync(raw):[]};
}

// --- нормализация ---------------------------------------------------------------------------
const normName = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const FORMS = /^(ооо|ао|зао|оао|пао|ано|аао)\s+/;
const normOrg = (s) => normName(s).replace(/э/g, 'е').replace(/[«»"'’]/g, '').split(/\s*,\s*/)[0]
  .split(/\s+/).filter((w, i, a) => !(i === 0 && FORMS.test(a.join(' ') + ' ')) && !FORMS.test(w + ' ')).join(' ').trim();

// --- разбор выдачи справочника ---------------------------------------------------------------
function parseCards(text) {
  const out = [];
  for (const chunk of String(text).split('👤').slice(1)) {
    const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const head = lines[0] || '';
    const card = {
      title: head,
      name: head.replace(/\s*\[B\]|\s*\[ДЗО\]|\s*\{ЦА\}|\s*\{Omega\}/gi, '').trim(),
      contractor: /\[B\]/i.test(head), subsidiary: /\[ДЗО\]/i.test(head), tree: (head.match(/\{(ЦА|Omega)\}/i) || [])[1] || '',
      email: '', post: '', org: '', dn: ''
    };
    for (const l of lines.slice(1)) {
      if (/^📧/.test(l)) card.email = l.replace(/^📧\s*/, '').trim();
      else if (/^💼/.test(l)) card.post = l.replace(/^💼\s*/, '').trim();
      else if (/^🏢/.test(l)) card.org = l.replace(/^🏢\s*/, '').trim();
      else if (/^DN:/i.test(l)) card.dn = l.replace(/^DN:\s*/i, '').trim();
    }
    card.disabled = /OU=Disabled Objects/i.test(card.dn);
    out.push(card);
  }
  return out;
}
const NUM = ['', 'одна', 'две', 'три', 'четыре', 'пять'];
const countWord = (n) => (n <= 5 ? NUM[n] : String(n));
// Число согласуется с существительным: две учётки — шесть учёток, четыре адреса — пять адресов.
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const counted = (n, forms) => countWord(n) + ' ' + plural(n, ...forms);
const ACCOUNTS = ['учётка', 'учётки', 'учёток'];
const ADDRESSES = ['адрес', 'адреса', 'адресов'];
const deadWord = (n) => (n === 2 ? 'обе ' + plural(2, ...ACCOUNTS) : n <= 5 ? counted(n, ACCOUNTS) : 'все ' + n + ' ' + plural(n, ...ACCOUNTS)) + ' в отключённых объектах — писать некому';
const liveWord = (n) => 'в почтовом справочнике ' + countWord(n) + ' живых ' + plural(n, ...ADDRESSES) + ' на это ФИО — адресат не опознан';

function resolve(name, all, orgValue) {
  const seen = new Set();
  const mine = all.filter((c) => {
    if (normName(c.name) !== normName(name)) return false;
    const key = (c.email || '') + '|' + (c.dn || c.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const live = mine.filter((c) => !c.disabled && c.email);
  const dead = mine.filter((c) => c.disabled);
  const base = { name };
  if (!mine.length) return Object.assign(base, { причина: 'в почтовом справочнике нет записи с этим ФИО' });
  if (!live.length) {
    const подряд = dead.every((c) => c.contractor) && dead.length > 0;
    if (dead.length === 1 && !dead[0].email) return Object.assign(base, { причина: подряд ? 'только отключённая подрядная запись без адреса' : 'только отключённая запись без адреса' });
    return Object.assign(base, { причина: deadWord(dead.length) });
  }
  if (live.length === 1) {
    const rec = Object.assign(base, { email: live[0].email });
    if (live[0].contractor) rec['подряд'] = true;
    if (live[0].tree) rec.источник = '{' + live[0].tree + '}';
    rec['записей'] = mine.length;
    return rec;
  }
  const want = normOrg(orgValue);
  let hit = want ? live.filter((c) => normOrg(c.org) === want) : [];
  let how = 'точное совпадение с столбцом выгрузки';
  if (!hit.length && want) { hit = live.filter((c) => normOrg(c.org).includes(want) || want.includes(normOrg(c.org))); how = 'подстрока столбца выгрузки'; }
  if (hit.length === 1) {
    const rec = Object.assign(base, { email: hit[0].email, организация: hit[0].org, различение: how, 'записей': live.length });
    if (hit[0].contractor) rec['подряд'] = true;
    return rec;
  }
  // Адресатов не различить, но и не угадывать: когда пригодных записей две или три, человек
  // выбирает сам — в карту кладутся все кандидаты с должностью и отделом, а страница показывает
  // под блоком столько кнопок, сколько кандидатов. Больше трёх — выбор становится гаданием,
  // там остаётся текстовая причина.
  const pool = hit.length > 1 ? hit : live;
  if (pool.length >= 2 && pool.length <= 3) {
    const rec = Object.assign(base, {
      'кандидаты': pool.map((c) => {
        const o = { почта: c.email };
        if (c.post) o['должность'] = c.post;
        if (c.org) o['отдел'] = c.org;
        if (c.contractor) o['подряд'] = true;
        return o;
      }),
      'записей': live.length
    });
    if (pool.every((c) => c.contractor)) rec['подряд'] = true;
    return rec;
  }
  if (hit.length > 1) return Object.assign(base, { причина: liveWord(live.length), 'записей': live.length });
  const diffPost = new Set(live.map((c) => normName(c.post))).size > 1;
  const diffOrg = new Set(live.map((c) => normOrg(c.org))).size > 1;
  if (live.length === 2 && diffPost && diffOrg) {
    const how = live.map((c) => (c.contractor ? ('подрядчик' + (c.org ? ': ' + c.org : '')) : (c.post || c.org || 'без должности'))).join(' и ');
    return Object.assign(base, { причина: 'в почтовом справочнике два разных человека с этим ФИО (' + how + ') — адресат не опознан', 'записей': 2 });
  }
  if (want) return Object.assign(base, { причина: 'ни одна живая запись не относится к «' + orgValue + '» — адресат не опознан', 'записей': live.length });
  return Object.assign(base, { причина: liveWord(live.length), 'записей': live.length });
}

function main() {
  const offlineAt = process.argv.indexOf(OFFLINE);
  const offline = offlineAt > 0 ? String(process.argv[offlineAt + 1] || DEFAULT_OFFLINE_REASON) : '';
  const ctx=runContext(process.argv[2]),RUN=ctx.dir,state=ctx.state,params=state.params||{};
  if(!['model','execute'].includes(ctx.card.operation)||!ctx.card.save?.attemptId||ctx.card.action!=='find-mail-contacts')throw new Error('Сначала begin текущего шага find-mail-contacts');
  const XLSX=offline?'':process.argv[3]||params.scoreFile||'';
  const ORG_TITLE=offline?'':process.argv[4]||params.companyColumn||'';
  const SERVER=offline?'':process.argv[5]||params.mailServer||'автопоиск по email';
  const RAW=path.join(RUN,'inputs','mail-batches','raw'),ART=ctx.scores;
  if (!XLSX || !ORG_TITLE) {
    if (!offline) throw new Error('Нет пути выгрузки или столбца организации: передай их аргументами либо запусти из прогона, где они заданы');
    // В пропуске выгрузка не нужна: адресов нет ни у кого, различать между записями некого.
  }
  // --- сборка ----------------------------------------------------------------------------------
  const sheet = offline ? { org: new Map(), kind: new Map(), dup: new Map(), columns: {} } : sheetCells(XLSX, ORG_TITLE);
  const { org: orgOf, kind: kindOf, dup, columns } = sheet;
  const map = {}, gaps = [], narrow = [];
  let withEmail = 0, picks = 0, notRecipient = 0; const reasons = new Map();
  // Карта нужна только адресатам рекомендаций: рекомендацию правило расчёта даёт строкам, где
  // «Общий итог» ниже цели. Цель берётся из параметров прогона тем же разбором, что и правило;
  // без цели фильтр не действует и карта собирается на все строки. Индекс строки не меняется,
  // поэтому файлы выдач полуинтервалов остаются на своих местах.
  const goalRaw = String(params.goal === undefined || params.goal === null ? '' : params.goal).trim().replace(',', '.');
  const goalValue = goalRaw === '' ? NaN : Number(goalRaw);
  const isRecipient = (e) => !Number.isFinite(goalValue) || (typeof e.total === 'number' && Number.isFinite(e.total) && e.total < goalValue);
  (ART.employees || []).forEach((e, i) => {
    const who = String(e.name ?? '').trim();
    if (!who.trim()) return;
    if (!isRecipient(e)) { notRecipient++; return; }
    if (offline) { map[who] = { name: who, причина: offline }; reasons.set(offline, (reasons.get(offline) || 0) + 1); return; }
    const general = path.join(RAW, String(i).padStart(3, '0') + '.txt');
    if (!fs.existsSync(general)) { gaps.push(i + ': нет файла выдачи'); map[who]={name:who,причина:'справочник не опрашивался для этой строки — адрес не проверен'}; return; }
    let text = fs.readFileSync(general, 'utf8');
    let sourceNote = '';
    for (const [suf, label] of [['-n', 'служебное дерево'], ['-s', 'уточнено коротким фильтром']]) {
      const extraFile = path.join(RAW, String(i).padStart(3, '0') + suf + '.txt');
      if (!fs.existsSync(extraFile)) continue;
      const before = parseCards(text);
      text += '\n' + fs.readFileSync(extraFile, 'utf8');
      const after = parseCards(text);
      const mineLive = (list) => list.filter((c) => !c.disabled && c.email && normName(c.name) === normName(who));
      const known = new Set(before.map((c) => c.email + '|' + c.dn));
      const fresh = mineLive(after).filter((c) => !known.has(c.email + '|' + c.dn));
      if (!mineLive(before).length && fresh.length === 1) sourceNote = label;
    }
    if (/Code: 0x3|TIMELIMIT/i.test(text) && !parseCards(text).some((c) => c.email && !c.disabled)) {
      map[who] = { name: who, причина: 'справочник не ответил за отведённое время — адрес не проверен' };
      reasons.set('таймлимит', (reasons.get('таймлимит') || 0) + 1); return;
    }
    if(/^Ошибка:/m.test(text)){map[who]={name:who,причина:'справочник ответил ошибкой — адрес не проверен'};return;}
    if(parseCards(text).length>=100){map[who]={name:who,причина:'выдача справочника достигла лимита — единственность адреса не проверена'};return;}
    const rec = resolve(who, parseCards(text), orgOf.get(who) || '');
    if (rec.email) withEmail++;
    else if (rec['кандидаты']) picks++;
    else reasons.set(rec['причина'], (reasons.get(rec['причина']) || 0) + 1);
    if (sourceNote) rec['источник'] = sourceNote;
    if (dup.get(who) > 1) rec['дубликат_в_выгрузке'] = true;
    if (!rec.email && !rec['кандидаты']) {
      const cards = parseCards(text).filter((c) => normName(c.name) === normName(who));
      if (cards.some((c) => c.contractor || /OU=\{/i.test(c.dn))) narrow.push({ индекс: i, ФИО: who, причина: rec['причина'] });
    }
    map[who] = rec;
  });

  fs.mkdirSync(path.join(RUN, 'inputs'), { recursive: true });
  fs.writeFileSync(path.join(RUN, 'inputs', 'people-map.json'), JSON.stringify(map, null, 1));
  const detail = [];
  for (const [who, rec] of Object.entries(map)) {
    if (rec.email) continue;
    const i = (ART.employees || []).findIndex((e) => String(e.name) === who);
    const file = path.join(RAW, String(i).padStart(3, '0') + '.txt');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const cards = parseCards(text).filter((c) => normName(c.name) === normName(who));
    detail.push({
      ФИО: who, выгрузка: orgOf.get(who) || '', причина: rec['причина'] || ('выбор из ' + (rec['кандидаты'] || []).length + ' адресов'),
      кандидаты: (rec['кандидаты'] || []).map((c) => [c['почта'], c['должность'] || '-', c['отдел'] || '-'].join(' · ')).join(' || '),
      записей: cards.map((c) => [c.contractor ? '[B]' : '', c.disabled ? 'откл' : 'жив', c.post || '-', c.org || '-'].join(' ')).join(' || ')
    });
  }
  fs.writeFileSync(path.join(RUN, 'inputs', 'people-no-email.json'), JSON.stringify(detail, null, 1));
  fs.writeFileSync(path.join(RUN, 'inputs', 'people-narrow-needed.json'), JSON.stringify(narrow, null, 1));
  const stepName = ctx.card.save.step;
  const spec = {...ctx.card.save,content:map};
  fs.writeFileSync(path.join(RUN, 'inputs', 'save-' + stepName + '.json'), JSON.stringify(spec));
  console.log(JSON.stringify({
    опрос: offline ? 'пропущен — справочник не опрашивался' : 'живой', шаг: stepName,
    строкВВыгрузке: (ART.employees || []).length, цель: goalRaw || 'не задана — карта на все строки',
    адресатов: Object.keys(map).length, внеСпискаАдресатов: notRecipient,
    адресом: withEmail, выборомИзНескольких: picks, безАдреса: Object.keys(map).length - withEmail - picks,
    пропусков: gaps.length, пропуски: gaps.slice(0, 5), дубликатыФИО: [...dup.entries()].filter(([, n]) => n > 1).length,
    столбцы: columns, сервер: SERVER, причины: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
    подрядом: Object.values(map).filter((r) => r['подряд']).length,
    подрядИзВыгрузки: [...kindOf.values()].filter((v) => /Подрядчик/i.test(v)).length,
    нужнаПерепроверкаВДереве: narrow.length,
    файлы: ['inputs/people-map.json', 'inputs/people-no-email.json', 'inputs/people-narrow-needed.json', 'inputs/save-' + stepName + '.json']
  }, null, 1));
}

if (require.main === module) {try {if(process.argv[2]==='--poll-input')console.log(JSON.stringify(pollInput(process.argv[3],Number(process.argv[4]),Number(process.argv[5]))));else main();}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports = { parseCards, resolve, normName, normOrg, sheetCells, runContext, pollInput };

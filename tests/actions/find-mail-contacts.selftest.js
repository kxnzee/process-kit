'use strict';
// Проверки помощников шага lookup-mail (actions/find-mail-contacts/scripts/).
// Данные синтетические: ни ФИО из рабочих выгрузок, ни адреса справочника сюда не попадают.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const cwd = path.join(__dirname, '../..');
const build = require('../../actions/find-mail-contacts/scripts/build-map.js');
const card = (o) => Object.assign({ title: '', name: '', contractor: false, subsidiary: false, tree: '', email: '', post: '', org: '', dn: '', disabled: false }, o);
const check = (name, fn) => { fn(); console.log('✓ ' + name); };

check('карточка разбирается по строкам признаков, отключённая видна по DN', () => {
  const cards = build.parseCards([
    'Найдено записей: 2',
    '👤 Тестов Пётр Петрович [B]',
    '📧 testov@omega.example.invalid',
    '💼 Эксперт',
    '🏢 ООО «Пример»',
    'DN: CN=Testov-PP,OU=GAL,DC=example,DC=invalid',
    '👤 Тестов Пётр Петрович',
    '📧 old@example.invalid',
    'DN: CN=Testov-PP2,OU=Disabled Objects,OU=GAL,DC=example,DC=invalid'
  ].join('\n'));
  assert.equal(cards.length, 2);
  assert.equal(cards[0].contractor, true);
  assert.equal(cards[0].email, 'testov@omega.example.invalid');
  assert.equal(cards[0].org, 'ООО «Пример»');
  assert.equal(cards[0].disabled, false);
  assert.equal(cards[1].disabled, true, 'путь OU=Disabled Objects делает запись отключённой');
});

check('столбец выгрузки различает тёзок: точное совпадение важнее подстроки', () => {
  const live = [
    card({ name: 'Тестов Пётр Петрович', email: 'wrong@example.invalid', org: 'ООО «ИЦ Философия.ИТ»' }),
    card({ name: 'Тестов Пётр Петрович', email: 'right@example.invalid', org: 'ООО "Философия.ИТ"' })
  ];
  const rec = build.resolve('Тестов Пётр Петрович', live, 'ООО «Философия.ИТ»');
  assert.equal(rec.email, 'right@example.invalid', 'одна подстрока подходит обеим записям, спасает точный проход');
  assert.equal(rec['различение'], 'точное совпадение с столбцом выгрузки');
});

check('однофамильцев без различения процесс не выбирает: две-три записи идут кандидатами', () => {
  const live = [
    card({ name: 'Тестова Анна Сергеевна', email: 'a1@example.invalid', post: 'Аудитор', org: 'Сектор А' }),
    card({ name: 'Тестова Анна Сергеевна', email: 'a2@example.invalid', post: 'Разработчик', org: 'Сектор Б' })
  ];
  const rec = build.resolve('Тестова Анна Сергеевна', live, 'Подразделение Не То');
  assert.ok(!rec.email, 'единственного адреса в карте быть не должно');
  assert.deepEqual(rec['кандидаты'].map((c) => c['почта']), ['a1@example.invalid', 'a2@example.invalid']);
  assert.equal(rec['кандидаты'][0]['должность'], 'Аудитор');
  assert.equal(rec['кандидаты'][1]['отдел'], 'Сектор Б');
});

check('четыре неразличённых записи — текстовая причина, а не выбор наугад', () => {
  const live = [1, 2, 3, 4].map((n) => card({ name: 'Тестов Илья Дмитриевич', email: 'x' + n + '@example.invalid', post: 'Роль ' + n, org: 'Сектор ' + n }));
  const rec = build.resolve('Тестов Илья Дмитриевич', live, '');
  assert.ok(!rec.email && !rec['кандидаты']);
  assert.equal(rec['причина'], 'в почтовом справочнике четыре живых адреса на это ФИО — адресат не опознан');
});

check('число согласуется со словом: пять адресов, шесть учёток', () => {
  const live = [1, 2, 3, 4, 5].map((n) => card({ name: 'Тестова Пятая Мария', email: 'y' + n + '@example.invalid', post: 'Роль ' + n, org: 'Сектор ' + n }));
  assert.equal(build.resolve('Тестова Пятая Мария', live, '')['причина'], 'в почтовом справочнике пять живых адресов на это ФИО — адресат не опознан');
  const dead = [1, 2, 3, 4, 5, 6].map((n) => card({ name: 'Тестов Шестой Пётр', email: 'd' + n + '@example.invalid', dn: 'CN=d' + n + ',OU=Disabled Objects,OU=GAL', disabled: true }));
  assert.equal(build.resolve('Тестов Шестой Пётр', dead, '')['причина'], 'все 6 учёток в отключённых объектах — писать некому');
});

check('отключённые учётки дают причину, а не кандидата', () => {
  const dead = [
    card({ name: 'Тестов Пётр Петрович', email: 'p1@example.invalid', dn: 'CN=a,OU=Disabled Objects,OU=GAL', disabled: true }),
    card({ name: 'Тестов Пётр Петрович', email: 'p2@example.invalid', dn: 'CN=b,OU=Disabled Objects,OU=GAL', disabled: true })
  ];
  const rec = build.resolve('Тестов Пётр Петрович', dead, '');
  assert.equal(rec['причина'], 'обе учётки в отключённых объектах — писать некому');
});

check('пустая выдача отличается от непроверенной: нет записей формулируется прямо', () => {
  assert.equal(build.resolve('Тестов Пётр Петрович', [], '')['причина'], 'в почтовом справочнике нет записи с этим ФИО');
});

(async () => {
  const src = fs.readFileSync(path.join(cwd, 'actions/find-mail-contacts/scripts/poll-ldap.js'), 'utf8');
  const body = new Function('tools', 'RUN', 'FROM', 'TO', 'BASEDN', src + '\nreturn run();');
  const people = ['Тестов Пётр Петрович', 'Тестова Анна Сергеевна', 'Тестов Илья Дмитриевич'];
  const artifactOf = (totals) => JSON.stringify({ employees: people.map((name, i) => (totals ? { name, total: totals[i] } : { name })) });
  // Имена куска и цель прогона помощник просит посчитать оболочку. Фейковая оболочка исполняет эти
  // программы настоящим node над подставным прогоном: тест проверяет сам текст программы помощника
  // и не расходится с ним, когда помощник добавляет или переставляет аргументы.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ppai-mail-poll-'));
  process.on('exit', () => fs.rmSync(sandbox, { recursive: true, force: true }));
  const call = async (o) => {
    const written = [];
    const seen = [];
    const goal = o.goal === undefined ? '5.5' : o.goal;
    const artifact = artifactOf(o.totals || [4.2, 3.1, 5]);
    const rel = path.join('outputs', '2026-11-19_почта-тест');
    fs.mkdirSync(path.join(sandbox, rel, '.run'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, rel, '.run', '01-read.json'), artifact);
    if (goal === null) fs.rmSync(path.join(sandbox, rel, '.run', 'state.json'), { force: true });
    else fs.writeFileSync(path.join(sandbox, rel, '.run', 'state.json'), JSON.stringify({ params: { goal } }));
    const tools = {
      'mcp__mcp_email__search_ldap': async (params) => {
        seen.push(params.query + (params.baseDN ? '|' + params.baseDN : ''));
        if (/Илья/.test(params.query)) throw new Error('превышен лимит запросов (429)');
        if (/Анна/.test(params.query)) return '👤 Тестова Анна Сергеевна\n📧 a@example.invalid\nDN: CN=a,OU=GAL\nCode: 0x3';
        return '👤 ' + params.query + '\n📧 p@example.invalid\nDN: CN=p,OU=GAL';
      },
      run_shell_command: async ({ command }) => {
        if(command.includes('setTimeout'))return {output:''};
        if(command.includes('--poll-input')){
          const values=JSON.parse(artifact).employees;
          const parts=command.match(/--poll-input "[^"]+" (\d+) (\d+)$/);
          return {output:JSON.stringify({goal:goal??'',names:values.slice(Number(parts[1]),Number(parts[2])).map((person,i)=>[Number(parts[1])+i,person.name,person.total]),files:(o.ls||'').split(/\s+/).filter(Boolean)})};
        }
        throw new Error('Непереносимая команда: '+command);

      },
      write_file: async ({ file_path }) => { written.push(path.basename(file_path)); return { ok: true }; }
    };
    return { out: JSON.parse(await body(tools, '2026-11-19_почта-тест', o.from, o.to, o.baseDN || '')), written, seen };
  };

  const general = await call({ from: 0, to: 3, ls: '000.txt' });
  check('опрос пропускает уже отвеченные имена и пишет выдачу каждого человека отдельным файлом', () => {
    assert.ok(!general.written.includes('000.txt'), 'уже отвеченное имя не опрашивается повторно');
    assert.equal(general.out.опрощено, 1);
    assert.ok(general.written.includes('001-s.txt'), 'таймлимит перепроверен коротким фильтром (правило 7)');
    assert.ok(general.seen.every((q) => !q.includes('|')), 'общий запрос идёт без сужения базы');
  });
  check('срыв по лимиту запросов попадает в счётчики без персональных данных', () => {
    assert.deepEqual(general.out.сорвалось, ['2: лимит запросов']);
    assert.ok(!JSON.stringify(general.out).includes('Тестов'), 'в сводке нет ФИО');
    assert.ok(!JSON.stringify(general.out).includes('@'), 'в сводке нет адресов');
  });

  const filtered = await call({ from: 0, to: 3, goal: '6.0', totals: [4, 7.5, 3] });
  check('опрашивают только адресатов рекомендаций: строку выше цели помощник не спрашивает', () => {
    assert.equal(filtered.out.адресатовКуска, 2, 'в опрос идут две строки ниже цели');
    assert.equal(filtered.out.внеСпискаАдресатов, 1, 'строка выше цели посчитана отдельно');
    assert.ok(!filtered.seen.some((q) => /Анна/.test(q)), 'человека выше цели справочник не видит');
    assert.equal(filtered.out.цель, '6.0');
  });

  const blind = await call({ from: 0, to: 3, goal: null });
  check('без читаемой цели опрос идёт по всем строкам куска, а не по пустому списку', () => {
    assert.equal(blind.out.адресатовКуска, 3, 'молча сузить периметр помощник не имеет права');
    assert.match(String(blind.out.цель), /не прочитана/);
  });

  const tree = await call({ from: 0, to: 1, baseDN: 'OU={OMEGA},OU=GAL,DC=example,DC=invalid' });
  check('вторая попытка в служебном дереве идёт по фамилии и сохраняет отдельный файл', () => {
    assert.equal(tree.out.режим, 'служебное дерево');
    assert.ok(tree.written.includes('000-n.txt'));
    assert.ok(tree.seen[0].startsWith('Тестов|OU={OMEGA}'), 'запрос по одной фамилии с базой дерева');
  });
  const probeSrc = fs.readFileSync(path.join(cwd, 'actions/find-mail-contacts/scripts/probe-mail.js'), 'utf8');
  const probe = (keys, behave) => new Function('tools', 'ALL_TOOLS', probeSrc + '\nreturn run("Тестов Пётр Петрович");')(
    Object.fromEntries(keys.map((k) => [k, behave])), Object.fromEntries(keys.map((k) => [k, 1])));

  const off = await probe([], null);
  check('без почтового подключения развилка получает «сервера нет», а не пустую выдачу', () => {
    assert.equal(off.найден, false);
    assert.match(off.почему, /нет почтового подключения/);
    assert.equal(off.почтовыхСерверов, 0);
  });

  const denied = await probe(['mcp__mcp_email__search_ldap'], async () => { throw new Error('Request failed with status code 403 for query Тестов'); });
  check('отвергнутый доступ — отдельный признак, и он не выдаёт ни ФИО, ни текст ошибки', () => {
    assert.equal(denied.проверено, false);
    assert.match(denied.чтение, /401|403/);
    assert.ok(!JSON.stringify(denied).includes('Тестов'), 'в признаках нет ФИО');
    assert.ok(!denied.чтение.includes('Request failed'), 'сырой текст ошибки наружу не печатается');
  });

  const live = await probe(['mcp__mcp_email__search_ldap'], async () => '👤 кто-то\n📧 a@example.invalid');
  check('ответивший справочник даёт переход к живому опросу', () => {
    assert.equal(live.найден, true);
    assert.equal(live.сервер, 'mcp_email');
    assert.equal(live.проверено, true);
  });

  const timeout = await probe(['mcp__mcp_email__search_ldap'], async () => '👤 кто-то\nCode: 0x3');
  check('таймлимит справочника не притворяется «адресов нет»', () => {
    assert.equal(timeout.проверено, false);
    assert.match(timeout.чтение, /не ответил за отведённое время/);
  });

  const ctx=require('../fixture')({prefix:'pk почта пробелы '}),tmp=ctx.tmp;
  try{
    const journal=require('../../tools/lib/runtime/run-journal');
    const run=journal.start(tmp,{process:'gmi-cluster-report',mode:'local',definitionTest:true,params:{methodologyCheck:'no',runDate:'19.11.2026',demo:true}}),output=run.output;
    journal.operation(tmp,'choose',{output,step:'methodology-gate',target:'read'});journal.execute(tmp,{output,step:'read'});
    journal.operation(tmp,'choose',{output,step:'mail-gate',target:'mail-off',decision:'Справочника нет'});
    journal.operation(tmp,'begin',{output,step:'mail-off'});
    const offline=spawnSync(process.execPath,[path.join(cwd,'actions/find-mail-contacts/scripts/build-map.js'),'outputs\\'+output+'\\.run','--без-подключения','почтового подключения в этой копии нет'],{cwd:tmp,encoding:'utf8'});
    check('portable helper uses the real artifact and current attemptId for offline save',()=>{
      assert.equal(offline.status,0,offline.stderr);const counters=JSON.parse(offline.stdout);assert.equal(counters.шаг,'mail-off');
      const spec=JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'.run/inputs/save-mail-off.json'),'utf8'));
      assert.equal(spec.attemptId,journal.operation(tmp,'next',{output}).save.attemptId);
      journal.operation(tmp,'save',spec);assert.equal(journal.operation(tmp,'next',{output}).spec.step,'assess');
      const before=fs.readFileSync(path.join(tmp,'outputs',output,'.run/state.json'),'utf8');
      const repeat=spawnSync(process.execPath,[path.join(cwd,'actions/find-mail-contacts/scripts/build-map.js'),output,'--без-подключения','нет'],{cwd:tmp,encoding:'utf8'});
      assert.notEqual(repeat.status,0);assert.equal(fs.readFileSync(path.join(tmp,'outputs',output,'.run/state.json'),'utf8'),before);
    });
  }finally{ctx.close();}

  console.log('✓ помощники шага сбора адресов работают по правилам рецепта');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

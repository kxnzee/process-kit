'use strict';
// Проверка расчёта и формы отчёта GigaCode Maturity Index: шкалы методики, отбор ниже цели,
// рычаги рекомендаций и честное поведение на пустых значениях. Ожидаемые числа посчитаны
// вручную по слайдам методики (reference.md), а не повторением формулы правила.
const { fs, path, assert, cwd, check, close } = (() => {
  const ctx = require('../../fixture')();
  return { ...ctx, cwd: ctx.tmp };
})();
const read = require('../../../actions/read-score-table/runtime.js');
const rules = require('../../../processes/gmi-cluster-report/rules/gmi.js');
const form = require('../../../processes/gmi-cluster-report/renderers/report.js');
const page = require('../../../processes/gmi-cluster-report/renderers/report-html.js');
const { validateValue, loadContract } = require('../../../tools/lib/contracts/value-contract');

const PROCESS = 'gmi-cluster-report';
const GOAL = { goal: '6.0', warnBelow: '3.0', runDate: '08.11.2026', demo: 'true', perimeter: 'все строки файла без отбора' };
const COURSES = ['Управление контекстом AI-агентов', 'AI-driven PDLC', 'Spec-Driven Development (SDD)', 'Agentic Coding. Базовый курс', 'Введение в GigaCode'];
const SKILLS = ['Prompting', 'Prompt engineering', 'Context management', 'Creating tools', 'Creating skills', 'Agent team'];
const METRICS = ['Трудоемкость', 'Строки кода', 'Коммиты ПРОМ', 'Коммиты', 'Строки кода на коммит', 'PR'];

const HEADERS = [
  'Инициатива', 'ЦА GigaCode', 'Частота использования', 'Номер сотрудникА', 'ФИО сотрудника', 'Код Команды', 'Команда', 'Основная роль',
  'ЦА Обучение контекст', 'ЦА Обучение SDD', ...COURSES, 'Режим использования', 'Обучения в срок',
  'Обучения БАЛЛ', 'Частота использования БАЛЛ', 'Режим использования БАЛЛ', 'Обучение и применение БАЛЛ',
  'Skills DONE', 'Skills DONE БАЛЛ', ...SKILLS.flatMap((name, index) => [`${index + 1}. ${name}`, `${index + 1}. ${name} DONE`]),
  'Skills SUM БАЛЛ', 'Количество токенов CLI', 'Когорта', 'Токены БАЛЛ', 'Навыки и токены БАЛЛ',
  ...METRICS.flatMap(name => [name, `${name} top bot`, `${name} к медиане`, `${name} медиана`, `${name} БАЛЛ`]),
  'Команда Story', 'Кластер Story', 'Story сравнение', 'Story БАЛЛ', 'Продуктивность и Story БАЛЛ', 'Общий итог'
];
const f = value => (value === null || value === undefined ? '-' : String(value).replace('.', ','));

// Строка выгрузки: баллы частей человек пишет руками (ожидания теста), а не формулой теста.
function line(person) {
  const cells = {
    'Инициатива': 'GigaCode_regular', 'ЦА GigaCode': 'Да', 'Номер сотрудникА': person.id, 'ФИО сотрудника': person.name || '-',
    'Код Команды': person.team || 'AA0001', 'Команда': person.teamTitle || '-',
    'Основная роль': person.role || 'Разработчик', 'ЦА Обучение контекст': '1', 'ЦА Обучение SDD': '1',
    'Частота использования': person.frequency, 'Режим использования': person.mode, 'Обучения в срок': f(person.onTime),
    'Обучения БАЛЛ': f(person.courseBall), 'Частота использования БАЛЛ': f(person.frequencyBall), 'Режим использования БАЛЛ': f(person.modeBall),
    'Обучение и применение БАЛЛ': f(person.trainingBall),
    'Skills DONE': person.plan, 'Skills DONE БАЛЛ': f(person.planBall), 'Skills SUM БАЛЛ': f(person.skillBall),
    'Количество токенов CLI': f(person.tokens), 'Когорта': person.cohort || '-', 'Токены БАЛЛ': f(person.cohortBall), 'Навыки и токены БАЛЛ': f(person.skillsBall),
    'Команда Story': f(person.storyTeam), 'Кластер Story': '105', 'Story сравнение': person.storyCompare, 'Story БАЛЛ': f(person.storyBall),
    'Продуктивность и Story БАЛЛ': f(person.productivityBall), 'Общий итог': f(person.total)
  };
  COURSES.forEach((header, index) => { cells[header] = (person.courses || [])[index] || 'Не завершен'; });
  SKILLS.forEach((name, index) => {
    const skill = (person.skills || [])[index] || [2, 0];
    cells[`${index + 1}. ${name}`] = String(skill[0]); cells[`${index + 1}. ${name} DONE`] = String(skill[1]);
  });
  METRICS.forEach(name => {
    const metric = (person.metrics || {})[name] || [null, 'bot', null, 100, 0];
    cells[name] = f(metric[0]); cells[`${name} top bot`] = metric[1]; cells[`${name} к медиане`] = f(metric[2]);
    cells[`${name} медиана`] = f(metric[3]); cells[`${name} БАЛЛ`] = f(metric[4]);
  });
  const declared = HEADERS.map(header => cells[header]);
  if (declared.some(value => value === undefined)) throw new Error(`нет значений для столбцов: ${HEADERS.filter((header, index) => declared[index] === undefined).join(', ')}`);
  return declared.map(value => String(value));
}

// Таблица с произвольной шапкой: так проверяются запасные заголовки («ТН» вместо «Номер…»).
function readRaw(headers, rows, params = {}) {
  const file = '.gigacode-tmp-selftest-raw.json';
  fs.writeFileSync(path.join(cwd, file), JSON.stringify({ headers, rows }));
  return read.execute({ cwd, processName: PROCESS, actionName: 'read-score-table', requires: { actions: ['read-score-table'] }, params: { scoreFile: file, ...params } });
}
function readTable(rows, params = {}) { return readRaw(HEADERS, rows, params); }
const assess = (scores, params = {}) => rules.evaluate({ scores }, { ...GOAL, ...params });
// Сильный сотрудник: все шкалы на максимум (3 + 3 + 4 = 10).
const STRONG = {
  id: '9000101', frequency: 'Ежедневно', mode: 'Агент', onTime: 5, courseBall: 1, frequencyBall: 1, modeBall: 1, trainingBall: 3,
  plan: 'Да', planBall: 1, skillBall: 1, cohort: 'power users', cohortBall: 1, skillsBall: 3, tokens: 6400,
  courses: COURSES.map(() => 'Завершен в срок'), skills: SKILLS.map(() => [4, 1]),
  metrics: Object.fromEntries(METRICS.map(name => [name, [200, 'top', 140, 142, 0.5]])),
  storyTeam: 160, storyCompare: 'Команда выше цели кластера', storyBall: 1, productivityBall: 4, total: 10
};
// Ниже цели: 1,3 + 0,5 + 1,2 = 3,0 — ровно на предупреждающем пороге.
const WEAK = {
  id: '9000102', frequency: 'Еженедельно', mode: 'Ассистент', onTime: 2, courseBall: 0.3, frequencyBall: 0.5, modeBall: 0.5, trainingBall: 1.3,
  plan: 'Нет', planBall: 0, skillBall: 0.2, cohort: 'низкое использование', cohortBall: 0.3, skillsBall: 0.5, tokens: 300,
  courses: ['Завершен в срок', 'Завершен в срок', 'Не завершен', 'Не завершен', 'Не завершен'],
  skills: [[3, 1], [3, 1], [2, 0], [2, 0], [1, 0], [2, 0]],
  metrics: { 'Трудоемкость': [8, 'bot', 8, 100, 0], 'Строки кода': [1200, 'mid', 48, 2500, 0.3], 'Коммиты ПРОМ': [20, 'mid', 60, 33, 0.3], 'Коммиты': [10, 'bot', 12, 85, 0], 'Строки кода на коммит': [60, 'mid', 66, 91, 0.3], 'PR': [12, 'mid', 55, 22, 0.3] },
  storyTeam: 40, storyCompare: 'Команда ниже цели кластера', storyBall: 0, productivityBall: 1.2, total: 3
};
// Пустой «Общий итог»: строка не участвует ни в средних, ни в отборе ниже цели.
const NO_TOTAL = { ...WEAK, id: '9000103', total: null };
// Незнакомая градация частоты: часть блока остаётся неподтверждённой, а не становится нулём.
const ODD = { ...WEAK, id: '9000104', frequency: 'Резко чаще', frequencyBall: null, trainingBall: 0.8, total: 2 };

const rows = () => [line(STRONG), line(WEAK), line(NO_TOTAL), line(ODD)];
const ask = (data, scope) => data.questions.filter(question => question.scope === scope);

try {
  const scores = readTable(rows());
  const data = assess(scores);

  check('чтение даёт сотрудников отдельно от строк без номера, расчёт проходит контракт, форма сверяется', () => {
    assert.equal(scores.employees.length, 4);
    assert.equal(scores.skipped.length, 0);
    validateValue(loadContract(cwd, `processes/${PROCESS}/contracts/report-data.json`), data);
    const text = form.render(data);
    form.validate(text, data);
    assert.ok(text.includes('ДАННЫЕ ДЕМО'), 'демонстрационный прогон не помечен');
  });

  check('HTML-форма сохраняет разделы, числа и сотрудников и отклоняет ручную правку', () => {
    const html = page.render(data);
    page.validate(html, data);
    const markdown = form.render(data);
    assert.ok(html.startsWith('<!doctype html>') && html.includes('</script>'), 'страница не самостоятельная: стили и переключение разделов должны быть внутри');
    assert.ok(!/\{\{[^{}]*\}\}/.test(html), 'в страницу попала незаполненная переменная формы');
    // Разделы страницы — ровно заголовки второго уровня текстовой формы, в том же порядке.
    const titles = [...markdown.matchAll(/^## (.+)$/gm)].map(match => match[1]);
    assert.deepEqual([...html.matchAll(/<h2>(.+?)<\/h2>/g)].map(match => match[1]), titles, 'разделы HTML разошлись с формой отчёта');
    assert.equal((html.match(/<button data-go=/g) || []).length, titles.length, 'кнопок навигации не по числу разделов');
    // Цифры кластера печатаются карточками, а человек ниже цели остаётся строкой таблицы.
    assert.equal((html.match(/class="chip"/g) || []).length, data.cluster.length, 'карточек кластера не по числу строк цифр');
    for (const row of data.cluster) assert.ok(html.includes(`<b>${row.value}</b><i>${row.label}</i>`), `цифра кластера потеряна из карточек: ${row.label}`);
    for (const person of data.people) assert.ok(html.includes(`>${person.who}<`), `человек не попал в сводную таблицу: ${person.who}`);
    assert.ok(html.includes('ДАННЫЕ ДЕМО'), 'HTML-отчёт потерял пометку демонстрационных данных');
    assert.throws(() => page.validate(html + '\n<p>правка вручную</p>', data), /штатное формирование/);
  });

  check('сводная таблица сохраняет все рычаги и оценку рядом со статусом каждого человека', () => {
    const summary = form.render(data).split('## Сводная таблица')[1].split('## Что делать каждому')[0];
    for (const person of data.people) {
      const row = summary.split('\n').find(line => line.startsWith(`| ${person.ordinal} |`));
      assert.ok(row, `нет строки ${person.id}`);
      const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
      for (const lever of person.levers) assert.ok(cells[8].includes(lever.brief), `в рекомендации ${person.id} потерян рычаг ${lever.kind}`);
      assert.equal(cells[9], person.grade ? `${person.grade} — ${person.status}` : person.status);
    }
  });

  check('письмо сотруднику: адрес из почтового справочника по точному ФИО, без сверки с задачами', () => {
    const letters = readTable([
      line({ ...WEAK, id: '9000201', name: 'Письмов Евгений Васильевич' }),
      line({ ...ODD, id: '9000202', name: 'Двойников И. И.' }),
      line({ ...ODD, id: '9000203', name: 'Двойников И. И.' }),
      line({ ...ODD, id: '9000204', name: 'БезАдреса И. И.' }),
      line({ ...ODD, id: '9000205', name: 'Плоский И. И.' }),
      line({ ...ODD, id: '9000206', name: 'Пустой И. И.' })
    ]);
    const book = {
      // Адрес из справочника: ФИО совпало с точностью до лишних пробелов — письмо есть.
      '  Письмов   Евгений  Васильевич ': { email: 'pismov@example.com' },
      'Двойников И. И.': 'dvoynikov@example.com',
      // Человек в карте есть, но адреса нет, и известно почему: справочник дал двух разных людей.
      'БезАдреса И. И.': { причина: 'в почтовом справочнике два разных человека с этим ФИО' },
      // Плоская карта «ФИО → адрес» даёт письмо наравне с записью с пояснениями.
      'Плоский И. И.': 'ploskiy@example.com',
      // Запись без адреса и без причины: остаётся общее объяснение.
      'Пустой И. И.': {},
      'Лишний И. И.': 'extra@example.com'
    };
    const data3 = rules.evaluate({ scores: letters, people: book }, GOAL);
    const rowOf = id => data3.people.find(person => person.id === id);
    // Право на ссылку даёт адрес по точному совпадению ФИО; номеров учётных записей в карте больше
    // нет. Одинаковое ФИО письма не получает — оно ушло бы не тому человеку.
    assert.equal(rowOf('9000201').email, 'pismov@example.com');
    assert.equal(rowOf('9000201').letterReason, null, 'адресу из справочника выставлена причина');
    assert.equal(rowOf('9000205').email, 'ploskiy@example.com', 'плоская карта адресов не стала письмом');
    assert.equal(rowOf('9000205').letterReason, null, 'плоской карте адресов выставлена причина');
    assert.deepEqual([rowOf('9000202').email, rowOf('9000203').email], [null, null], 'одинаковым ФИО выдан адрес');
    assert.equal(rowOf('9000204').email, null, 'человеку без адреса выдан адрес');
    assert.equal(rowOf('9000204').letterReason, 'в почтовом справочнике два разных человека с этим ФИО', 'причина из карты адресов подменена общей');
    const html = page.render(data3);
    page.validate(html, data3);
    const links = [...html.matchAll(/href="(mailto:[^"]*)"/g)].map(match => match[1].replace(/&amp;/g, '&'));
    // Ссылки у двух адресов; у остальных либо два разных человека под одним ФИО, либо адреса нет.
    assert.equal(links.length, 2, 'ссылок на письма больше, чем подтверждённых адресов');
    assert.ok(links.some(link => link.startsWith('mailto:ploskiy@example.com?')), 'адрес из плоской карты не попал в страницу');
    const href = links.find(link => link.startsWith('mailto:pismov@example.com?'));
    const subject = new URL(href).searchParams.get('subject');
    assert.equal(subject, 'Точки роста по итогам оценки: что сделать');
    assert.doesNotMatch(subject, /[\u0000-\u001f\u007f]/);
    assert.ok(!subject.includes(rowOf('9000201').who), 'в тему письма попало ФИО');
    assert.ok(href, 'адрес не попал в ссылку письма');
    const body = decodeURIComponent(href.split('&body=')[1]);
    // Тело = ровно те формулировки «что сделать», что напечатаны над ссылкой: без математики.
    const bullets = body.split('\r\n').filter(text => text.startsWith('- ')).map(text => text.slice(2));
    assert.deepEqual(bullets, rowOf('9000201').levers.map(lever => lever.text), 'в письмо попал не тот набор действий');
    assert.doesNotMatch(body, /балл|потенциал|степень улучшения|до цели|\+[\d,]/i, 'в письмо вернулась математика шкал');
    assert.ok(!links.some(link => decodeURIComponent(link).includes('extra@example.com')), 'чужой адрес из карты попал в страницу');
  });

  check('ambiguous mail candidates remain a human choice with safe links and labels',()=>{
    const scores=readTable([line({...WEAK,name:'Synthetic Choice'})]);
    const candidates=[{'почта':'first@example.invalid','должность':'<svg/onload=alert(1)>','отдел':'A'},{'почта':"o'brien+tag@example.invalid",'должность':'Second','отдел':'B'}];
    const result=rules.evaluate({scores,people:{'Synthetic Choice':{name:'Synthetic Choice',кандидаты:candidates}}},GOAL);
    assert.equal(result.people[0].email,null);assert.equal(result.people[0].letterOptions.length,2);
    validateValue(loadContract(cwd,`processes/${PROCESS}/contracts/report-data.json`),result);
    const html=page.render(result);assert.doesNotMatch(html,/<svg/);
    const links=[...html.matchAll(/class="mail" href="([^"]*)"/g)].map(match=>new URL(match[1].replace(/&amp;/g,'&')));
    assert.deepEqual(links.map(url=>decodeURIComponent(url.pathname)),candidates.map(row=>row['почта']));
    for(const url of links){assert.equal(url.protocol,'mailto:');assert.deepEqual([...url.searchParams.keys()],['subject','body']);}
    for(const bad of ['x"><svg/onload=alert(1)>@example.com','\ud800@example.com']){
      const unsafe=rules.evaluate({scores,people:{'Synthetic Choice':{кандидаты:[{почта:bad},...candidates]}}},GOAL);
      assert.ok(!unsafe.people[0].letterOptions.some(option=>option.email===bad));assert.doesNotThrow(()=>page.render(unsafe));
    }
  });

  check('боевой прогон с demo=false не помечается демонстрационным', () => {
    // Параметр из PROCESS.md приходит строкой: 'false' не должен читаться как правда.
    const real = assess(scores, { demo: 'false' });
    assert.equal(real.meta.demo, false);
    assert.ok(!form.render(real).includes('ДАННЫЕ ДЕМО'), 'строгий прогон назван демонстрационным');
    assert.ok(data.notes.some(note => /ДАННЫЕ ДЕМО/.test(note)), 'демонстрационный прогон потерял пометку');
  });

  check('адрес справочника и прямой вход рендера не могут внедрить HTML или параметры письма', () => {
    const named = readTable([line({ ...WEAK, name: 'Synthetic Person' })]);
    const payload = 'x"><svg/onload=alert(1)>@example.com';
    for (const entry of [payload, { email: payload }]) {
      const result = rules.evaluate({ scores: named, people: { 'Synthetic Person': entry } }, GOAL);
      assert.equal(result.people[0].email, null);
      assert.doesNotMatch(page.render(result), /<svg|onload=/);
    }
    const direct = assess(named);
    for (const email of [payload, 'x?bcc=other@example.com', 'x&bcc=other@example.com', 'x,y@example.com', 'x#fragment@example.com', 'x%0D%0ABcc:other@example.com', "o'brien+tag@example.com"]) {
      direct.people[0].email = email;
      const html = page.render(direct);
      assert.doesNotMatch(html, /<svg|<a[^>]*\sonload=/);
      const href = html.match(/class="mail" href="([^"]*)"/)[1].replace(/&amp;/g, '&');
      const url = new URL(href);
      assert.equal(url.protocol, 'mailto:');
      assert.equal(decodeURIComponent(url.pathname), email);
      assert.deepEqual([...url.searchParams.keys()], ['subject', 'body']);
      assert.equal(url.hash, '');
    }
    const valid = rules.evaluate({ scores: named, people: { 'Synthetic Person': "o'brien+tag@example.com" } }, GOAL);
    assert.equal(valid.people[0].email, "o'brien+tag@example.com");
    for (const email of ['\ud800@example.com', '\udfff@example.com']) {
      const result = rules.evaluate({ scores: named, people: { 'Synthetic Person': email } }, GOAL);
      assert.equal(result.people[0].email, null);
      assert.doesNotThrow(() => page.render(result));
      direct.people[0].email = email;
      assert.throws(() => page.render(direct), /Адрес письма: некорректная строка Unicode/);
    }
  });

  check('пустые статусы курсов и DONE остаются неизвестными без балльных рекомендаций', () => {
    const blank = line(WEAK);
    HEADERS.forEach((header, index) => {
      if (COURSES.includes(header) || /^\d+\..* DONE$/.test(header)) blank[index] = '-';
    });
    const input = readTable([blank]);
    assert.equal(input.gaps.filter(gap => COURSES.includes(gap.field) || /^\d+\..* DONE$/.test(gap.field)).length, 11);
    const result = assess(input);
    const row = result.people[0];
    assert.ok(row.gaps.some(gap => /курс/i.test(gap)));
    assert.ok(row.gaps.some(gap => /навык/i.test(gap)));
    assert.ok(!row.levers.some(lever => ['курсы', 'навыки'].includes(lever.kind)));
    assert.ok(row.levers.some(lever => lever.kind === 'частота'));
    validateValue(loadContract(cwd, `processes/${PROCESS}/contracts/report-data.json`), result);
    assert.ok(form.render(result).includes('Не подтверждено в выгрузке'));
    // Один пропуск тоже не даёт считать неизвестную базу подтверждённым нулём.
    for (const header of [COURSES[0], '1. Prompting DONE']) {
      const partial = line(WEAK); partial[HEADERS.indexOf(header)] = '';
      const person = assess(readTable([partial])).people[0];
      assert.ok(person.gaps.length);
      assert.ok(!person.levers.some(lever => lever.kind === (COURSES.includes(header) ? 'курсы' : 'навыки')));
    }
  });

  check('достижение цели и остаток согласованы при расхождении итога и пересчёта', () => {
    for (const total of [1, 5.9]) {
      const result = assess(readTable([line({ ...WEAK, total })]));
      const row = result.people[0];
      assert.equal(row.reachesGoal, row.total + row.potential >= 6);
      assert.equal(row.reachesGoal, row.leftToGoal === 0);
      if (!row.reachesGoal) assert.ok(form.render(result).includes('остаётся'));
      page.validate(page.render(result), result);
    }
  });

  check('только явный статус завершения в срок даёт балл курсов', () => {
    for (const status of ['Завершен не в срок', 'Завершён не в срок', 'Завершен с опозданием', 'Не завершен вовремя', 'Не завершен в срок']) {
      const input = readTable([line({ ...WEAK, courses: COURSES.map(() => status) })]);
      const row = assess(input).people[0];
      assert.equal(row.training, 1, status);
      const advice = row.levers.find(lever => lever.kind === 'курсы');
      assert.ok(advice, status);assert.equal(advice.gain, 1, status);
    }
    for (const status of ['Завершен в срок', 'Завершён в срок', ' ЗАВЕРШЁН  В\tСРОК ']) {
      const row = assess(readTable([line({ ...WEAK, courses: COURSES.map(() => status) })])).people[0];
      assert.equal(row.training, 2, status);
      assert.ok(!row.levers.some(lever => lever.kind === 'курсы'), status);
    }
  });

  check('курсы вне целевой аудитории засчитываются при просроченном статусе', () => {
    const cells = line({ ...WEAK, courses: COURSES.map(() => 'Завершен не в срок') });
    cells[HEADERS.indexOf('ЦА Обучение контекст')] = '0';
    cells[HEADERS.indexOf('ЦА Обучение SDD')] = '0';
    const row = assess(readTable([cells])).people[0];
    assert.equal(row.training, 1.3);
    const advice = row.levers.find(lever => lever.kind === 'курсы');
    assert.equal(advice.gain, 0.7);assert.equal(advice.items.length, 3);
  });

  check('шкалы слайдов дают максимум 3 + 3 + 4 сильному сотруднику', () => {
    const row = data.people.find(person => person.id === STRONG.id);
    assert.deepEqual([row.training, row.skills, row.productivity, row.total], [3, 3, 4, 10]);
    assert.equal(row.status, 'цель достигнута');
    assert.deepEqual(row.levers, [], 'сотруднику на максимуме шкал выставлена рекомендация');
  });

  check('расчёт правила сходится с баллами выгрузки', () => {
    assert.deepEqual(data.mismatches.filter(row => row.id !== ODD.id), []);
    assert.equal(data.counters.mismatches, data.mismatches.length);
  });

  check('отбор ниже цели и знаменатель средних считают по заполненному итогу', () => {
    assert.deepEqual([data.counters.employees, data.counters.counted, data.counters.belowGoal, data.counters.reachedGoal, data.counters.withoutTotal], [4, 3, 2, 1, 1]);
    // Строка без «Общий итог» в знаменатель и в отбор не входит; ниже 3,0 — одна строка с итогом 2.
    assert.deepEqual([data.counters.belowWarn, data.cluster.find(row => row.label === 'Ниже 3,0').value], [1, '1']);
    assert.equal(data.cluster.find(row => row.label === 'Кол-во сотрудников').value, '4');
    assert.equal(data.cluster.find(row => row.label === 'Средний GMI').value, ((10 + 3 + 2) / 3).toFixed(2).replace('.', ','));
    assert.deepEqual(data.cluster.map(row => row.label), ['Кол-во сотрудников', 'Средний GMI', 'Общий балл', 'Обучение и применение', 'Навыки', 'Продуктивность', 'Ниже 3,0', 'Ниже 6,0']);
  });

  check('сводная таблица отсортирована от меньшего итога, строка без итога — последней', () => {
    assert.deepEqual(data.people.map(row => row.id), [ODD.id, WEAK.id, STRONG.id, NO_TOTAL.id]);
    assert.deepEqual(data.people.map(row => row.ordinal), [1, 2, 3, 4]);
    assert.equal(data.people.at(-1).status, 'итог в файле не заполнен');
  });

  check('оценка A–E вычисляется по целевому и предупреждающему порогам', () => {
    const gradeOf = id => data.people.find(row => row.id === id).grade;
    // Цель 6,0 и предупреждающий порог 3,0: A — от 7,5, B — от 6,0, C — от 4,5, D — от 3,0, E — ниже.
    assert.deepEqual([gradeOf(STRONG.id), gradeOf(WEAK.id), gradeOf(ODD.id), gradeOf(NO_TOTAL.id)], ['A', 'D', 'E', null]);
  });

  check('рекомендация считает рычаги по следующей ступени той же шкалы', () => {
    const row = data.people.find(person => person.id === WEAK.id);
    const lever = kind => row.levers.find(item => item.kind === kind);
    assert.deepEqual([lever('курсы').gain, lever('частота').gain, lever('режим').gain, lever('навыки').gain, lever('когорта').gain, lever('story').gain], [0.7, 0.5, 0.5, 0.4, 0.2, 1]);
    // Метрик продуктивности шесть, но в рекомендацию берутся три самые отстающие: список не
    // должен превращаться в переписывание всех колонок. Все они не дотягивают до top, прирост —
    // до следующей ступени той же шкалы: два bot→mid по 0,3 и один mid→top на 0,2.
    const metrics = row.levers.filter(item => item.kind === 'метрики');
    assert.equal(metrics.length, 3);
    assert.equal(Math.round(metrics.reduce((sum, item) => sum + item.gain, 0) * 100) / 100, 0.8);
    assert.equal(row.potential, 4.1);
    assert.equal(row.reachesGoal, true);
    assert.equal(row.leftToGoal, 0);
  });

  check('незнакомая градация остаётся неподтверждённой и не превращается в ноль промолчанием', () => {
    const row = data.people.find(person => person.id === ODD.id);
    assert.ok(row.gaps.some(gap => /частота/i.test(gap)), 'форма молчит о неизвестной частоте');
    assert.ok(!row.levers.some(lever => lever.kind === 'частота'), 'из неизвестной градации сделан вывод о шаге шкалы');
  });

  check('без итогового балла строка не получает статуса и рекомендации', () => {
    const row = data.people.find(person => person.id === NO_TOTAL.id);
    assert.equal(row.total, null);
    assert.deepEqual(row.levers, []);
    assert.ok(ask(data, 'Общий итог').length, 'про пустой итог нет вопроса человеку');
  });

  check('ФИО берутся из справочника, без него остаётся табельный номер', () => {
    const names = '.gigacode-tmp-selftest-names.json';
    fs.writeFileSync(path.join(cwd, names), JSON.stringify({ [STRONG.id]: 'Иванов И. И.' }));
    const second = assess(readTable(rows(), { nameFile: names }), {});
    assert.deepEqual([second.meta.names.matched, second.meta.names.unmatched], [1, 3]);
    assert.equal(second.people.find(person => person.id === STRONG.id).who, 'Иванов И. И.');
    assert.equal(second.people.find(person => person.id === WEAK.id).who, WEAK.id);
    const text = form.render(second);
    assert.ok(text.includes('Иванов И. И.') && text.includes(WEAK.id));
    assert.equal(ask(second, 'ФИО').length, 0, 'справочник подложен, а вопрос про ФИО остался');
    assert.ok(ask(data, 'ФИО').length, 'без справочника процесс не задал вопроса о ФИО');
  });

  check('свежая выгрузка даёт ФИО и название команды, номер читается и как «ТН»', () => {
    const withNames = [line({ ...STRONG, name: 'Иванов И. И.', teamTitle: 'ЕПК СС360' }), line({ ...WEAK, name: 'Петрова А. А.', teamTitle: 'ЕПК СС360' }), line(NO_TOTAL), line(ODD)];
    const filled = assess(readTable(withNames));
    assert.deepEqual([filled.meta.names.source, filled.meta.names.column], ['колонка таблицы', 'ФИО сотрудника']);
    assert.deepEqual([filled.meta.names.matched, filled.meta.names.unmatched], [2, 2]);
    assert.equal(filled.people.find(person => person.id === STRONG.id).who, 'Иванов И. И.', 'ФИО из колонки не попали в отчёт');
    assert.equal(filled.people.find(person => person.id === WEAK.id).team, 'ЕПК СС360', 'в таблице осталась код команды вместо названия');
    assert.equal(filled.people.find(person => person.id === ODD.id).who, ODD.id, 'строка без ФИО потеряла идентификатор');
    assert.equal(ask(filled, 'ФИО').length, 0, 'имена в файле есть, а процесс всё равно спрашивает');
    // Колонка выгрузки важнее справочника: в отчёт идёт то, что человек принёс вместе с числами.
    const other = '.gigacode-tmp-selftest-names-other.json';
    fs.writeFileSync(path.join(cwd, other), JSON.stringify({ [STRONG.id]: 'Другой И. И.' }));
    const both = assess(readTable(withNames, { nameFile: other }));
    assert.equal(both.people.find(person => person.id === STRONG.id).who, 'Иванов И. И.', 'справочник перекрыл колонку выгрузки');
    // Тот же файл с запасным заголовком номера читается без правок: «ТН» вместо «Номер сотрудникА».
    const alt = readRaw(HEADERS.map(header => header === 'Номер сотрудникА' ? 'ТН' : header), withNames);
    assert.deepEqual(alt.employees.map(employee => employee.id), [STRONG.id, WEAK.id, NO_TOTAL.id, ODD.id]);
    assert.ok(!alt.source.unknownColumns.includes('ТН'), 'запасной заголовок номера посчитан неиспользуемым');
  });

  check('общий рычаг складывает приросты всех метрик человека, а не первого', () => {
    // У слабого сотрудника три метрических рычага: 0,3 + 0,3 + 0,2. Считать только первый —
    // занижать потенциал всего периметра вдвое.
    const aggregate = data.levers.find(item => item.lever === 'метрики продуктивности ниже медианы целевой аудитории');
    assert.deepEqual([aggregate.people, Math.round(aggregate.potential * 100) / 100], [2, 1.6]);
    assert.ok(aggregate.details.every(item => item.people >= 1), 'у общей строки нет состава по людям');
  });

  check('форма не даёт пересчитать текст вручную, чтение требует вход', () => {
    const broken = structuredClone(data); broken.counters.belowGoal += 1;
    assert.throws(() => form.render(broken), /не сходится с разбивкой по статусам/);
    assert.throws(() => form.validate(form.render(data) + '\n- правка вручную', data), /штатное формирование/);
    const context = { cwd, processName: PROCESS, actionName: 'read-score-table', requires: { actions: ['read-score-table'] } };
    assert.throws(() => read.execute({ ...context, params: {} }), /scoreFile/);
    assert.throws(() => read.execute({ ...context, params: { scoreFile: '.gigacode-tmp-selftest-table.csv' } }), /\.xlsx или \.json/);
  });

  check('пустая выборка сохраняет нулевые счётчики и вопрос о периметре', () => {
    const empty = assess(readTable([]));
    assert.equal(empty.counters.employees, 0);
    assert.equal(empty.people.length, 0);
    assert.ok(ask(empty, 'Периметр').length, 'пустой файл не назван вопросом');
  });

  check('файл без обязательных столбцов останавливается с перечнем недостающего', () => {
    const file = '.gigacode-tmp-selftest-broken.json';
    const keep = HEADERS.indexOf('Общий итог');
    fs.writeFileSync(path.join(cwd, file), JSON.stringify({ headers: HEADERS.filter((_, index) => index !== keep), rows: rows().map(row => row.filter((_, index) => index !== keep)) }));
    assert.throws(() => read.execute({ cwd, processName: PROCESS, actionName: 'read-score-table', requires: { actions: ['read-score-table'] }, params: { scoreFile: file } }), /Общий итог/);
  });
} finally { close(); }

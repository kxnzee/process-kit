'use strict';
const { fs, path, assert, cwd, source, check, close } = (() => {
  const ctx = require('../../fixture')();
  return { ...ctx, cwd: ctx.tmp };
})();
const rules = require('../../../processes/info-povod/rules/info-povod');
const form = require('../../../processes/info-povod/renderers/report');
const { validateValue, loadContract } = require('../../../tools/lib/contracts/value-contract');

const PROCESS = 'info-povod';
const fx = JSON.parse(fs.readFileSync(path.join(source, `processes/${PROCESS}/fixture.json`), 'utf8'));

// Классификацию пишет шаг-агент, в фикстуре её нет: строки собираются по составу релизов,
// а статусы сверки подставляет тест — по одному на каждый разбор.
const PLAN = {
  'DEMO-601': { cls: 'contained', agreement: 'conflict', rules: ['T-CONF-01'], question: 'признак T-CONF-01 даёт технический класс, а новые поля выгрузки — содержательный: подтвердите класс или назовите свой' },
  'DEMO-602': { cls: 'technical', agreement: 'confirmed', rules: ['T-SEC-01'] },
  'DEMO-603': { cls: 'technical', agreement: 'weak', rules: ['C-INCIDENT-01'], question: 'правка по инциденту: изменится ли ответ системы для читателя или правка только внутренняя?' },
  'DEMO-604': { cls: 'unknown', agreement: 'question', question: 'что именно меняется у читателя в этой задаче?' },
  'DEMO-606': { cls: 'contained', agreement: 'reasoned' }
};

function classifiedFrom(selection, plan) {
  const items = [];
  for (const release of selection.records) {
    for (const member of release.members || []) {
      const row = plan[member.key];
      if (!row) throw new Error(`нет плана классификации для ${member.key}`);
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
  const byStatus = status => items.filter(item => item.agreement === status).map(item => item.key);
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
    conflicts: byStatus('conflict'), weak: byStatus('weak'), questions: byStatus('question'),
    compositionUnread: [], rulesGaps: [], understandingInsufficient: false,
    understandingInsufficientReason: null, items
  };
}

const assess = (selection, classified) => rules.evaluate({ releases_demo: selection, classified_demo: classified }, fx.parameters);
const ask = (data, key) => data.questions.find(row => row.scope === key);

try {
  const selection = structuredClone(fx.result);
  const classified = classifiedFrom(selection, PLAN);

  check('артефакт классификации проходит контракт со списком слабого признака', () => {
    validateValue(loadContract(cwd, 'actions/classify-issuance/contracts/result.json'), classified);
    const withoutWeak = structuredClone(classified); delete withoutWeak.weak;
    assert.throws(() => validateValue(loadContract(cwd, 'actions/classify-issuance/contracts/result.json'), withoutWeak), /\.weak: обязательное поле/);
  });

  const data = assess(selection, classified);

  check('данные отчёта проходят контракт процесса, форма собирается и сверяется', () => {
    validateValue(loadContract(cwd, `processes/${PROCESS}/contracts/report-data.json`), data);
    const text = form.render(data);
    form.validate(text, data);
  });

  check('задача со слабым признаком попадает в вопросы', () => {
    const row = ask(data, 'DEMO-603');
    assert.ok(row, 'вопроса про задачу только со слабым признаком нет');
    assert.equal(row.cause, 'weak-rule');
    assert.equal(row.text, PLAN['DEMO-603'].question);
    assert.ok(form.render(data).includes('опора только на слабый признак'));
  });

  check('вопрос не меняет счётчики классов: задача учтена своим классом', () => {
    // Счётчик бизнес-задач считает всё показанное, то есть содержательные вместе с задачами
    // без класса; техническая считается отдельно. Вопрос на эти числа не влияет.
    assert.deepEqual([data.counters.storyCount, data.counters.technicalStoryCount, data.counters.unknownStoryCount], [3, 2, 1]);
    assert.equal(data.counters.storyCount - data.counters.unknownStoryCount, classified.byClass.contained);
    assert.equal(data.counters.questionCount, data.questions.length);
    assert.ok(form.render(data).includes('Бизнес задач: 3 · Технических задач: 2 · из них без класса: 1'));
  });

  check('текст вопроса классификатора печатается дословно', () => {
    const row = ask(data, 'DEMO-601');
    assert.equal(row.cause, 'rule-conflict');
    assert.equal(row.text, PLAN['DEMO-601'].question);
    assert.equal(ask(data, 'DEMO-604').cause, 'unknown-meaning');
  });

  check('без текста вопроса расчёт не приписывает правилу класс задачи и говорит об этом', () => {
    const silent = structuredClone(classified);
    for (const key of ['DEMO-601', 'DEMO-603']) silent.items.find(item => item.key === key).question = null;
    const asked = assess(selection, silent);
    const conflict = ask(asked, 'DEMO-601'), weak = ask(asked, 'DEMO-603');
    assert.match(conflict.text, /правило T-CONF-01 читается иначе, чем текст задачи/);
    assert.match(conflict.text, /подтвердите напечатанный класс «содержательная»/);
    assert.match(weak.text, /класс «техническая» держится только на слабом признаке C-INCIDENT-01/);
    assert.ok(!/относит задачу к классу/.test(conflict.text + weak.text), 'аварийная строка называет класс задачи классом правила');
    assert.ok(asked.notes.some(note => /причину вопроса для 2 задач сформулировал расчёт .*DEMO-601, DEMO-603/.test(note)));
  });

  check('расхождение списка шапки со статусом строки не проходит молча', () => {
    const mixed = structuredClone(classified);
    mixed.conflicts.push('DEMO-602');
    const asked = assess(selection, mixed);
    assert.ok(asked.notes.some(note => /список conflicts в шапке артефакта расходится со статусами строк \(DEMO-602\)/.test(note)));
    assert.ok(!ask(asked, 'DEMO-602'), 'задача со статусом confirmed попала в вопросы');
  });

  check('у релиза без плановой даты своя причина вопроса', () => {
    const dated = structuredClone(selection);
    dated.records.find(release => release.key === 'DEMO-507').plannedAt = null;
    const asked = assess(dated, classified);
    assert.equal(ask(asked, 'DEMO-507').cause, 'missing-date');
    assert.ok(form.render(asked).includes('нет плановой даты внедрения'));
  });

  check('неизвестная причина вопроса отклоняется формой', () => {
    const broken = structuredClone(data);
    broken.questions[0].cause = 'perhaps';
    assert.throws(() => form.render(broken), /Неизвестная причина вопроса у/);
  });
} finally { close(); }

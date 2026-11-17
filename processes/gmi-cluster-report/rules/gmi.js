'use strict';
// Расчёт GigaCode Maturity Index по методике штаба T и TP: шкалы со слайдов «Методика оценки
// сотрудников по блокам метрик» 1–3 и рычаги из разделов портала (происхождение чисел —
// reference.md). Вычисление чистое: сети нет, значения берутся из артефакта шага чтения,
// пропуски остаются пропусками. Итог файла показывается в таблице, пересчёт процесса — это
// сверка: расхождение по блоку не прячется, а попадает в отдельный раздел отчёта.

const MAX = { training: 3, skills: 3, productivity: 4 };
const COURSE_GRADE = [0, 0, 0.3, 0.5, 0.8, 1];            // курсов завершено в срок
const SKILL_GRADE = [0, 0.1, 0.2, 0.4, 0.6, 0.8, 1];      // навыков достигли планового уровня
const FREQUENCY = [['не используют', 0], ['ежемесячно', 0.2], ['еженедельно', 0.5], ['ежедневно', 1]];
const MODE = [['не используют', 0], ['ассистент', 0.5], ['агент', 1]];
const COHORT = [['минимальное', 0], ['низкое', 0.3], ['базовый', 0.5], ['продвинутый', 0.8], ['power users', 1]];
const PLAN = [['нет', 0], ['да', 1]];
// Следующий шаг шкалы частоты называют действием, а не градацией: человек должен понять,
// что он меняет в своей неделе, а не какое слово напишет в отчёте.
const HABIT = {
  'ежемесячно': 'работать в GigaCode хотя бы раз в месяц',
  'еженедельно': 'работать в GigaCode каждую рабочую неделю',
  'ежедневно': 'работать в GigaCode каждый рабочий день'
};
const BAND = { bot: 0, mid: 0.3, top: 0.5 };
const BAND_ORDER = ['bot', 'mid', 'top'];
const STORY_BELOW = 70;    // процентов цели кластера: ниже — балл не засчитывается (сноска слайда 6)
// Полные названия курсов по слайду 4: человек должен видеть в рекомендации то название,
// под которым курс лежит в портале, а не короткое имя колонки файла.
const COURSE_TITLES = {
  'Контекст AI-агентов': 'Управление контекстом AI-агентов (Context management)',
  'SDD': 'Обучение SDD (Spec-Driven Development)',
  'AI-driven PDLC': 'Обучение GigaCode AI-driven PDLC',
  'Agentic Coding': 'Обучение GigaCode Agentic Coding. Базовый курс',
  'Введение в GigaCode': 'Обучение GigaCode Введение в GigaCode'
};
const titleOf = name => COURSE_TITLES[name] || String(name);
// Ссылка на шкалу печатается рядом с шагом: без неё прирост «+0,3» неоткуда проверить.
const SCALES = {
  курсы: 'шкала курса: 0 или 1 курс в срок — 0, 2 — 0,3, 3 — 0,5, 4 — 0,8, 5 — 1',
  частота: 'шкала частоты: не используют — 0, ежемесячно — 0,2, еженедельно — 0,5, ежедневно — 1',
  режим: 'шкала режима: ассистент — 0,5, агент — 1',
  навыки: 'шкала навыков: 0 — 0, 1 — 0,1, 2 — 0,2, 3 — 0,4, 4 — 0,6, 5 — 0,8, 6 — 1',
  когорта: 'шкала когорты: минимальное использование — 0, низкое — 0,3, базовый уровень — 0,5, продвинутый уровень — 0,8, power users — 1',
  метрики: 'шкала метрики: bottom — 0, соответствуют ожиданиям — 0,3, top — 0,5; отношение к медиане целевой аудитории: ниже 25 %, 25–75 %, 75 % и выше',
  story: `шкала Story: команда ниже ${STORY_BELOW}% цели кластера — 0, на уровне цели или выше — 1`
};
const BAND_LABEL = { bot: 'bottom', mid: 'соответствуют ожиданиям', top: 'top' };
const percent = (part, whole) => (num(part) === null || num(whole) === null || whole === 0 ? null : Math.round((part / whole) * 100));
const plural = (count, one, few, many) => { const tail = count % 100, last = count % 10; if (tail >= 11 && tail <= 14) return many; if (last === 1) return one; if (last >= 2 && last <= 4) return few; return many; };
const courseWord = count => `${count} ${plural(count, 'курс', 'курса', 'курсов')}`;
const skillWord = count => `${count} ${plural(count, 'навык', 'навыка', 'навыков')}`;
const listOf = names => names.map(name => `«${name}»`).join(', ');

const norm = value => String(value === undefined || value === null ? '' : value).toLowerCase().replace(/ё/g, 'е').trim();
const round = value => Math.round(value * 1000) / 1000;
const num = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const fmt = (value, digits = 2) => (value === null || value === undefined ? '—' : String(Number(Number(value).toFixed(digits))).replace('.', ','));
// Пороги печатаются с одним знаком после запятой: «Ниже 6,0» читается как порог, «6» — как число людей.
const one = value => Number(value).toFixed(1).replace('.', ',');
// Числа со стабильным числом знаков: «1» и «1,0» в столбце сверки читаются как разная точность.
const fixed = (value, digits = 1) => (value === null || value === undefined ? '—' : Number(value).toFixed(digits).replace('.', ','));
// Незнакомая формулировка градации — undefined: часть блока остаётся неподтверждённой,
// а не обнуляется молча (ноль в методике имеет собственное значение).
const pick = (value, table) => { const key = norm(value); return key ? (table.find(([label]) => key.includes(label)) || [null, undefined])[1] : undefined; };
const bandBall = value => (Object.prototype.hasOwnProperty.call(BAND, norm(value)) ? BAND[norm(value)] : undefined);
const onTime = status => norm(status).replace(/\s+/g, ' ') === 'завершен в срок';
// Дельта до следующей ступени той же шкалы: обещать сразу максимум в рекомендациях нельзя.
function nextStep(table, value) {
  const sorted = [...table].sort((a, b) => a[1] - b[1]);
  const at = sorted.findIndex(entry => entry[1] === value);
  if (at < 0 || at === sorted.length - 1) return null;
  return { label: sorted[at + 1][0], gain: round(sorted[at + 1][1] - value) };
}

function blockOf(name, parts, fileBall, limits) {
  const total = round(parts.reduce((sum, part) => sum + (part.value === undefined ? 0 : part.value), 0));
  const file = num(fileBall);
  return {
    name,
    total, file,
    limit: limits.max, goal: limits.goal,
    shortfall: round(Math.max(0, limits.goal - total)),
    potential: round(Math.max(0, limits.max - total)),
    unknown: parts.filter(part => part.value === undefined).map(part => part.label),
    mismatch: file !== null && Math.abs(file - total) > 0.005 ? round(total - file) : null,
    parts: parts.map(part => ({ label: part.label, value: part.value === undefined ? null : round(part.value), file: num(part.file) }))
  };
}

function trainingBlock(person, limits) {
  const courses = person.training.courses || [];
  // Курс вне целевой аудитории человека засчитывается максимальным баллом (сноска слайда 4):
  // для SDD и «Управление контекстом» признак целевой аудитории приходит отдельными столбцами.
  const outside = name => (name === 'SDD' && norm(person.training.audience.sdd) === '0')
    || (name === 'Контекст AI-агентов' && norm(person.training.audience.context) === '0');
  const done = courses.filter(course => onTime(course.status) || outside(course.name));
  const unknown = courses.filter(course => !outside(course.name) && (!norm(course.status) || norm(course.status) === '-'));
  const missingList = courses.filter(course => !unknown.includes(course) && !onTime(course.status) && !outside(course.name));
  const missing = missingList.map(course => course.name);
  const grade = courses.length && !unknown.length ? COURSE_GRADE[Math.min(courses.length, done.length)] : undefined;
  return {
    ...blockOf('Обучение и применение', [
      { label: unknown.length ? `курсы: не заполнен статус ${listOf(unknown.map(course => titleOf(course.name)))}` : `курсов завершено в срок: ${done.length} из ${courses.length}`, value: grade, file: person.training.balls.courses },
      { label: `частота использования: ${person.usage.frequency || 'не заполнена'}`, value: pick(person.usage.frequency, FREQUENCY), file: person.usage.frequency === null ? undefined : person.training.balls.frequency },
      { label: `режим работы: ${person.usage.mode || 'не заполнен'}`, value: pick(person.usage.mode, MODE), file: person.usage.mode === null ? undefined : person.training.balls.mode }
    ], person.training.balls.total, { max: MAX.training, goal: limits.training }),
    missingCourses: missing,
    // Для рекомендации нужно и то, как курс помечен сейчас: «не завершён» и «завершён не в срок»
    // требуют разных действий, а колонка балла этого не различает.
    missingDetail: missingList.map(course => ({ name: titleOf(course.name), short: course.name, status: course.status })),
    doneDetail: done.filter(course => !onTime(course.status)).map(course => ({ name: titleOf(course.name), reason: 'вне целевой аудитории — балл засчитан максимальным' })),
    doneCourses: done.length, courseCount: courses.length, coursesKnown: grade !== undefined
  };
}

function skillsBlock(person, limits) {
  const list = person.skills.list || [], done = list.filter(item => item.done === 1).length;
  const unknown = list.filter(item => item.done !== 0 && item.done !== 1);
  const todo = list.filter(item => item.done === 0).map(item => item.name);
  const doneNames = list.filter(item => item.done === 1).map(item => item.name);
  const grade = list.length && !unknown.length ? SKILL_GRADE[Math.min(SKILL_GRADE.length - 1, done)] : undefined;
  return {
    ...blockOf('Навыки', [
      { label: `планка по навыкам: ${person.skills.planReached || 'не заполнена'}`, value: pick(person.skills.planReached, PLAN), file: person.skills.balls.plan },
      { label: unknown.length ? `навыки: не заполнен DONE ${listOf(unknown.map(item => item.name))}` : `навыков достигли планового уровня: ${done} из ${list.length}`, value: grade, file: person.skills.balls.count },
      { label: `когорта потребления токенов: ${person.skills.cohort || 'в файле не заполнена'}`, value: person.skills.cohort === null ? undefined : pick(person.skills.cohort, COHORT), file: person.skills.balls.cohort }
    ], person.skills.balls.total, { max: MAX.skills, goal: limits.skills }),
    todoSkills: todo, doneSkills: done, doneNames, skillCount: list.length, skillsKnown: grade !== undefined, tokens: num(person.skills.tokens),
    planReached: person.skills.planReached, cohort: person.skills.cohort
  };
}

function productivityBlock(person, limits) {
  const metrics = (person.productivity.metrics || []).map(metric => ({
    name: metric.name, value: num(metric.value), band: metric.band === null ? null : norm(metric.band),
    ball: num(metric.ball), fileBall: num(metric.ball), toMedian: num(metric.toMedian), median: num(metric.median)
  }));
  const parts = metrics.map(metric => ({ label: `метрика «${metric.name}»: ${metric.band || 'градация не заполнена'}`, value: bandBall(metric.band), file: metric.fileBall }));
  const story = person.productivity.story || {};
  const comparison = story.comparison === null ? null : norm(story.comparison);
  // Слайд 6: балл засчитывается, когда команда выше цели кластера (или цели кластера нет);
  // таблица того же слайда перечисляет две градации наоборот — берётся сноска и балл файла.
  const storyRule = comparison === null ? undefined : /ниже/.test(comparison) ? 0 : 1;
  const storyFile = num(story.ball);
  parts.push({ label: `Story на сотрудника: ${story.comparison || 'сравнение не заполнено'}`, value: storyRule, file: storyFile });
  const belowCluster = story.team !== null && story.cluster !== null && story.cluster > 0 && (story.team / story.cluster) * 100 < STORY_BELOW;
  return {
    ...blockOf('Продуктивность', parts, person.productivity.totalBall, { max: MAX.productivity, goal: limits.productivity }),
    metrics, storyComparison: story.comparison, storyFile, storyRule, belowCluster,
    storyTeam: num(story.team), storyCluster: num(story.cluster)
  };
}

// У рычага три формулировки: короткая — в колонку сводной таблицы, полная — то, что можно
// отправить человеку (без баллов и ссылок на шкалы), и шаги — чем измеряется ступень и сколько
// она даёт баллов: шаги печатаются отдельно, под списком рекомендаций.
function leversFor(person, blocks) {
  const levers = [];
  const push = (kind, brief, text, gain, steps, items) => {
    if (gain > 0) levers.push({ kind, brief, text, gain: round(gain), steps: steps || [], items: items || [] });
  };
  const training = blocks.training;
  if (training.coursesKnown && training.missingDetail.length) {
    const top = COURSE_GRADE[Math.min(COURSE_GRADE.length - 1, training.courseCount)];
    const here = COURSE_GRADE[Math.min(COURSE_GRADE.length - 1, training.doneCourses)];
    const names = training.missingDetail.map(course => `«${course.name}»${course.status ? ` — в файле «${course.status}»` : ''}`).join('; ');
    push('курсы', `доучить в срок ${courseWord(training.missingDetail.length)}`,
      `завершить в срок ${courseWord(training.missingDetail.length)}: ${names}`,
      top - here,
      [SCALES.курсы, `сейчас в срок завершено ${courseWord(training.doneCourses)} из ${training.courseCount} — это ${fixed(here)} балла, все ${training.courseCount} дадут ${fixed(top)} балла (+${fixed(top - here)})`],
      training.missingDetail.map(course => course.name));
  }
  const frequency = pick(person.usage.frequency, FREQUENCY);
  if (frequency !== undefined) {
    const next = nextStep(FREQUENCY, frequency);
    if (next) push('частота', `перейти на «${next.label}»`,
      `перейти с «${norm(person.usage.frequency)}» на «${next.label}»: ${HABIT[next.label] || `пользоваться GigaCode ${next.label}`}, а не от случая к случаю`,
      next.gain,
      [SCALES.частота, `сейчас «${norm(person.usage.frequency)}» = ${fixed(frequency)} балла, следующий шаг «${next.label}» = ${fixed(round(frequency + next.gain))} балла (+${fixed(next.gain)})`],
      [`использует «${norm(person.usage.frequency)}»`]);
  } else if (person.usage.frequency === null) training.unknown.push('частота использования не заполнена в файле');
  const mode = pick(person.usage.mode, MODE);
  if (mode !== undefined) {
    const next = nextStep(MODE, mode);
    // Режим выбирают при постановке задачи в самом GigaCode — в формулировке должно быть видно,
    // что именно человек меняет в способе работы, а не только слово из градации.
    const agent = next && next.label === 'агент';
    if (next) push('режим', agent ? 'перейти в режим агентской работы в GigaCode' : `перейти в режим «${next.label}»`,
      agent
        ? `перейти из режима «${norm(person.usage.mode)}» в режим агентской работы в GigaCode: режим выбирают при постановке задачи — ассистент это подсказки и автодополнение, агент берёт задачу целиком с контекстом и проверкой результата`
        : `перейти из режима «${norm(person.usage.mode)}» в «${next.label}»`,
      next.gain,
      [SCALES.режим, `сейчас «${norm(person.usage.mode)}» = ${fixed(mode)} балла, «${next.label}» = ${fixed(round(mode + next.gain))} балла (+${fixed(next.gain)})`],
      [`режим «${norm(person.usage.mode)}»`]);
  }
  const skills = blocks.skills;
  const grade = skills.skillsKnown ? SKILL_GRADE[Math.min(SKILL_GRADE.length - 1, skills.doneSkills)] : undefined;
  if (grade !== undefined && grade < 1 && skills.todoSkills.length) {
    const target = Math.min(SKILL_GRADE.length - 1, skills.doneSkills + Math.min(2, skills.todoSkills.length));
    push('навыки', `дотянуть ${skillWord(skills.todoSkills.length)} до планки`,
      `довести до планового уровня ${skillWord(skills.todoSkills.length)}: ${listOf(skills.todoSkills)}`,
      SKILL_GRADE[target] - grade,
      [SCALES.навыки,
        skills.doneNames.length ? `уже закрыто ${skillWord(skills.doneSkills)}: ${listOf(skills.doneNames)}` : `закрыт ${skillWord(0)}`,
        `планка по навыкам в файле: «${skills.planReached || 'не заполнена'}» — она закрывается, когда все ${skills.skillCount} навыков достигли планового уровня`,
        `ближайшая ступень: ${skillWord(target)} = ${fixed(SKILL_GRADE[target])} балла вместо ${fixed(grade)} (+${fixed(SKILL_GRADE[target] - grade)}), полный список из ${skills.skillCount} — ${fixed(1)} балла`],
      skills.todoSkills);
  }
  const cohort = pick(person.skills.cohort, COHORT);
  if (cohort !== undefined) {
    const next = nextStep(COHORT, cohort);
    if (next) push('когорта', `наработать когорту «${next.label}»`,
      `наработать практику в CLI до когорты «${next.label}» вместо «${norm(person.skills.cohort)}»`,
      next.gain,
      [SCALES.когорта, `сейчас когорта «${norm(person.skills.cohort)}» = ${fixed(cohort)} балла, «${next.label}» = ${fixed(round(cohort + next.gain))} балла (+${fixed(next.gain)})`,
        skills.tokens === null ? 'столбец «Количество токенов CLI» в строке пуст — прирост по когорте нечем подтвердить' : `объём токенов в строке: ${fmt(skills.tokens, 0)}`],
      [`когорта «${norm(person.skills.cohort)}»`]);
  }
  const weak = blocks.productivity.metrics
    .filter(metric => metric.band !== null && bandBall(metric.band) !== undefined && bandBall(metric.band) < BAND.top)
    .sort((a, b) => (a.toMedian === null ? 1e9 : a.toMedian) - (b.toMedian === null ? 1e9 : b.toMedian) || BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band))
    .slice(0, 3);
  for (const metric of weak) {
    const step = BAND_ORDER[BAND_ORDER.indexOf(metric.band) + 1];
    const here = `сейчас ${metric.value === null ? 'значение не заполнено' : fmt(metric.value, 0)}${metric.median === null ? '' : ` против медианы целевой аудитории ${fmt(metric.median, 0)}`}${metric.toMedian === null ? '' : ` — ${fmt(metric.toMedian, 0)}% медианы`}`;
    const thresholds = metric.median === null
      ? 'медиана целевой аудитории в строке пуста, поэтому нужное значение в штуках не называется: пороги — 25 % и 75 % медианы'
      : `порог «${BAND_LABEL.mid}» — от 25 % медианы, то есть от ${fmt(Math.ceil(metric.median * 0.25), 0)}; порог «${BAND_LABEL.top}» — от 75 % медианы, то есть от ${fmt(Math.ceil(metric.median * 0.75), 0)}`;
    const needed = metric.median === null ? null : Math.ceil(metric.median * (step === 'top' ? 0.75 : 0.25));
    push('метрики', `«${metric.name}» до «${BAND_LABEL[step]}»`,
      `подтянуть метрику «${metric.name}»: ${here}, сейчас градация «${BAND_LABEL[metric.band]}»; ${needed === null ? `нужно попасть в «${BAND_LABEL[step]}» — от 25 % до 75 % медианы целевой аудитории` : `нужно не меньше ${fmt(needed, 0)} — это градация «${BAND_LABEL[step]}»`}`,
      BAND[step] - BAND[metric.band],
      [SCALES.метрики, thresholds],
      [`«${metric.name}»`]);
  }
  // Расхождение балла Story с градацией файла в рекомендации не повторяют: оно видно
  // в разделе расхождений, где у сверки есть число.
  const productivity = blocks.productivity;
  if (productivity.storyRule === 0) {
    const share = percent(productivity.storyTeam, productivity.storyCluster);
    const needed = productivity.storyCluster === null ? null : Math.ceil((productivity.storyCluster * STORY_BELOW) / 100);
    push('story', 'Story команды до цели кластера',
      `это рекомендация уровня команды, индивидуально не выполняется: вывести «Story на 1 сотрудника» на цель кластера: ${productivity.storyTeam === null ? 'значение команды не заполнено' : `команда ${fmt(productivity.storyTeam, 0)}`} против цели ${productivity.storyCluster === null ? 'не заполнена' : fmt(productivity.storyCluster, 0)}${share === null ? '' : ` — это ${share}% цели кластера, зачёт идёт от ${STORY_BELOW}%`}`,
      1,
      [SCALES.story, needed === null ? 'цель кластера в строке пуста — нужное число Story не называется' : `нужно не меньше ${fmt(needed, 0)} Story на сотрудника: это ${STORY_BELOW}% цели кластера ${fmt(productivity.storyCluster, 0)}`],
      ['Story команды ниже цели кластера']);
  }
  const ordered = levers.sort((a, b) => b.gain - a.gain);
  const potential = round(ordered.reduce((sum, lever) => sum + lever.gain, 0));
  return { ordered, potential };
}

function assess(person, limits, goal, warn) {
  const blocks = { training: trainingBlock(person, limits), skills: skillsBlock(person, limits), productivity: productivityBlock(person, limits) };
  const recomputed = round(blocks.training.total + blocks.skills.total + blocks.productivity.total);
  const fileTotal = num(person.total);
  const status = fileTotal === null ? 'итог в файле не заполнен' : fileTotal < goal ? 'ниже цели' : 'цель достигнута';
  // Оценка A–E — та же шкала крупными мазками: A заметно выше цели, B на цели, C чуть ниже,
  // D заметно ниже, E под предупреждающим порогом. Границы выведены из цели и порога владельца,
  // а не из перцентилей файла.
  const grade = fileTotal === null ? null
    : fileTotal >= round(goal * 1.25) ? 'A'
      : fileTotal >= goal ? 'B'
        : fileTotal >= round(goal * 0.75) ? 'C'
          : fileTotal >= warn ? 'D' : 'E';
  const levers = status === 'ниже цели' ? leversFor(person, blocks) : { ordered: [], potential: 0 };
  const strong = Object.values(blocks).filter(block => block.goal > 0).sort((a, b) => (b.total - b.goal) - (a.total - a.goal))[0];
  const after = fileTotal === null ? null : round(fileTotal + levers.potential);
  const left = after === null ? null : round(Math.max(0, goal - after));
  // В графу таблицы попадает только то, что можно отправить человеку: короткие действия,
  // без баллов и шкал. Степень улучшения считается отдельно и печатается под рекомендациями.
  const recommendation = status === 'ниже цели'
    ? (levers.ordered.length
      ? levers.ordered.map(lever => lever.brief).join('; ')
      : `Рычагов по шкалам не видно: блоки уже на своих градациях, а цель ${one(goal)} берётся длиной практики — проверить период выгрузки`)
    : status === 'цель достигнута' ? `Цель достигнута; сильнее всего «${strong ? strong.name : 'блоки'}» — держать текущий режим` : 'Заполнить «Общий итог» в выгрузке или проверить строку вручную';
  const flags = (person.percentiles.blocks || []).filter(item => item.recommendation === 1).map(item => item.block);
  return {
    id: person.id, name: person.name, who: person.name || person.id,
    // Человеку в таблице понятно название команды, а не её код: код остаётся запасным вариантом
    // для старых снимков выгрузки, где колонки «Команда» ещё не было.
    team: person.teamTitle || person.team, role: person.role || person.expertise,
    training: blocks.training.total, skills: blocks.skills.total, productivity: blocks.productivity.total,
    total: fileTotal, recomputed, status, grade, recommendation,
    potential: levers.potential, reachesGoal: left === 0, leftToGoal: left,
    gaps: [...blocks.training.unknown, ...blocks.skills.unknown, ...blocks.productivity.unknown],
    fileBlocks: { training: blocks.training.file, skills: blocks.skills.file, productivity: blocks.productivity.file, total: fileTotal },
    fileRecommendationFlags: flags,
    levers: levers.ordered
  };
}

function aggregate(rows) {
  const kinds = {};
  const LABELS = {
    курсы: 'не завершены курсы в срок', частота: 'используют GigaCode реже ежедневного', режим: 'работают в режиме ассистента',
    навыки: 'не все навыки дотянуты до планового уровня', когорта: 'мало практики в CLI (когорта ниже)',
    метрики: 'метрики продуктивности ниже медианы целевой аудитории', story: 'Story ниже цели кластера'
  };
  for (const row of rows) {
    const seen = new Set();
    for (const lever of row.levers) {
      const entry = kinds[lever.kind] || (kinds[lever.kind] = { lever: LABELS[lever.kind] || lever.kind, people: 0, potential: 0, counts: {} });
      // Человек в строке учитывается один раз, а прирост складывается из всех его рычагов
      // этого вида: у метрик их до трёх, и считать только первый значило бы занижать потенциал.
      if (!seen.has(lever.kind)) { seen.add(lever.kind); entry.people += 1; }
      entry.potential = round(entry.potential + lever.gain);
      for (const item of lever.items || []) entry.counts[item] = (entry.counts[item] || 0) + 1;
    }
  }
  return Object.values(kinds).map(entry => ({
    lever: entry.lever,
    people: entry.people,
    potential: entry.potential,
    details: Object.entries(entry.counts)
      .map(([item, people]) => ({ item, people }))
      .sort((a, b) => b.people - a.people || a.item.localeCompare(b.item, 'ru'))
  })).sort((a, b) => b.people - a.people || b.potential - a.potential);
}

function evaluate(inputs, parameters) {
  const scores = inputs.scores;
  if (!scores || typeof scores !== 'object' || !Array.isArray(scores.employees)) throw new Error('Нет артефакта таблицы оценок: шаг чтения файла не выполнен');
  const params = typeof parameters === 'string' ? JSON.parse(parameters) : parameters || {};
  // Параметры процесса приходят текстом из шапки PROCESS.md: «6,0» и «true» нужно приводить,
  // иначе строка «false» оказалась бы включённым признаком.
  const amount = value => { const raw = String(value === undefined || value === null ? '' : value).trim().replace(',', '.'); const parsed = Number(raw); return raw && Number.isFinite(parsed) ? parsed : null; };
  const flag = value => value === true || ['true', '1', 'да', 'yes'].includes(String(value).toLowerCase().trim());
  const goal = amount(params.goal);
  if (goal === null || goal <= 0) throw new Error('Нужен параметр goal — целевое значение общего итога в баллах');
  const warn = amount(params.warnBelow) === null ? 3 : amount(params.warnBelow);
  const demo = flag(params.demo);
  const runDate = String((params && params.runDate) || '').trim();
  if (!runDate) throw new Error('Нет даты прогона: отчёт без даты нельзя сравнить со следующим');
  const limits = { training: round(goal * 0.3), skills: round(goal * 0.3), productivity: round(goal * 0.4) };
  const assessed = scores.employees.map(person => assess(person, limits, goal, warn));
  const people = [...assessed].sort((a, b) => (a.total === null ? Infinity : a.total) - (b.total === null ? Infinity : b.total) || String(a.who).localeCompare(String(b.who), 'ru'));
  people.forEach((row, index) => { row.ordinal = index + 1; });

  // Карта «ФИО → адрес» нужна только ссылке «Письмо сотруднику» в странице: письмо уходит на
  // адресата, поэтому адрес берётся только по точному совпадению ФИО (разница в пробелах не в
  // счёт), а одинаковое ФИО остаётся без адреса — иначе письмо ушло бы не тому человеку. Право на
  // ссылку даёт сам факт адреса в карте: её собирают из почтового справочника организации, где
  // адрес и есть принадлежность человека. Сверку номера учётной записи с задачами владелец процесса
  // снял 2026-11-11 — номеров в карте больше нет и требовать их нельзя.
  const addressBook = inputs.people && typeof inputs.people === 'object' && !Array.isArray(inputs.people) ? inputs.people : {};
  const tidy = value => String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
  const isMail = value => value.isWellFormed() && /^[^@\s<>"\u0000-\u001f\u007f]+@[^@\s<>"\u0000-\u001f\u007f]+\.[^@\s<>"\u0000-\u001f\u007f]+$/.test(value);
  const NO_BOOK = 'нет в карте адресов';
  const NO_MAIL = 'в карте адресов нет адреса';
  const TWIN_NAMES = 'ФИО встречается в списке дважды';
  const addresses = {};
  for (const [name, entry] of Object.entries(addressBook)) {
    const key = tidy(name);
    if (!key) continue;
    // Плоская карта «ФИО → адрес» и запись с пояснениями ({ email, … }) — адрес берётся из обоих.
    // Запись без адреса может нести `"причина"`: почему адреса нет (несколько однофамильцев,
    // отключённые учётки) — человек читает под своим блоком именно её, а не общее «нет в карте».
    const detail = entry && typeof entry === 'object' ? entry : null;
    const mail = tidy(detail ? detail.email : entry);
    if (isMail(mail)) addresses[key] = { email: mail, reason: null };
    else addresses[key] = { email: null, reason: (detail && tidy(detail['причина'])) || NO_MAIL };
  }
  const twins = new Set();
  const listed = new Set();
  for (const row of people) {
    const key = tidy(row.who);
    if (listed.has(key)) twins.add(key);
    listed.add(key);
  }
  people.forEach(row => {
    const key = tidy(row.who);
    const hit = twins.has(key) ? { email: null, reason: TWIN_NAMES } : (addresses[key] || { email: null, reason: NO_BOOK });
    row.email = hit.email;
    // Причина пишется у блока человека на странице: «письма нет» без объяснения человек
    // прочитал бы как ошибку отчёта.
    row.letterReason = hit.reason;
  });

  const counted = people.filter(row => row.total !== null);
  const belowGoal = counted.filter(row => row.total < goal);
  const average = key => (counted.length ? round(counted.reduce((sum, row) => sum + row[key], 0) / counted.length) : null);
  const rows = counted.length;
  // Средние печатаются с двумя знаками, сумма — с одним: «2» вместо «2,00» в таблице кластера
  // читается как ровно два балла, а не как среднее.
  const sum = round(counted.reduce((total, row) => total + row.total, 0));
  const cluster = [
    { label: 'Кол-во сотрудников', value: String(people.length) },
    { label: 'Средний GMI', value: fixed(average('total'), 2) },
    { label: 'Общий балл', value: fixed(sum, 1) },
    { label: 'Обучение и применение', value: fixed(average('training'), 2) },
    { label: 'Навыки', value: fixed(average('skills'), 2) },
    { label: 'Продуктивность', value: fixed(average('productivity'), 2) },
    { label: `Ниже ${one(warn)}`, value: String(counted.filter(row => row.total < warn).length) },
    { label: `Ниже ${one(goal)}`, value: String(counted.filter(row => row.total < goal).length) }
  ];

  const mismatches = [];
  const signed = value => `${value > 0 ? '+' : ''}${fixed(value, 1)}`;
  let compared = 0;
  for (const [index, person] of scores.employees.entries()) {
    const row = assessed[index];
    for (const block of [trainingBlock(person, limits), skillsBlock(person, limits), productivityBlock(person, limits)]) {
      if (block.file !== null) compared += 1;
      if (block.mismatch !== null) mismatches.push({ id: row.who, block: block.name, file: fixed(block.file), recomputed: fixed(block.total), delta: signed(block.mismatch) });
    }
    if (row.total !== null) compared += 1;
    if (row.total !== null && Math.abs(row.total - row.recomputed) > 0.005) {
      mismatches.push({ id: row.who, block: 'Общий итог', file: fixed(row.total), recomputed: fixed(row.recomputed), delta: signed(row.recomputed - row.total) });
    }
  }

  const noTotal = people.filter(row => row.total === null).map(row => row.who);
  const noName = people.filter(row => !row.name).length;
  // Откуда ФИО — отдельный факт прогона: колонка выгрузки, справочник владельца или ничего.
  // Без этой строки отчёт с именами неотличим от отчёта, где имена придуманы.
  const names = scores.names || {};
  const namesNote = names.source === 'колонка таблицы'
    ? `ФИО взяты из колонки выгрузки «${names.column}»: ${names.matched} из ${people.length}, остались с табельным номером ${names.unmatched}.`
    : names.source === 'справочник'
      ? `ФИО взяты из справочника ${names.file}: совпало ${names.matched}, остались с табельным номером ${names.unmatched}.`
      : `ФИО не взяты: в файле нет колонки «ФИО сотрудника», справочник не передан — в отчёте ${noName} табельных номеров.`;
  const notes = [
    `Данные: ${scores.source.file}${scores.source.sheet ? `, лист ${scores.source.sheet}` : ''} — ${scores.source.dataRowCount} строк, из них сотрудников ${people.length}${scores.skipped.length ? `, пропущено строк ${scores.skipped.length}` : ''}.`,
    `Периметр: все строки файла без отбора; знаменатель средних — ${rows} строк с заполненным «Общий итог».`,
    `Цель ${one(goal)} балла разложена по весам блоков: обучение ${fmt(limits.training, 1)}, навыки ${fmt(limits.skills, 1)}, продуктивность ${fmt(limits.productivity, 1)}.`,
    `Оценка в статусе ставится по тому же итогу: A — от ${fmt(round(goal * 1.25), 1)} балла, B — от ${one(goal)} (цель), C — от ${fmt(round(goal * 0.75), 1)}, D — от ${one(warn)} (предупреждающий порог), E — ниже ${one(warn)}. Строки без итога оценки не получают.`,
    namesNote,
    'Балл «Рост Story на 1 сотрудника» читается по сноске слайда 6 и по столбцу балла файла: команда выше цели кластера — 1; таблица того же слайда перечисляет градации наоборот, расхождение передано владельцу методики.',
    'Трайбовый бонус («Оценка в БП») в оценку человека не входит: он про трайб, а не про сотрудника.',
    `Целевое значение задано владельцем процесса (${one(goal)} из ${MAX.training + MAX.skills + MAX.productivity}) и не берётся из перцентилей файла.`,
    `Пересчёт правила сверен с баллами того же файла: совпало ${compared - mismatches.length} из ${compared} сравнимых блоков и итогов.`
  ];
  if (demo) notes.unshift('ДАННЫЕ ДЕМО: сотрудники вымышлены, внешних систем этот прогон не касался.');
  const cohortGap = (scores.gaps || []).find(gap => /когорта/i.test(gap.field));
  if (cohortGap && cohortGap.count >= people.length) notes.push(`Когорта потребления токенов пуста во всех строках: балл когорты(${cohortGap.count} строк) неподтверждён, потенциал блока «Навыки» занижен.`);
  if ((scores.source.unknownColumns || []).length) notes.push(`Столбцов, которые процесс не использует, ${scores.source.unknownColumns.length}: ${scores.source.unknownColumns.join(', ')}.`);
  if (noTotal.length) notes.push(`Строк без «Общий итог»: ${noTotal.length} — в средний GMI и в отбор ниже цели они не входят.`);
  if (scores.skipped.length) notes.push(`Строк без номера сотрудника (в расчёт не попали): ${scores.skipped.map(row => row.row).join(', ')}.`);
  // Покрытие адресами — часть честного итога: без этой строки отчёт с письмами неотличим
  // от прогона, где карту адресов вообще не передали.
  const needMail = belowGoal.filter(row => !row.email);
  if (Object.keys(addresses).length && needMail.length) {
    // Причины считаются группами: «нет письма у 22 человек» без разбора неотличимо от того, что
    // карту адресов забыли передать.
    const reasons = {};
    for (const row of needMail) reasons[row.letterReason] = (reasons[row.letterReason] || 0) + 1;
    notes.push(`Письмо сотруднику не создаётся для ${needMail.length} человек(а) ниже цели из ${belowGoal.length}: ${Object.entries(reasons).map(([reason, count]) => `${count} — ${reason}`).join('; ')}.`);
  }
  if (twins.size) notes.push(`Одинаковых ФИО в списке: ${[...twins].slice(0, 5).join(', ')}${twins.size > 5 ? ` и ещё ${twins.size - 5}` : ''} — письмо не создаётся, чтобы оно не ушло не тому человеку.`);
  const extraAddresses = Object.keys(addresses).filter(key => !listed.has(key));
  if (extraAddresses.length) notes.push(`В карте адресов есть ${extraAddresses.length} ФИО вне списка отчёта: ${extraAddresses.slice(0, 5).join(', ')}${extraAddresses.length > 5 ? ` и ещё ${extraAddresses.length - 5}` : ''} — сверить напечатание ФИО.`);

  const questions = [];
  if (noTotal.length) questions.push({ scope: 'Общий итог', text: `${noTotal.length} строк без итога (${noTotal.slice(0, 8).join(', ')}${noTotal.length > 8 ? ' и ещё ' + (noTotal.length - 8) : ''}) — взять их из другого периода или исключить из периметра?`, why: 'без итога строка не участвует в средних и в отборе' });
  // Вопрос про имена ставится только когда ни один источник не дал ни одного имени: частичное
  // покрытие колонкой или справочником видно в оговорках, а вопрос на каждом прогоне мешал бы.
  if (noName && !names.source) questions.push({ scope: 'ФИО', text: `Людей без ФИО ${noName}, имён нет ни в файле, ни в справочнике. Нужны ли имена в отчёте? Если да — возьмите выгрузку с заполненной колонкой «ФИО сотрудника» или положите справочник «табельный номер → ФИО» и перезапустите с параметром nameFile.`, why: 'ни колонок с ФИО, ни справочника, который дал бы имя' });
  if (mismatches.length > Math.max(1, Math.floor(people.length * 0.2))) questions.push({ scope: 'Шкалы', text: `Расхождений пересчёта с баллами файла больше пятой части строк (${mismatches.length}) — сверить шкалы процесса с актуальной версией методики.`, why: 'пересчёт правила и балл файла должны сходиться' });
  const empty = people.length === 0;
  if (empty) questions.push({ scope: 'Периметр', text: 'В файле нет ни одной строки с номером сотрудника — тот ли файл передан?', why: 'считать нечего' });

  return {
    meta: {
      reportTitle: 'GigaCode Maturity Index: цифры кластера и план подъёма',
      generatedAt: runDate, demo,
      goal: { total: goal, warn, training: limits.training, skills: limits.skills, productivity: limits.productivity, max: MAX.training + MAX.skills + MAX.productivity },
      source: scores.source, methodologyVersion: String(params.methodologyVersion || ''),
      perimeter: String(params.perimeter || 'все строки файла'), names: scores.names
    },
    cluster,
    people: people.map(row => ({
      ordinal: row.ordinal, who: row.who, name: row.name, id: row.id, team: row.team, role: row.role,
      email: row.email, letterReason: row.letterReason,
      training: row.training, skills: row.skills, productivity: row.productivity,
      total: row.total, recomputed: row.recomputed, status: row.status, grade: row.grade,
      recommendation: row.recommendation, potential: row.potential, reachesGoal: row.reachesGoal,
      leftToGoal: row.leftToGoal,
      gaps: row.gaps, fileBlocks: row.fileBlocks, fileRecommendationFlags: row.fileRecommendationFlags,
      levers: row.levers
    })),
    levers: aggregate(belowGoal),
    counters: {
      employees: people.length, counted: rows, belowGoal: belowGoal.length, reachedGoal: counted.length - belowGoal.length,
      belowWarn: counted.filter(row => row.total < warn).length, withoutTotal: noTotal.length,
      withoutName: noName, mismatches: mismatches.length, skipped: scores.skipped.length
    },
    mismatches, gaps: scores.gaps || [], notes, questions
  };
}

module.exports = { evaluate, MAX };

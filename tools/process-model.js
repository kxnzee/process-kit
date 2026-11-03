'use strict';
const { parseFrontmatter } = require('./markdown');
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const asList = value => Array.isArray(value) ? value : value ? [value] : [];

// One parser for route validation, selected data files and preflight.
function processModel(text) {
  const fm = parseFrontmatter(text);
  const errors = [];
  if (!fm.data) return { data: {}, steps: [], errors: [fm.error || 'нет шапки процесса'] };
  const rows = fm.body.split(/\r?\n/);
  const start = rows.findIndex(row => /^## Шаги\s*$/.test(row));
  if (start < 0) return { data: fm.data, steps: [], errors: ['нет раздела «## Шаги»'] };
  const steps = [];
  let step;
  let short = false;
  for (let i = start + 1; i < rows.length; i++) {
    let row = rows[i];
    if (/^## /.test(row)) break;
    const head = row.match(/^### ([a-z0-9][a-z0-9-]*)\s*$/);
    const item = row.match(/^\s*\d+\. ([a-z0-9][a-z0-9-]*)(?:\s*[—–]\s*(.*))?\s*$/);
    if (head || item) {
      short ||= !!item;
      step = { name: head ? head[1] : item[1], ref: item ? item[1] : null,
        kind: item ? 'action' : null, params: {}, targets: [], ln: fm.bodyLine + i };
      steps.push(step);
      if (!item) continue;
      row = item[2] || '';
    }
    if (!step) continue;
    const kind = row.match(/^\s*(?:[-*]\s*)?(действие|процесс):\s*([^\s`]+)/);
    if (kind) {
      if (step.kind) errors.push(`шаг ${step.name}: несколько типов шага`);
      step.kind = kind[1] === 'процесс' ? 'process' : 'action'; step.ref = kind[2];
    }
    if (/^\s*(?:-\s*)?branch:/.test(row)) step.kind = 'branch';
    const artifact = row.match(/артефакт:\s*([a-z0-9-]+)/);
    if (artifact) step.artifact = artifact[1];
    const next = row.match(/следующий:\s*([a-z0-9-]+)/);
    if (next) step.next = next[1];
    const goto = row.match(/goto:\s*([a-z0-9-]+)/);
    if (goto) step.targets.push(goto[1]);
    if (/default/.test(row) && goto) step.default = true;
    // Parameter values are literal names or {params.name}; artifact bindings remain paths.
    const paramRe = /(?:`|^|\s)(query|template|rule|taskStore|codeStore):\s*([^`\n]+)/g;
    let p;
    while ((p = paramRe.exec(row))) step.params[p[1]] = p[2].trim();
    for(const match of row.matchAll(/`([A-Za-zА-Яа-яЁё][\wА-Яа-яЁё-]*):\s*([^`]+)`/g))step.params[match[1]]=match[2].trim();
  }
  const names = new Set();
  for (const s of steps) {
    if (names.has(s.name)) errors.push(`повтор имени шага ${s.name}`);
    names.add(s.name);
  }
  steps.forEach((s, index) => {
    if (!s.kind && s.name !== 'end') errors.push(`шаг ${s.name}: нет действия, подпроцесса или branch`);
    if (s.kind && s.kind !== 'branch' && !s.next) s.next = steps[index + 1]?.name || 'end';
    if (s.kind === 'branch' && !s.default) errors.push(`шаг ${s.name}: нет default`);
    if (s.ref && !NAME.test(s.ref)) errors.push(`шаг ${s.name}: недопустимое имя ссылки`);
    for (const target of s.kind === 'branch' ? s.targets : s.next ? [s.next] : []) {
      if (target !== 'end' && !names.has(target)) errors.push(`шаг ${s.name}: переход на отсутствующий шаг ${target}`);
    }
  });
  const entry = fm.data.entry || (short ? steps[0]?.name : null);
  if (!entry || !names.has(entry)) errors.push('entry не указывает на существующий шаг');
  const active = new Set(), visited = new Set();
  function visit(name) {
    if (name === 'end' || !names.has(name)) return;
    if (active.has(name)) { errors.push(`цикл маршрута на шаге ${name}`); return; }
    if (visited.has(name)) return;
    visited.add(name); active.add(name);
    const s = steps.find(s => s.name === name);
    for (const t of s.kind === 'branch' ? s.targets : s.next ? [s.next] : []) visit(t);
    active.delete(name);
  }
  visit(entry);
  for (const s of steps) if (s.name !== 'end' && !visited.has(s.name)) errors.push(`недостижимый шаг ${s.name}`);
  return { data: fm.data, steps, entry, errors };
}
function parameter(model, step, name, overrides = {}) {
  let value = overrides[name] ?? step.params[name] ?? model.data.params?.[name];
  const match = typeof value === 'string' && value.match(/^\{params\.([^}]+)\}$/);
  if (match) value = overrides[match[1]] ?? model.data.params?.[match[1]];
  return value;
}
function owner(name) {
  if (name.startsWith('my-')) return { level: 2, team: null };
  const team = name.match(/^team-([a-z0-9]+)-/);
  return team ? { level: 1, team: team[1] } : { level: 0, team: null };
}
function allowedReference(from, to) {
  const a = owner(from), b = owner(to);
  return b.level <= a.level && !(a.level === 1 && b.level === 1 && a.team !== b.team);
}
module.exports = { processModel, parameter, owner, allowedReference, NAME, asList };

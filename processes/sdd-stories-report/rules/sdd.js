'use strict';
// Pure SDD calculation from recorded evidence. No MCP or file reads.
const {selectionId,queryFixture}=require('../../../tools/lib/actions/query-data');
function unique(rows,label){
 if(!Array.isArray(rows)||rows.some(row=>!row||typeof row.key!=='string'||!row.key)||new Set(rows.map(row=>row.key)).size!==rows.length)throw new Error(label+': нужны уникальные записи с key');
}
function splitFixture(fixture,query=fixture.query){
 const tasks=queryFixture(fixture,query);
 return {tasks,code:evidenceFromFixture(fixture,tasks,fixture.codeEvidence?.queryFile)};
}
const {evidenceFromFixture}=require('../../../tools/lib/actions/code-data');
function assessSdd(tasks,code,parameters={label:tasks?.meta?.label,watchPath:tasks?.meta?.watchPath}){
 if(typeof parameters.label!=='string'||!parameters.label.trim()||typeof parameters.watchPath!=='string'||!parameters.watchPath.trim())throw new Error('Нужны явные label и watchPath');
 if(!tasks||!code||!tasks.meta||!Array.isArray(tasks.excluded)||!Array.isArray(tasks.unverified))throw new Error('Нужны task-records и code-evidence');
 if(tasks.records?.some(row=>['key','summary','url','status','inProgressAt'].some(key=>typeof row[key]!=='string'||!row[key].trim())))throw new Error('Для оценки SDD нужны key, summary, url, status, inProgressAt');
 unique(tasks.records,'task-records');unique(code.records,'code-evidence');
 unique(tasks.excluded,'excluded');unique(tasks.unverified,'unverified');
 const partition=[...tasks.records,...tasks.excluded,...tasks.unverified].map(row=>row.key);
 if(new Set(partition).size!==partition.length)throw new Error('Группы stories/excluded/unverified должны быть непересекающимися');
 if(tasks.records.some(row=>row.labels!==undefined&&(!Array.isArray(row.labels)||row.labels.some(label=>typeof label!=='string'))))throw new Error('Метки должны быть списком строк или отсутствовать');
 if(code.records.some(row=>(row.prsComplete!==undefined&&typeof row.prsComplete!=='boolean')||(row.prs!==undefined&&(!Array.isArray(row.prs)||row.prs.some(pr=>!pr||typeof pr.state!=='string'||(pr.changedPaths!==undefined&&(!Array.isArray(pr.changedPaths)||pr.changedPaths.some(file=>typeof file!=='string'))))))))throw new Error('Неверный формат свидетельств кода');
 if(code.records.some(row=>Object.keys(row).some(key=>!['key','prs','prsComplete','commit','reason'].includes(key))))throw new Error('Свидетельства кода содержат посторонние поля');
 if(tasks.selectionId!==selectionId(tasks)||code.selectionId!==tasks.selectionId)throw new Error('Свидетельства относятся к другому отбору');
 const keys=new Set(tasks.records.map(row=>row.key));
 if(code.records.some(row=>!keys.has(row.key)))throw new Error('В коде есть чужой ключ');
 if(tasks.records.some(row=>['prs','prsComplete','commit','via'].some(key=>Object.hasOwn(row,key))))throw new Error('Источник задач содержит расчёт или свидетельства кода');
 const index=new Map(code.records.map(row=>[row.key,row]));
 const fixture={meta:{...structuredClone(tasks.meta),label:parameters.label,watchPath:parameters.watchPath},excluded:structuredClone(tasks.excluded),unverified:structuredClone(tasks.unverified),stories:tasks.records.map(story=>({...structuredClone(story),...structuredClone(index.get(story.key)||{prsComplete:false})}))};
 return classify(fixture);
}
function normalizeFixture(fixture,query=fixture.query){const input=splitFixture(fixture,query);return assessSdd(input.tasks,input.code);}
function classify(fixture) {
  const meta = { ...(fixture.meta || {}) };
  const label = String(meta.label || 'SDD').toLowerCase();
  const prefix = String(meta.watchPath || 'openspec/changes').replace(/\/$/, '') + '/';
  const sddStories = [], plainStories = [], unverified = [...fixture.unverified];
  let labelCount = 0, commitCount = 0;
  for (const story of fixture.stories) {
    const labelsKnown = Array.isArray(story.labels);
    const tagged = labelsKnown && story.labels.some(item => String(item).toLowerCase() === label);
    const merged = (Array.isArray(story.prs) ? story.prs : []).filter(pr => pr.state === 'MERGED');
    const hasPr = merged.some(pr => Array.isArray(pr.changedPaths) && pr.changedPaths.some(file => String(file).startsWith(prefix)));
    const complete = Array.isArray(story.prs) && story.prsComplete === true && merged.every(pr => Array.isArray(pr.changedPaths));
    if (!tagged && !hasPr && (!complete || !labelsKnown)) {
      unverified.push({ key: story.key, summary: story.summary, reason: 'метки или список файлов PR не подтверждены полностью' }); continue;
    }
    const row = { ...story, responsible: story.responsible || story.assignee || '—' };
    delete row.labels; delete row.prs; delete row.prsComplete;
    if (tagged || hasPr) {
      row.via = tagged && hasPr ? 'метка и PR' : tagged ? 'метка' : 'PR с артефактами';
      row.commit = story.commit || '—';
      if (!complete && !hasPr) row.prVerification = 'не проверено';
      if (!labelsKnown) row.labelVerification = 'не проверено';
      sddStories.push(row); labelCount += Number(tagged); commitCount += Number(hasPr);
    } else plainStories.push(row);
  }
  const storyCount = sddStories.length + plainStories.length;
  return { meta, sddStories, plainStories, unverified, excluded: fixture.excluded,
    counters: { storyCount, sddCount: sddStories.length, plainCount: plainStories.length,
      labelCount, commitCount, unverifiedCount: unverified.length,
      sddShare: storyCount ? (100 * sddStories.length / storyCount).toFixed(1).replace('.', ',') : '0' } };
}
module.exports = { normalizeFixture, splitFixture, assessSdd, selectionId };

module.exports.evaluate=(inputs,parameters)=>assessSdd(inputs.tasks,inputs.code,parameters);
module.exports.files=['tools/lib/actions/query-data.js','tools/lib/actions/code-data.js','processes/sdd-stories-report/rules/sdd.md'];

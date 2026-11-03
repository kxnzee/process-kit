#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const journal=require('./run-journal'),sdd=require('./sdd-data');
const source=path.join(__dirname,'..'),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pk-journal-'));let count=0;
const check=(name,fn)=>{fn();count++;console.log(`✓ ${name}`);};
const read=f=>fs.readFileSync(path.join(cwd,f),'utf8'),write=(f,t)=>fs.writeFileSync(path.join(cwd,f),t),state=o=>JSON.parse(read(`outputs/${o}/.run/state.json`)),events=o=>read(`outputs/${o}/.run/trace.jsonl`).trim().split('\n').map(JSON.parse);
try{
 fs.cpSync(source,cwd,{recursive:true,filter:file=>!['.git','outputs','.history','.codegraph'].includes(path.relative(source,file).split(path.sep)[0])});
 const spec={process:'edit-text',mode:'local',date:'2026-11-03',slug:'текст',inputText:'12 задач DEMO-42.',files:['actions/edit-text/rules/before-after.md']};
 const output=journal.start(cwd,spec).output;
 check('start persists identity and initial state before any step',()=>{assert.equal(state(output).last_step,0);assert.equal(events(output)[0].type,'started');assert.ok(state(output).identity.files[state(output).params.input]);assert.ok(read(`outputs/${output}/итог.md`).includes('выполняется'));});
 check('save without begin is rejected',()=>assert.throws(()=>journal.operation(cwd,'save',{output,step:'edit',artifact:'report-text',extension:'md',content:'12 задач DEMO-42.',next:'end'})));
 journal.operation(cwd,'begin',{output,step:'edit'});
 check('begin records pending attempt before content is produced',()=>{assert.equal(state(output).pending.step,'edit');assert.equal(events(output).at(-1).type,'step_started');});
 check('another begin cannot overwrite a pending attempt',()=>assert.throws(()=>journal.operation(cwd,'begin',{output,step:'edit'})));
 check('save cannot change the declared route',()=>assert.throws(()=>journal.operation(cwd,'save',{output,step:'edit',artifact:'report-text',extension:'md',content:'12 задач DEMO-42.',next:'wrong'})));
 journal.operation(cwd,'save',{output,step:'edit',artifact:'report-text',extension:'md',content:'12 задач DEMO-42.',next:'end'});
 check('save persists artifact, hash and trace before advancing',()=>{assert.equal(state(output).last_step,1);assert.equal(state(output).pending,null);assert.equal(events(output).at(-1).type,'step_completed');assert.ok(state(output).artifactHashes['report-text']);});
 check('reserved summary name cannot be a human result',()=>assert.throws(()=>journal.operation(cwd,'finish',{output,resultName:'итог.md'})));
 journal.operation(cwd,'finish',{output,resultName:'текст.md'});journal.operation(cwd,'finish',{output,resultName:'текст.md'});
 check('finish copies exact result and history remains idempotent',()=>{assert.equal(read(`outputs/${output}/текст.md`),read(`outputs/${output}/.run/01-edit.md`));assert.equal(read('.history/runs.jsonl').trim().split('\n').length,1);assert.equal(events(output).filter(e=>e.type==='finished').length,1);});
 check('new output never overwrites an earlier run',()=>assert.notEqual(journal.start(cwd,spec).output,output));
 check('expected test material cannot enter a runtime snapshot',()=>assert.throws(()=>journal.start(cwd,{...spec,files:['tests/sdd-stories-report/fetch.json']})));
 check('demo period is taken from the actual historical fixture',()=>{const params=journal.effectiveParams(cwd,{mode:'demo',params:{dataFile:'tests/sdd-stories-report/fixture.json',endDate:'today'}},{});assert.equal(params.endDate,'20.01.2026');});
 check('explicit conflicting demo period is blocked',()=>assert.throws(()=>journal.effectiveParams(cwd,{mode:'demo',params:{dataFile:'tests/sdd-stories-report/fixture.json'},explicitParams:{endDate:'2026-11-03'}})));
 const demo=journal.start(cwd,{process:'sdd-stories-report',mode:'demo',date:'2026-11-03',slug:'sdd',params:{dataFile:'tests/sdd-stories-report/fixture.json'},files:['actions/run-query/queries/sdd-stories-report.md','actions/read-code-evidence/queries/sdd-evidence.md','actions/assess-sdd/rules/sdd.md','actions/compose-report/templates/report.md']}).output;
 const fixture=JSON.parse(read('tests/sdd-stories-report/fixture.json')),pair=sdd.splitFixture(fixture),data=sdd.assessSdd(pair.tasks,pair.code);
 check('steps cannot be skipped',()=>assert.throws(()=>journal.operation(cwd,'begin',{output:demo,step:'compose'})));
 for(const [step,artifact,content,next,extension]of [['fetch','task-records',pair.tasks,'read-code','json'],['read-code','code-evidence',pair.code,'assess','json'],['assess','report-data',data,'compose','json'],['compose','report-text','ДАННЫЕ ДЕМО: '+data.counters.sddShare+'%','gate','md']]){
  journal.operation(cwd,'begin',{output:demo,step});
  if(step==='fetch')check('mismatched artifact period is rejected',()=>assert.throws(()=>journal.operation(cwd,'save',{output:demo,step,artifact,extension,content:{...content,meta:{...content.meta,window:'01.01.2026 — 03.11.2026'}},next})));
  journal.operation(cwd,'save',{output:demo,step,artifact,extension,content,next});
 }
 check('finishing at a branch requires an explicit decision',()=>assert.throws(()=>journal.operation(cwd,'finish',{output:demo,resultName:'отчёт.md'})));
 journal.operation(cwd,'finish',{output:demo,resultName:'отчёт.md',decision:'Письмо не запрошено'});
 check('demo end state, summary and history reflect the actual run',()=>{assert.equal(state(demo).last_step,4);assert.equal(state(demo).params.endDate,'20.01.2026');assert.ok(read(`outputs/${demo}/итог.md`).includes('Пробный прогон'));assert.equal(read('.history/runs.jsonl').trim().split('\n').length,2);});
 const failed=journal.start(cwd,{...spec,slug:'ошибка'}).output;journal.operation(cwd,'begin',{output:failed,step:'edit'});journal.operation(cwd,'fail',{output:failed,reason:'Нет входа'});
 check('failure preserves attempt, summary and indexed outcome',()=>{assert.equal(state(failed).status,'failed');assert.ok(state(failed).pending);assert.ok(read(`outputs/${failed}/итог.md`).includes('не получилось: Нет входа'));});
 const changed=journal.start(cwd,{...spec,slug:'изменение'}).output;write(`outputs/${changed}/.run/inputs/input.md`,'other');
 check('changed input prevents continuing an old run',()=>assert.throws(()=>journal.operation(cwd,'begin',{output:changed,step:'edit'}),/Изменён вход/));
 const recovery=journal.start(cwd,{...spec,slug:'фиксация'}).output;journal.operation(cwd,'begin',{output:recovery,step:'edit'});write(`outputs/${recovery}/.run/01-edit.md`,'12 задач DEMO-42.');
 check('partial save is adopted without reexecuting the action',()=>{assert.throws(()=>journal.operation(cwd,'save',{output:recovery,step:'edit',artifact:'report-text',extension:'md',content:'different',next:'end'}));journal.operation(cwd,'save',{output:recovery,step:'edit',artifact:'report-text',extension:'md',content:'12 задач DEMO-42.',next:'end'});assert.equal(state(recovery).last_step,1);assert.equal(events(recovery).filter(e=>e.type==='step_completed').length,1);});
 check('saved task metadata owns its technical selection id',()=>{const o=journal.start(cwd,{process:'sdd-stories-report',mode:'demo',date:'2026-11-03',slug:'метаданные',params:{dataFile:'tests/sdd-stories-report/fixture.json'}}).output;journal.operation(cwd,'begin',{output:o,step:'fetch'});const tasks=structuredClone(pair.tasks);tasks.meta.startDate='01.01.2026';tasks.meta.endDate='20.01.2026';journal.operation(cwd,'save',{output:o,step:'fetch',artifact:'task-records',extension:'json',content:tasks,next:'read-code'});const saved=JSON.parse(read(`outputs/${o}/.run/01-fetch.json`)),code=sdd.evidenceFromFixture(fixture,saved);assert.equal(saved.selectionId,sdd.selectionId(saved));assert.equal(code.selectionId,saved.selectionId);assert.equal(sdd.assessSdd(saved,code).counters.sddShare,'75,0');});
 console.log(`Run journal: ${count} passed.`);
}finally{fs.rmSync(cwd,{recursive:true,force:true});}

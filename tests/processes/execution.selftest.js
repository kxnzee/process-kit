#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const source=path.join(__dirname,'..','..'),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pk-foundation-')),journal=require('../../tools/lib/runtime/run-journal'),{dependencies}=require('../../tools/lib/entities/process-dependencies'),{validateArtifact}=require('../../tools/lib/contracts/artifact-contract');
let count=0;const check=(name,fn)=>{fn();count++;console.log(`✓ ${name}`);};
const read=f=>fs.readFileSync(path.join(cwd,f),'utf8'),write=(f,t)=>{fs.mkdirSync(path.dirname(path.join(cwd,f)),{recursive:true});fs.writeFileSync(path.join(cwd,f),f.endsWith('/PROCESS.md')?require('../fixture').declare(t):t);},state=o=>JSON.parse(read(`outputs/${o}/.run/state.json`));
const process=(name,steps,entry='call')=>`---\nname: ${name}\nversion: 1.0.0\narea: тест\nstatus: действует\npublication: legacy\ndescription: Тестовый процесс\nexample: test\nentry: ${entry}\nrequires:\n  actions: [${[...new Set([...steps.matchAll(/- действие: ([a-z0-9-]+)/g)].map(m=>m[1]))].join(', ')}]\n  context: [master]\nparams:\n  режим: проще\n---\n## Шаги\n${steps}\n`;
const spec={process:'my-parent',mode:'local',date:'2026-11-03',slug:'вложенный',inputText:'12 задач DEMO-42.'};
try{
 require('../fixture').copyProject(source,cwd);
 write('processes/my-editor/PROCESS.md',process('my-editor','### edit\n- действие: edit-text\n- параметры: `text: {params.input}`\n- артефакт: report-text\n- следующий: end','edit').replace('режим: проще','режим: коротко\n  styleFile: context/master/writing-style/CONTEXT.md'));
 write('processes/my-parent/PROCESS.md',process('my-parent','### call\n- процесс: my-editor\n- следующий: after\n### after\n- действие: prepare-mail-draft\n- параметры: `to: Демо`\n- параметры: `subject: Тест`\n- артефакт: mail-draft\n- следующий: end'));
 const dep=dependencies(cwd,'my-parent',{},'local');
 check('child process, context and static action rule are discovered automatically',()=>{for(const file of ['processes/my-editor/PROCESS.md','actions/edit-text/ACTION.md','context/master/writing-style/CONTEXT.md','actions/edit-text/rules/before-after.md'])assert.ok(dep.includes(file),file);});
 const output=journal.start(cwd,spec).output;
 check('direct begin cannot bypass the caller process node',()=>assert.throws(()=>journal.operation(cwd,'begin',{output,process:'my-editor',step:'edit'}),/enter/));
 journal.operation(cwd,'enter',{output,step:'call'});
 check('enter saves a parent continuation and child defaults',()=>{assert.equal(state(output).cursorProcess,'my-editor');assert.equal(state(output).stack[0].next,'after');assert.equal(state(output).params.режим,'коротко');});
 check('execute on an agent step preserves the run and tells the agent to begin',()=>{
  const before=state(output),card=journal.operation(cwd,'next',{output});assert.equal(card.operation,'begin');
  assert.throws(()=>journal.execute(cwd,card.spec),/run begin.*run save/);
  assert.deepEqual(state(output),before);assert.equal(journal.operation(cwd,'next',{output}).operation,'begin');
 });
 journal.operation(cwd,'begin',{output,step:'edit'});
 check('execute on a pending agent step preserves it for save without restarting',()=>{
  const before=state(output),card=journal.operation(cwd,'next',{output});assert.equal(card.operation,'model');
  assert.throws(()=>journal.execute(cwd,card.spec),/Шаг уже начат.*run save/);
  assert.deepEqual(state(output),before);assert.equal(journal.operation(cwd,'next',{output}).operation,'model');
 });
 journal.operation(cwd,'save',{attemptId:state(output).pending.id,output,step:'edit',artifact:'report-text',extension:'md',content:'12 задач DEMO-42.',next:'end'});
 check('a child ending cannot finish the root run',()=>assert.throws(()=>journal.operation(cwd,'finish',{output,resultName:'текст.md'}),/leave/));
 journal.operation(cwd,'leave',{output});
 check('leave returns exactly to the parent continuation and restores params',()=>{assert.equal(state(output).cursorProcess,'my-parent');assert.equal(state(output).next_step,'after');assert.equal(state(output).params.режим,'проще');assert.equal(state(output).stack.length,0);assert.ok(state(output).artifacts['report-text']);});
 check('parent tail cannot be skipped after returning',()=>assert.throws(()=>journal.operation(cwd,'finish',{output,resultName:'текст.md'})));
 journal.operation(cwd,'begin',{output,step:'after'});journal.operation(cwd,'save',{attemptId:state(output).pending.id,output,step:'after',artifact:'mail-draft',extension:'md',content:'Черновик: 12 задач DEMO-42.',next:'end'});journal.operation(cwd,'finish',{output,resultName:'письмо.md'});
 check('complete parent records both executed actions and draft outcome',()=>{assert.equal(state(output).last_step,2);assert.equal(state(output).status,'completed');assert.equal(JSON.parse(read('.history/runs.jsonl').trim()).outcome,'draft');});
 write('processes/my-twice/PROCESS.md',process('my-twice','### call\n- процесс: my-editor\n- артефакт: first\n- следующий: second\n### second\n- процесс: my-editor\n- параметры: `input: {first}`\n- артефакт: second\n- следующий: end'));
 const twice=journal.start(cwd,{...spec,process:'my-twice',slug:'два-вызова'}).output;
 for(const call of ['call','second']){journal.operation(cwd,'enter',{output:twice,step:call});journal.operation(cwd,'begin',{output:twice,step:'edit'});journal.operation(cwd,'save',{attemptId:state(twice).pending.id,output:twice,step:'edit',artifact:'report-text',extension:'md',content:call==='call'?'12 задач DEMO-42.':'12 задач DEMO-42.',next:'end'});journal.operation(cwd,'leave',{output:twice});}
 check('repeated child calls keep independent aliases and physical artifacts',()=>{assert.notEqual(state(twice).artifacts.first,state(twice).artifacts.second);assert.equal(Object.keys(state(twice).recordedArtifacts).length,2);});
 check('all completed child files remain protected after leaving',()=>{const f=`outputs/${twice}/.run/${state(twice).artifacts.first}`,old=read(f);write(f,'changed');assert.throws(()=>journal.operation(cwd,'finish',{output:twice,resultName:'текст.md'}),/Изменён/);write(f,old);});
 const files=dependencies(cwd,'sdd-stories-report',{},'demo');
 check('selected queries, rule, template and schemas are automatic dependencies',()=>{for(const f of ['processes/sdd-stories-report/queries/stories.md','processes/sdd-stories-report/queries/code-evidence.md','processes/sdd-stories-report/rules/sdd.md','processes/sdd-stories-report/templates/report.md','actions/run-query/contracts/result.json','actions/read-code-evidence/contracts/result.json','processes/sdd-stories-report/contracts/report-data.json'])assert.ok(files.includes(f),f);assert.ok(!files.includes('processes/sdd-stories-report/fixture.json'));});
 check('missing declared data blocks snapshot creation',()=>{const f='processes/sdd-stories-report/templates/report.md',old=read(f);fs.unlinkSync(path.join(cwd,f));assert.throws(()=>journal.start(cwd,{process:'sdd-stories-report',mode:'demo',date:'2026-11-03'}));write(f,old);});
 check('a copied process example runs with an independent result alias',()=>{
  const example=read('processes/example/PROCESS.md').replace('name: example','name: my-copy');
  write('processes/my-copy/PROCESS.md',example);
  const o=journal.start(cwd,{process:'my-copy',mode:'local',definitionTest:true,date:'2026-11-05',params:{to:'User',subject:'Status'},inputText:'12 задач DEMO-42.'}).output;
  journal.operation(cwd,'begin',{output:o,step:'edit'});
  journal.operation(cwd,'save',{attemptId:state(o).pending.id,output:o,step:'edit',artifact:'report-text',extension:'md',content:'12 задач DEMO-42.',next:'draft'});
  journal.operation(cwd,'begin',{output:o,step:'draft'});
  journal.operation(cwd,'save',{attemptId:state(o).pending.id,output:o,step:'draft',artifact:'mail-draft',extension:'md',content:'12 задач DEMO-42.',next:'end'});
  for(const resultName of ['CON.md','report:final.md'])assert.throws(()=>journal.operation(cwd,'finish',{output:o,resultName}),/имя файла/);
  journal.operation(cwd,'finish',{output:o,resultName:'текст.md'});
  assert.equal(state(o).status,'completed');assert.equal(read(`outputs/${o}/текст.md`),'12 задач DEMO-42.');
 });
 check('cross-process recursion is rejected before start',()=>{write('processes/my-loop/PROCESS.md',process('my-loop','### call\n- процесс: my-loop\n- следующий: end'));assert.throws(()=>journal.start(cwd,{...spec,process:'my-loop'}),/Цикл/);});
 check('changing an automatically found rule invalidates a snapshot',()=>{const o=journal.start(cwd,{process:'my-editor',mode:'local',date:'2026-11-03',slug:'правило',inputText:'text'}).output,f='actions/edit-text/rules/before-after.md',old=read(f);write(f,old+'\nchanged');assert.throws(()=>journal.operation(cwd,'begin',{output:o,step:'edit'}),/Изменён вход/);write(f,old);});
}finally{fs.rmSync(cwd,{recursive:true,force:true});}

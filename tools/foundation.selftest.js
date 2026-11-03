#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const source=path.join(__dirname,'..'),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pk-foundation-')),journal=require('./run-journal'),sdd=require('./sdd-data'),{dependencies}=require('./process-dependencies'),{validateArtifact}=require('./artifact-contract');
let count=0;const check=(name,fn)=>{fn();count++;console.log(`✓ ${name}`);};
const read=f=>fs.readFileSync(path.join(cwd,f),'utf8'),write=(f,t)=>{fs.mkdirSync(path.dirname(path.join(cwd,f)),{recursive:true});fs.writeFileSync(path.join(cwd,f),t);},state=o=>JSON.parse(read(`outputs/${o}/.run/state.json`));
const process=(name,steps,entry='call')=>`---\nname: ${name}\nversion: 1.0.0\narea: тест\nstatus: действует\ndescription: Тестовый процесс\nexample: test\nentry: ${entry}\nrequires:\n  actions: [prepare-mail-draft]\n  context: [writing-style.md]\nparams:\n  режим: проще\n---\n## Шаги\n${steps}\n`;
const spec={process:'my-parent',mode:'local',date:'2026-11-03',slug:'вложенный',inputText:'12 задач DEMO-42.'};
try{
 fs.cpSync(source,cwd,{recursive:true,filter:f=>!['.git','outputs','.history','.codegraph'].includes(path.relative(source,f).split(path.sep)[0])});
 write('processes/my-parent.md',process('my-parent','### call\n- процесс: edit-text\n- следующий: after\n### after\n- действие: prepare-mail-draft\n- параметры: `to: Демо`\n- параметры: `subject: Тест`\n- артефакт: mail-draft\n- следующий: end'));
 const dep=dependencies(cwd,'my-parent',{},'local');
 check('child process, context and static action rule are discovered automatically',()=>{for(const file of ['processes/edit-text.md','actions/edit-text/ACTION.md','context/writing-style.md','actions/edit-text/rules/before-after.md'])assert.ok(dep.includes(file),file);});
 const output=journal.start(cwd,spec).output;
 check('direct begin cannot bypass the caller process node',()=>assert.throws(()=>journal.operation(cwd,'begin',{output,process:'edit-text',step:'edit'}),/enter/));
 journal.operation(cwd,'enter',{output,step:'call'});
 check('enter saves a parent continuation and child defaults',()=>{assert.equal(state(output).cursorProcess,'edit-text');assert.equal(state(output).stack[0].next,'after');assert.equal(state(output).params.режим,'коротко');});
 journal.operation(cwd,'begin',{output,step:'edit'});journal.operation(cwd,'save',{output,step:'edit',artifact:'report-text',extension:'md',content:'12 задач DEMO-42.',next:'end'});
 check('a child ending cannot finish the root run',()=>assert.throws(()=>journal.operation(cwd,'finish',{output,resultName:'текст.md'}),/leave/));
 journal.operation(cwd,'leave',{output});
 check('leave returns exactly to the parent continuation and restores params',()=>{assert.equal(state(output).cursorProcess,'my-parent');assert.equal(state(output).next_step,'after');assert.equal(state(output).params.режим,'проще');assert.equal(state(output).stack.length,0);assert.ok(state(output).artifacts['report-text']);});
 check('parent tail cannot be skipped after returning',()=>assert.throws(()=>journal.operation(cwd,'finish',{output,resultName:'текст.md'})));
 journal.operation(cwd,'begin',{output,step:'after'});journal.operation(cwd,'save',{output,step:'after',artifact:'mail-draft',extension:'md',content:'Черновик: 12 задач DEMO-42.',next:'end'});journal.operation(cwd,'finish',{output,resultName:'письмо.md'});
 check('complete parent records both executed actions and draft outcome',()=>{assert.equal(state(output).last_step,2);assert.equal(state(output).status,'completed');assert.equal(JSON.parse(read('.history/runs.jsonl').trim()).outcome,'draft');});
 write('processes/my-twice.md',process('my-twice','### call\n- процесс: edit-text\n- артефакт: first\n- следующий: second\n### second\n- процесс: edit-text\n- параметры: `input: {first}`\n- артефакт: second\n- следующий: end'));
 const twice=journal.start(cwd,{...spec,process:'my-twice',slug:'два-вызова'}).output;
 for(const call of ['call','second']){journal.operation(cwd,'enter',{output:twice,step:call});journal.operation(cwd,'begin',{output:twice,step:'edit'});journal.operation(cwd,'save',{output:twice,step:'edit',artifact:'report-text',extension:'md',content:call==='call'?'12 задач DEMO-42.':'12 задач DEMO-42.',next:'end'});journal.operation(cwd,'leave',{output:twice});}
 check('repeated child calls keep independent aliases and physical artifacts',()=>{assert.notEqual(state(twice).artifacts.first,state(twice).artifacts.second);assert.equal(Object.keys(state(twice).recordedArtifacts).length,2);});
 check('all completed child files remain protected after leaving',()=>{const f=`outputs/${twice}/.run/${state(twice).artifacts.first}`,old=read(f);write(f,'changed');assert.throws(()=>journal.operation(cwd,'finish',{output:twice,resultName:'текст.md'}),/Изменён/);write(f,old);});
 const files=dependencies(cwd,'sdd-stories-report',{},'demo');
 check('selected queries, rule, template and schemas are automatic dependencies',()=>{for(const f of ['actions/run-query/queries/sdd-stories-report.md','actions/read-code-evidence/queries/sdd-evidence.md','actions/assess-sdd/rules/sdd.md','actions/compose-report/templates/report.md','actions/run-query/contracts/result.json','actions/read-code-evidence/contracts/result.json','actions/assess-sdd/contracts/result.json'])assert.ok(files.includes(f),f);assert.ok(!files.some(f=>f.startsWith('tests/')));});
 check('missing declared data blocks snapshot creation',()=>{const f='actions/compose-report/templates/report.md',old=read(f);fs.unlinkSync(path.join(cwd,f));assert.throws(()=>journal.start(cwd,{process:'sdd-stories-report',mode:'demo',date:'2026-11-03'}));write(f,old);});
 check('cross-process recursion is rejected before start',()=>{write('processes/my-loop.md',process('my-loop','### call\n- процесс: my-loop\n- следующий: end'));assert.throws(()=>journal.start(cwd,{...spec,process:'my-loop'}),/Цикл/);});
 const fx=JSON.parse(read('tests/sdd-stories-report/fixture.json')),pair=sdd.splitFixture(fx),report=sdd.assessSdd(pair.tasks,pair.code);
 check('current source and assessment examples satisfy full schemas',()=>{validateArtifact(cwd,'run-query','task-records','json',pair.tasks);validateArtifact(cwd,'read-code-evidence','code-evidence','json',pair.code);validateArtifact(cwd,'assess-sdd','report-data','json',report);});
 check('missing fields and invalid nested field types are rejected',()=>{const data=structuredClone(pair.tasks);delete data.stories[0].url;assert.throws(()=>validateArtifact(cwd,'run-query','task-records','json',data));data.stories[0].url=12;assert.throws(()=>validateArtifact(cwd,'run-query','task-records','json',data));});
 check('contradictory calculated counters are rejected',()=>{const data=structuredClone(report);data.counters.storyCount++;assert.throws(()=>validateArtifact(cwd,'assess-sdd','report-data','json',data),/Счётчики/);});
 check('rendered text cannot retain template controls',()=>assert.throws(()=>validateArtifact(cwd,'compose-report','report-text','md','{{#each items}}x{{/each}}')));
 check('unsupported schema rules fail rather than being ignored',()=>assert.throws(()=>require('./value-contract').checkContract({type:'object',requried:['x']})));
 check('changing an automatically found rule invalidates a snapshot',()=>{const o=journal.start(cwd,{process:'edit-text',mode:'local',date:'2026-11-03',slug:'правило',inputText:'text'}).output,f='actions/edit-text/rules/before-after.md',old=read(f);write(f,old+'\nchanged');assert.throws(()=>journal.operation(cwd,'begin',{output:o,step:'edit'}),/Изменён вход/);write(f,old);});
 check('code output cannot refer to a different selected input',()=>{assert.throws(()=>validateArtifact(cwd,'read-code-evidence','code-evidence','json',{...pair.code,selectionId:'wrong'},{taskRecords:pair.tasks}),/другому отбору/);});
 check('assessment output cannot silently drop selected stories',()=>{const data=structuredClone(report);data.sddStories.pop();assert.throws(()=>validateArtifact(cwd,'assess-sdd','report-data','json',data,{taskRecords:pair.tasks}),/потерял/);});
 console.log(`Foundation: ${count} passed.`);
}finally{fs.rmSync(cwd,{recursive:true,force:true});}

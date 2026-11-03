#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {splitFixture,assessSdd,selectionId}=require('./sdd-data'),{processModel}=require('./process-model'),{parseFrontmatter}=require('./markdown');
const source=path.join(__dirname,'..'),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pk-atomic-'));
const fixture=JSON.parse(fs.readFileSync(path.join(source,'tests/sdd-stories-report/fixture.json'),'utf8'));
let count=0;const check=(name,fn)=>{fn();count++;console.log(`✓ ${name}`);};
const clone=structuredClone,read=f=>fs.readFileSync(path.join(cwd,f),'utf8'),write=(f,t)=>fs.writeFileSync(path.join(cwd,f),t);
const validate=rule=>{const r=spawnSync(process.execPath,[path.join(source,'tools/validate.js'),'--root',cwd,'--only',rule,'--json'],{encoding:'utf8'});assert.ok([0,1].includes(r.status));return JSON.parse(r.stdout);};
try{
 for(const dir of ['actions','processes','context','config','adapters','.gigacode'])fs.cpSync(path.join(source,dir),path.join(cwd,dir),{recursive:true});
 const input=splitFixture(fixture),before=JSON.stringify(input);
 check('task reading has no code evidence or classification',()=>{assert.ok(input.tasks.stories.every(row=>!('prs'in row)&&!('via'in row)&&!('commit'in row)));assert.ok(!('counters'in input.tasks));});
 check('code reading has only evidence for selected task keys',()=>{assert.deepEqual(input.code.records.map(r=>r.key),input.tasks.stories.map(r=>r.key));assert.ok(input.code.records.every(row=>!('labels'in row)&&!('via'in row)));});
 check('calculation matches independent expected counters and keys',()=>{const result=assessSdd(input.tasks,input.code),e=JSON.parse(fs.readFileSync(path.join(source,'tests/sdd-stories-report/fetch.json'),'utf8')).expected;for(const key of ['storyCount','sddCount','plainCount','labelCount','commitCount','sddShare','unverifiedCount'])assert.equal(result.counters[key],e[key],key);assert.deepEqual(result.sddStories.map(s=>s.key).sort(),e.sddKeys.sort());assert.deepEqual(result.plainStories.map(s=>s.key).sort(),e.plainKeys.sort());});
 check('calculation leaves both recorded inputs unchanged',()=>{assessSdd(input.tasks,input.code);assert.equal(JSON.stringify(input),before);});
 check('missing evidence cannot become a negative code result',()=>{const code=clone(input.code);code.records=code.records.filter(row=>row.key!=='DEMO-203');const result=assessSdd(input.tasks,code);assert.ok(result.unverified.some(row=>row.key==='DEMO-203'));assert.ok(!result.plainStories.some(row=>row.key==='DEMO-203'));});
 check('positive label survives incomplete code with explicit uncertainty',()=>{const code=clone(input.code);code.records=code.records.filter(row=>row.key!=='DEMO-201');const row=assessSdd(input.tasks,code).sddStories.find(row=>row.key==='DEMO-201');assert.equal(row.prVerification,'не проверено');});
 check('foreign or duplicate code keys are rejected',()=>{const code=clone(input.code);code.records.push({key:'FOREIGN-1'});assert.throws(()=>assessSdd(input.tasks,code));code.records.pop();code.records.push(code.records[0]);assert.throws(()=>assessSdd(input.tasks,code));});
 check('code cannot override task labels',()=>{const code=clone(input.code);code.records[0].labels=[];assert.throws(()=>assessSdd(input.tasks,code),/посторонние/);});
 check('malformed completeness and paths cannot prove absence',()=>{const code=clone(input.code);code.records[0].prsComplete='false';assert.throws(()=>assessSdd(input.tasks,code));delete code.records[0].prsComplete;code.records[0].prs=[{state:'MERGED',changedPaths:[12]}];assert.throws(()=>assessSdd(input.tasks,code));});
 check('evidence from another selection is rejected',()=>{assert.throws(()=>assessSdd(input.tasks,{...input.code,selectionId:'wrong'}));const tasks=clone(input.tasks);tasks.stories.pop();assert.throws(()=>assessSdd(tasks,input.code));});
 check('live calculation is not silently marked demo',()=>{const tasks=clone(input.tasks);tasks.meta.demo=false;tasks.selectionId=selectionId(tasks);assert.equal(assessSdd(tasks,{...input.code,selectionId:tasks.selectionId}).meta.demo,false);});
 check('process explicitly sequences independent operations',()=>{const steps=processModel(read('processes/sdd-stories-report.md')).steps.filter(s=>s.kind==='action');assert.deepEqual(steps.map(s=>s.ref),['run-query','read-code-evidence','assess-sdd','compose-report','prepare-mail-draft']);assert.equal(validate('processes').errors,0);});
 check('skipping code read fails input availability check',()=>{const f='processes/sdd-stories-report.md',old=read(f);write(f,old.replace('следующий: read-code','следующий: assess'));assert.ok(validate('processes').issues.some(i=>i.msg.includes('code-evidence недоступен')));write(f,old);});
 check('action with mode-dependent multiple outputs is rejected',()=>{const f='actions/run-query/ACTION.md',old=read(f);write(f,old.replace('  task-records:', '  records-text: иной результат\n  task-records:'));assert.ok(validate('actions').issues.some(i=>i.msg.includes('один именованный результат')));write(f,old);});
 check('all action contracts validate after separation',()=>{assert.equal(validate('actions').errors,0);for(const name of fs.readdirSync(path.join(cwd,'actions'))){const file=`actions/${name}/ACTION.md`;if(!fs.existsSync(path.join(cwd,file)))continue;assert.equal(Object.keys(parseFrontmatter(read(file)).data.produces).length,1);}});
 console.log(`Atomic actions: ${count} passed.`);
}finally{fs.rmSync(cwd,{recursive:true,force:true});}

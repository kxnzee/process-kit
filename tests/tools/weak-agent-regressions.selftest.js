'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,write,check,validate}=ctx;
const j=require('../../tools/lib/runtime/run-journal'),{invoke}=require('../../tools/lib/actions/invoke');
try{
 check('direct local editing needs no process and cannot silently lose numeric facts',()=>{
  const spec={action:'edit-text',mode:'local',inputText:'На этой неделе завершили 12 задач DEMO-42. Проверка — 15 ноября.'};
  assert.equal(invoke(tmp,spec).status,'needs-model');
  const result=invoke(tmp,{...spec,value:'Завершили 12 задач DEMO-42. Проверка — 15 ноября.'});assert.equal(result.status,'completed');
  assert.throws(()=>invoke(tmp,{...spec,value:'Завершили 11 задач.'}),/потерян факт/);
  assert.ok(!fs.existsSync(path.join(tmp,'processes/edit-text')));assert.ok(!fs.existsSync(path.join(tmp,'outputs')));
 });
 check('saved direct action results are valid outputs and are never overwritten',()=>{
  const spec={action:'edit-text',inputText:'12 задач.',value:'12 задач.',resultFile:'outputs/2026-11-05_короткий-текст/текст.md'};
  const saved=invoke(tmp,spec);assert.ok(fs.existsSync(saved.resultFile));validate(['--only','outputs'],true);
  assert.throws(()=>invoke(tmp,spec));
 });
 check('test project copies exclude active personal and team configs but retain examples',()=>{
  const source=path.join(tmp,'copy-source'),target=path.join(tmp,'copy-target');
  for(const file of ['my/config.json','team/config.json','master/config.json','my/EXAMPLE.json']){const full=path.join(source,'config',file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,'{}');}
  for(const file of ['tmp/nested/.git/HEAD','cache/data','skills/probe/SKILL.md','references/probe.md','hooks/pre-push']){const full=path.join(source,'.gigacode',file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,'fixture');}
  require('../fixture').copyProject(source,target);
  assert.ok(!fs.existsSync(path.join(target,'config/my/config.json')));assert.ok(!fs.existsSync(path.join(target,'config/team/config.json')));
  assert.ok(fs.existsSync(path.join(target,'config/master/config.json')));assert.ok(fs.existsSync(path.join(target,'config/my/EXAMPLE.json')));
  for(const folder of ['tmp','cache'])assert.ok(!fs.existsSync(path.join(target,'.gigacode',folder)));
  for(const file of ['skills/probe/SKILL.md','references/probe.md','hooks/pre-push'])assert.ok(fs.existsSync(path.join(target,'.gigacode',file)));
 });
 check('next and execute complete every deterministic demo step and preserve report facts',()=>{
  const run=j.start(tmp,{process:'sdd-stories-report',mode:'demo',params:{dataFile:'processes/sdd-stories-report/fixture.json'}});
  assert.ok(Math.abs(new Date(run.output.slice(0,10)+'T12:00:00').valueOf()-Date.now())<86400000,'Run folder uses today, not fixture date');
  for(const step of ['fetch','read-code','assess','compose']){const card=j.operation(tmp,'next',{output:run.output});assert.equal(card.operation,'execute');assert.equal(card.spec.step,step);j.execute(tmp,card.spec);}
  const card=j.operation(tmp,'next',{output:run.output});assert.equal(card.operation,'choose');
  j.operation(tmp,'choose',{output:run.output,step:'gate',target:'end'});
  const state=j.operation(tmp,'finish',{output:run.output,resultName:'отчёт.md',decision:'Письмо не запрошено'});
  const text=fs.readFileSync(path.join(tmp,'outputs',run.output,state.result),'utf8');
  for(const fact of ['75,0','DEMO-401','DEMO-402','ДАННЫЕ ДЕМО','01.01.2026 — 20.01.2026'])assert.ok(text.includes(fact),fact);
  assert.equal(j.operation(tmp,'next',{output:run.output}).status,'completed');
 });
 check('failed local execution writes failed state and history instead of leaving an abandoned pending run',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(tmp,'processes/sdd-stories-report/fixture.json')));fixture.result.records[0].key=12;
  write('processes/sdd-stories-report/bad-fixture.json',JSON.stringify(fixture));
  const run=j.start(tmp,{process:'sdd-stories-report',mode:'demo',date:'2026-11-05',slug:'bad',params:{dataFile:'processes/sdd-stories-report/bad-fixture.json'}});
  assert.throws(()=>j.execute(tmp,{output:run.output,step:'fetch'}));
  const state=JSON.parse(fs.readFileSync(path.join(tmp,'outputs',run.output,'.run/state.json')));assert.equal(state.status,'failed');assert.ok(state.failure.reason);
  const card=j.operation(tmp,'next',{output:run.output});assert.equal(card.status,'failed');assert.equal(card.operation,'done');assert.ok(fs.existsSync(card.summaryFile));assert.ok(!card.summaryFile.includes('.run'+path.sep));
 });
 check('explicit branch selection followed by execute keeps the run alive',()=>{
  const run=j.start(tmp,{process:'sdd-stories-report',mode:'demo',date:'2026-11-06',slug:'ветвление',params:{dataFile:'processes/sdd-stories-report/fixture.json',wantsMail:true,recipients:'test@example.invalid'}});
  for(const step of ['fetch','read-code','assess','compose'])j.execute(tmp,{output:run.output,step});
  let card=j.operation(tmp,'next',{output:run.output});assert.equal(card.operation,'choose');
  assert.throws(()=>j.execute(tmp,{output:run.output,step:'end',decision:'письмо не нужно'}),/run choose/);
  card=j.operation(tmp,'next',{output:run.output});assert.equal(card.operation,'choose','отказ по позиции не должен двигать прогон');
  j.operation(tmp,'choose',{output:run.output,step:card.step,target:'prepare-mail-data',decision:'человек попросил письмо для стори без SDD'});
  const after=j.execute(tmp,{output:run.output,step:'prepare-mail-data'});
  assert.equal(after.last_step_name,'prepare-mail-data');
  const state=JSON.parse(fs.readFileSync(path.join(tmp,'outputs',run.output,'.run/state.json')));
  assert.equal(state.status,'running');assert.equal(state.next_step,'compose-mail');assert.equal(state.failure,undefined);
  assert.ok(state.artifacts['mail-data'],'шаг развилки не сохранил артефакт');
  assert.ok(/"type":"branch_decision"/.test(fs.readFileSync(path.join(tmp,'outputs',run.output,'.run/trace.jsonl'),'utf8')),'переход по развилке не зафиксирован');
 });
}finally{ctx.close();}

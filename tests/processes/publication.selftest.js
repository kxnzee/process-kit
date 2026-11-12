'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,check,write}=ctx;
const {publishDefinition}=require('./publication-helpers');
const journal=require('../../tools/lib/runtime/run-journal'),{lifecycle}=require('../../tools/lib/entities/process-release');
try{
 for(const process of ['example','sdd-stories-report','info-povod'])check(`${process}: validate, every branch, publish and normal run`,()=>{
  const published=publishDefinition(tmp,process);
  assert.equal(published.receipt.status,'published');assert.ok(fs.existsSync(published.normal.resultFile));
  assert.equal(lifecycle(tmp,'status',{process}).status,'published');
  if(process==='sdd-stories-report')assert.ok(fs.existsSync(path.join(tmp,'outputs',published.runs[1].output,'отчёт.md')));
 });
 check('a copied receipt does not publish a new process name',()=>{
  fs.cpSync(path.join(tmp,'processes/example'),path.join(tmp,'processes/my-copy'),{recursive:true});
  const file=path.join(tmp,'processes/my-copy/PROCESS.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: example','name: my-copy'));
  assert.equal(lifecycle(tmp,'status',{process:'my-copy'}).status,'draft');
  assert.throws(()=>journal.start(tmp,{process:'my-copy',mode:'local',inputText:'12 задач.'}),/не опубликовано/);
 });
 check('methodology credential URLs are rejected before a run is created',()=>{
  const before=fs.readdirSync(path.join(tmp,'outputs')).sort(),params={dataFile:'processes/info-povod/fixture.json',methodologyCheck:'yes',runDate:'2026-11-07'};
  for(const suffix of ['?access_token=SYNTHETIC_SECRET','#access_token=SYNTHETIC_SECRET','?api_key=SYNTHETIC_SECRET'])assert.throws(()=>journal.start(tmp,{process:'info-povod',mode:'demo',params:{...params,methodologyUrl:'https://example.invalid/method'+suffix}}),/без учётных данных/);
  assert.deepEqual(fs.readdirSync(path.join(tmp,'outputs')).sort(),before);
 });
 check('a missing action cannot pass publication, even with a previously tested definition',()=>{
  const file=path.join(tmp,'actions/edit-text/ACTION.md'),original=fs.readFileSync(file,'utf8');
  fs.unlinkSync(file);
  try{assert.throws(()=>lifecycle(tmp,'publish',{process:'example'}));}finally{fs.writeFileSync(file,original);}
 });
 check('classification rejects inconsistent counters and missing members before advancing',()=>{
  const params={dataFile:'processes/info-povod/fixture.json',methodologyCheck:'no',runDate:'2026-11-07'};
  const {output}=journal.start(tmp,{process:'info-povod',mode:'demo',params});
  for(const step of ['fetch-sigma','fetch-delta'])journal.execute(tmp,{output,step});
  journal.operation(tmp,'begin',{output,step:'classify-sigma'});
  const card=journal.operation(tmp,'next',{output}),value=require('./publication-helpers').modelResult(tmp,output,card);
  assert.throws(()=>journal.operation(tmp,'save',{...card.save,content:{...value,byClass:{...value.byClass,total:0}}}),/total/);
  assert.throws(()=>journal.operation(tmp,'save',{...card.save,content:{...value,items:value.items.slice(1)}}),/каждую задачу/);
  assert.equal(journal.operation(tmp,'next',{output}).spec.attemptId,card.spec.attemptId);
  journal.operation(tmp,'save',{...card.save,content:value});
  assert.equal(journal.operation(tmp,'next',{output}).spec.step,'classify-delta');
 });
 check('methodology gate is computed and user review cannot be silently accepted',()=>{
  const params={dataFile:'processes/info-povod/fixture.json',methodologyCheck:'yes',methodologyUrl:'https://example.invalid/methodology',runDate:'2026-11-07'};
  assert.throws(()=>journal.start(tmp,{process:'info-povod',mode:'demo',params:{...params,methodologyCheck:'ask'}}),/до start/);
  const run=journal.start(tmp,{process:'info-povod',mode:'demo',params}),output=run.output;
  const gate=journal.operation(tmp,'next',{output});assert.equal(gate.decisionMode,'code');assert.deepEqual(gate.targets,['check-methodology']);
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'fetch-sigma',decision:'Пропустить'}),/Выбор ветки/);
  journal.operation(tmp,'begin',{output,step:'check-methodology'});
  const pending=journal.operation(tmp,'next',{output});assert.equal(pending.stepStatus,'running');
  const value=require('./publication-helpers').modelResult(tmp,output,pending);
  assert.throws(()=>journal.operation(tmp,'save',{...pending.save,content:{...value,matched:1}}),/Счётчики/);
  const partial=structuredClone(value);partial.sections[0].status='matched';partial.matched=1;partial.unverified--;partial.unverifiedSections=partial.unverifiedSections.filter(row=>row.section!==partial.sections[0].section);
  journal.operation(tmp,'save',{...pending.save,content:partial});
  const review=journal.operation(tmp,'next',{output});assert.equal(review.decisionMode,'user');assert.equal(review.requiresConfirmation,true);assert.equal(review.stepStatus,'blocked');
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'fetch-sigma',decision:'Я согласен'}),/confirmed/);
  assert.equal(journal.operation(tmp,'next',{output}).step,'methodology-review');
  journal.operation(tmp,'begin',{output,step:'fetch-sigma',confirmed:true,decision:'Проверочный фактический ответ человека: продолжить'});
  assert.equal(journal.operation(tmp,'next',{output}).spec.step,'fetch-sigma');
 });
}finally{ctx.close();}

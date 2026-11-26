'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,check,write}=ctx;
const {publishDefinition}=require('./publication-helpers');
const journal=require('../../tools/lib/runtime/run-journal'),{lifecycle}=require('../../tools/lib/entities/process-release');
try{
 // The public GigaCode seam requires a real personal scope for private definitions.
 require('node:child_process').execFileSync('git',['init','-b','my'],{cwd:tmp,stdio:'ignore'});
 write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:null,profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'},taskStores:[],codeStores:[],defaults:{},preferences:{}}));
 check('definitionTest does not bypass act approval in local/demo or permit publication of incomplete runs',()=>{
  fs.cpSync(path.join(tmp,'actions/example'),path.join(tmp,'actions/my-publication-act'),{recursive:true});
  const file=path.join(tmp,'actions/my-publication-act/ACTION.md');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: example','name: my-publication-act').replace('kind: transform','kind: act'));
  write('processes/my-publication-act/PROCESS.md','---\nname: my-publication-act\nversion: 1.0.0\narea: test\nstatus: действует\npublication: required\ndescription: Definition approval regression\nexample: test\nentry: write\nparams:\n  text: receipt\n  rule: default\n---\n## Шаги\n### write\n- действие: my-publication-act\n- артефакт: receipt\n- следующий: end\n');
  assert.equal(lifecycle(tmp,'validate',{process:'my-publication-act'}).status,'validated');
  const integration=require('../../tools/lib/integrations/gigacode-run');
  for(const mode of ['local','demo']){
   const {output}=integration.run(tmp,'start',{process:'my-publication-act',mode,definitionTest:true});
   const card=integration.run(tmp,'next',{output});assert.equal(card.operation,'approval-required');assert.equal(card.verificationAvailable,false);
   assert.throws(()=>integration.run(tmp,'begin',card.spec),/Нет доверенного канала verifyApproval/);
   assert.throws(()=>lifecycle(tmp,'test',{process:'my-publication-act',outputs:[output]}),/Требуется завершённый/);
  }
  assert.throws(()=>lifecycle(tmp,'publish',{process:'my-publication-act'}),/Сначала definition test/);
 });
 for(const process of ['example','sdd-stories-report','info-povod'])check(`${process}: validate, every branch, publish and normal run`,()=>{
  const published=publishDefinition(tmp,process);
  assert.equal(published.receipt.status,'published');assert.ok(fs.existsSync(published.normal.resultFile));
  assert.equal(lifecycle(tmp,'status',{process}).status,'published');
  if(process==='sdd-stories-report')assert.ok(fs.existsSync(path.join(tmp,'outputs',published.runs[1].output,'отчёт.md')));
 });
 check('a repeated full cycle with fresh run names writes byte-identical portable receipts',()=>{
  const file=path.join(tmp,'processes/example/publication.json'),before=fs.readFileSync(file,'utf8'),receipt=JSON.parse(before);
  assert.deepEqual(Object.keys(receipt),['schemaVersion','process','status','scope','files']);
  assert.equal(receipt.schemaVersion,2);assert.ok(!('outputs'in receipt));assert.ok(!('updated'in receipt));
  assert.equal(publishDefinition(tmp,'example').receipt.status,'published');
  assert.equal(fs.readFileSync(file,'utf8'),before);
 });
 check('correct v1 receipts stay admissible, while stray v2 fields do not become valid evidence',()=>{
  const file=path.join(tmp,'processes/example/publication.json'),portable=JSON.parse(fs.readFileSync(file,'utf8'));
  fs.writeFileSync(file,JSON.stringify({...portable,schemaVersion:1,outputs:['синтетический-v1-прогон'],updated:'2026-01-01T00:00:00.000Z'},null,2)+'\n');
  const spec={process:'example'};
  assert.equal(lifecycle(tmp,'status',spec).status,'published');
  assert.equal(journal.start(tmp,{process:'example',mode:'local',inputText:'12 задач.',params:{to:'User',subject:'Status'}}).state.status,'running');
  lifecycle(tmp,'publish',spec);
  const restored=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(restored.schemaVersion,2);assert.equal(restored.status,'published');
  assert.ok(!('outputs'in restored)&&!('updated'in restored));
  assert.deepEqual(Object.entries(restored.files),Object.entries(portable.files));
  for(const patch of [{outputs:['v2-не-переносит-имена-прогонов']},{updated:'2026-01-01T00:00:00.000Z'}]){
   fs.writeFileSync(file,JSON.stringify({...restored,...patch},null,2)+'\n');
   assert.equal(lifecycle(tmp,'status',spec).status,'draft');
  }
  fs.writeFileSync(file,JSON.stringify(restored,null,2)+'\n');
 });
 check('publish normalizes legacy key order, so conversion, republication and a fresh full cycle agree byte-for-byte',()=>{
  const file=path.join(tmp,'processes/example/publication.json'),canonical=JSON.parse(fs.readFileSync(file,'utf8'));
  fs.writeFileSync(file,JSON.stringify({schemaVersion:1,process:'example',status:'published',scope:'local/demo',files:Object.fromEntries(Object.entries(canonical.files).reverse()),outputs:['синтетический-v1-порядок'],updated:'2026-01-01T00:00:00.000Z'},null,2)+'\n');
  lifecycle(tmp,'publish',{process:'example'});
  const converted=fs.readFileSync(file,'utf8'),receipt=JSON.parse(converted);
  assert.deepEqual(Object.keys(receipt),['schemaVersion','process','status','scope','files']);
  assert.deepEqual(Object.keys(receipt.files),Object.keys(canonical.files));
  assert.ok(!('outputs'in receipt)&&!('updated'in receipt));
  lifecycle(tmp,'publish',{process:'example'});
  assert.equal(fs.readFileSync(file,'utf8'),converted);
  publishDefinition(tmp,'example');
  assert.equal(fs.readFileSync(file,'utf8'),converted);
 });
 check('a copied receipt does not publish a new process name',()=>{
  fs.cpSync(path.join(tmp,'processes/example'),path.join(tmp,'processes/my-copy'),{recursive:true});
  const file=path.join(tmp,'processes/my-copy/PROCESS.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: example','name: my-copy'));
  assert.equal(lifecycle(tmp,'status',{process:'my-copy'}).status,'draft');
  assert.throws(()=>journal.start(tmp,{process:'my-copy',mode:'local',inputText:'12 задач.'}),/не опубликовано/);
 });
 check('a new draft copied without the template receipt remains discoverable but cannot run',()=>{
  const template=path.join(tmp,'processes/example'),folder=path.join(tmp,'processes/catalog-draft');
  fs.cpSync(template,folder,{recursive:true,filter:source=>source!==path.join(template,'publication.json')});
  const file=path.join(folder,'PROCESS.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: example','name: catalog-draft'));
  const rows=require('../../tools/lib/entities/process-catalog').catalog(tmp,{level:'master'});
  assert.equal(rows.complete,true);assert.deepEqual(rows.processes.find(p=>p.name==='catalog-draft').publication,{status:'draft',current:false});
  assert.equal(fs.existsSync(path.join(folder,'publication.json')),false);
  assert.throws(()=>journal.start(tmp,{process:'catalog-draft',mode:'local',inputText:'12 задач.',params:{to:'User',subject:'Status'}}),/не опубликовано/);
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
  journal.operation(tmp,'choose',{output,step:'methodology-gate',target:'fetch-sigma'});
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
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'fetch-sigma',decision:'Пропустить'}),/run choose/);
  journal.operation(tmp,'choose',{output,step:'methodology-gate',target:'check-methodology'});
  journal.operation(tmp,'begin',{output,step:'check-methodology'});
  const pending=journal.operation(tmp,'next',{output});assert.equal(pending.stepStatus,'running');
  const value=require('./publication-helpers').modelResult(tmp,output,pending);
  assert.throws(()=>journal.operation(tmp,'save',{...pending.save,content:{...value,matched:1}}),/Счётчики/);
  const partial=structuredClone(value);partial.sections[0].status='matched';partial.matched=1;partial.unverified--;partial.unverifiedSections=partial.unverifiedSections.filter(row=>row.section!==partial.sections[0].section);
  journal.operation(tmp,'save',{...pending.save,content:partial});
  const review=journal.operation(tmp,'next',{output});assert.equal(review.decisionMode,'user');assert.equal(review.requiresApproval,false);assert.equal(review.stepStatus,'pending');
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'fetch-sigma',decision:'Я согласен'}),/run choose/);
  assert.equal(journal.operation(tmp,'next',{output}).step,'methodology-review');
  assert.throws(()=>journal.operation(tmp,'choose',{...review.spec,target:'fetch-sigma',confirmed:true}),/confirmed/);
  assert.throws(()=>journal.operation(tmp,'choose',{...review.spec,target:'fetch-sigma'}),/нет decision/);
  journal.operation(tmp,'choose',{...review.spec,target:'fetch-sigma',decision:'Человек ответил: продолжай после сверки'});
  assert.equal(journal.operation(tmp,'next',{output}).spec.step,'fetch-sigma');
 });
}finally{ctx.close();}

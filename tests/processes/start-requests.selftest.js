'use strict';
const c=require('../fixture')(),{tmp,fs,path,assert,check,source}=c;
const journal=require('../../tools/lib/runtime/run-journal'),storage=require('../../tools/lib/runtime/run-storage');
const {spawn,spawnSync}=require('node:child_process');
const base={process:'example',mode:'local',inputText:'12 tasks DEMO-42.',params:{to:'Test',subject:'Status'}};
const starts=()=>fs.existsSync(path.join(tmp,'outputs'))?fs.readdirSync(path.join(tmp,'outputs')).length:0;
async function main(){
 require('../fixture').seedPublication(tmp,'example',base);
 check('same start key reuses the original run and pending attempt; changed requests fail closed',()=>{
  const spec={...base,idempotencyKey:'request-1'},first=journal.start(tmp,spec);
  const begun=journal.operation(tmp,'begin',{output:first.output,step:'edit'}),count=starts();
  const again=journal.start(tmp,{...spec,params:{subject:'Status',to:'Test'}});
  assert.equal(again.reused,true);assert.equal(again.output,first.output);assert.equal(again.state.identity.runId,first.state.identity.runId);assert.equal(again.state.pending.id,begun.pending.id);assert.equal(starts(),count);
  const saved=JSON.parse(fs.readFileSync(first.startRequestFile,'utf8'));assert.deepEqual(saved,spec);
  assert.equal(journal.start(tmp,saved).output,first.output);assert.equal(journal.operation(tmp,'next',{output:first.output}).startRequestFile,first.startRequestFile);
  for(const patch of [{inputText:'changed'},{params:{...base.params,subject:'changed'}},{mode:'demo'}])assert.throws(()=>journal.start(tmp,{...spec,...patch}));
  assert.equal(starts(),count);
 });
 check('new keys and unkeyed intentional starts remain independent',()=>{
  const a=journal.start(tmp,{...base,idempotencyKey:'request-2'}),b=journal.start(tmp,base),d=journal.start(tmp,base);
  assert.notEqual(a.output,b.output);assert.notEqual(b.output,d.output);
  for(const key of ['',null,'../bad',123,'x'.repeat(129)])assert.throws(()=>journal.start(tmp,{...base,idempotencyKey:key}));
  assert.throws(()=>journal.start(tmp,{...base,idempotencyKey:'unknown-field',privateToken:'must-not-be-saved'}));
 });
 check('the saved start request is protected against changes',()=>{
  const run=journal.start(tmp,{...base,idempotencyKey:'tamper'}),original=fs.readFileSync(run.startRequestFile);
  try{fs.writeFileSync(run.startRequestFile,'{}');assert.throws(()=>journal.operation(tmp,'next',{output:run.output}));}finally{fs.writeFileSync(run.startRequestFile,original);}
 });
 check('a lost start response is recovered from the transaction without a second run',()=>{
  const finish=storage.finish,spec={...base,idempotencyKey:'interrupted'},count=starts();let injected=false;
  storage.finish=function(){if(!injected){injected=true;throw Error('START_RESPONSE_LOST');}return finish.apply(this,arguments);};
  try{assert.throws(()=>journal.start(tmp,spec),/START_RESPONSE_LOST/);}finally{storage.finish=finish;}
  assert.equal(starts(),count+1);const again=journal.start(tmp,spec);assert.equal(again.reused,true);assert.equal(starts(),count+1);
  const rows=fs.readFileSync(path.join(tmp,'outputs',again.output,'.run/trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.filter(e=>e.type==='started').length,1);
 });
 check('reserved starts recover directory creation and partial input/request writes before the first transaction',()=>{
  for(const point of ['reserved','folder','run','input','request','stage']){
   const spec={...base,idempotencyKey:'before-tx-'+point},count=starts(),mkdir=fs.mkdirSync,write=fs.writeFileSync,stage=storage.stage;let injected=false;
   const stop=()=>{injected=true;throw Error('BEFORE_INITIAL_TRANSACTION');};
   fs.mkdirSync=function(file){if(!injected&&point==='reserved'&&String(file)===path.join(tmp,'outputs'))stop();const result=mkdir.apply(this,arguments);if(!injected&&(point==='folder'&&path.dirname(String(file))===path.join(tmp,'outputs')||point==='run'&&path.basename(String(file))==='.run'))stop();return result;};
   fs.writeFileSync=function(file,bytes,options){
    if(!injected&&(point==='input'&&String(file).endsWith('input.md')||point==='request'&&String(file).endsWith('start-request.json'))){const data=Buffer.from(bytes);write.call(this,file,data.subarray(0,Math.floor(data.length/2)),options);stop();}
    return write.apply(this,arguments);
   };
   storage.stage=function(){if(point==='stage'&&!injected)stop();return stage.apply(this,arguments);};
   try{assert.throws(()=>journal.start(tmp,spec),/BEFORE_INITIAL_TRANSACTION/);}finally{fs.mkdirSync=mkdir;fs.writeFileSync=write;storage.stage=stage;}
   assert.equal(starts(),count+(point==='reserved'?0:1));
   const key=storage.hash(spec.idempotencyKey),recordFile=path.join(tmp,'.history/start-requests',key+'.json'),reserved=JSON.parse(fs.readFileSync(recordFile,'utf8'));
   assert.equal(reserved.status,'reserved');assert.equal(fs.existsSync(path.join(tmp,'outputs',reserved.output,'.run/transaction.json')),false);
   const again=journal.start(tmp,spec);assert.equal(again.reused,true);assert.equal(again.output,reserved.output);assert.equal(again.state.identity.runId,reserved.initial.state.identity.runId);assert.equal(starts(),count+1);
   assert.equal(journal.operation(tmp,'next',{output:again.output}).operation,'begin');
   const rows=fs.readFileSync(path.join(tmp,'outputs',again.output,'.run/trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.filter(e=>e.type==='started').length,1);
   const ready=JSON.parse(fs.readFileSync(recordFile,'utf8'));assert.equal(ready.status,'ready');assert.equal(ready.initial,undefined);
  }
 });
 check('pre-transaction recovery preserves unknown files, changed input and unverifiable legacy reservations',()=>{
  for(const point of ['unknown','foreign-temp','changed-input','legacy','changed-core']){
   const spec={...base,idempotencyKey:'unverified-'+point},stage=storage.stage;
   storage.stage=()=>{throw Error('NO_TRANSACTION');};
   try{assert.throws(()=>journal.start(tmp,spec),/NO_TRANSACTION/);}finally{storage.stage=stage;}
   const key=storage.hash(spec.idempotencyKey),recordFile=path.join(tmp,'.history/start-requests',key+'.json'),record=JSON.parse(fs.readFileSync(recordFile,'utf8')),folder=path.join(tmp,'outputs',record.output),count=starts();
   const core=path.join(tmp,'tools/lib/entities/process-facts.js'),original=fs.readFileSync(core);
   if(point==='unknown')fs.writeFileSync(path.join(folder,'unrelated.txt'),'PRESERVE');
   const foreignTemp=path.join(folder,'.run','transaction.json.'+require('node:crypto').randomUUID()+'.tmp');
   if(point==='foreign-temp')fs.writeFileSync(foreignTemp,'PRESERVE_FOREIGN_TEMP');
   if(point==='changed-input')fs.writeFileSync(path.join(folder,'.run/inputs/input.md'),'DIFFERENT');
   if(point==='legacy'){delete record.initial;delete record.initialHash;fs.writeFileSync(recordFile,JSON.stringify(record));}
   if(point==='changed-core')fs.appendFileSync(core,'\n// changed');
   const before=fs.readFileSync(recordFile);
   try{assert.throws(()=>journal.start(tmp,spec),/Неподтверждённый|проверенного начального|Изменён вход/);}finally{fs.writeFileSync(core,original);}
   assert.deepEqual(fs.readFileSync(recordFile),before);assert.equal(starts(),count);assert.equal(fs.existsSync(path.join(folder,'.run/state.json')),false);
   if(point==='unknown')assert.equal(fs.readFileSync(path.join(folder,'unrelated.txt'),'utf8'),'PRESERVE');
   if(point==='foreign-temp')assert.equal(fs.readFileSync(foreignTemp,'utf8'),'PRESERVE_FOREIGN_TEMP');
   if(point==='changed-input')assert.equal(fs.readFileSync(path.join(folder,'.run/inputs/input.md'),'utf8'),'DIFFERENT');
  }
 });
 check('a process exit during bootstrap recovery leaves a reclaimable lock and the same run identity',()=>{
  const spec={...base,idempotencyKey:'bootstrap-process-exit'},script="const storage=require(process.argv[1]);storage.stage=()=>process.exit(23);require(process.argv[2]).start(process.argv[3],JSON.parse(process.argv[4]));";
  for(let i=0;i<2;i++){const child=spawnSync(process.execPath,['-e',script,path.join(source,'tools/lib/runtime/run-storage'),path.join(source,'tools/lib/runtime/run-journal'),tmp,JSON.stringify(spec)],{encoding:'utf8'});assert.equal(child.status,23,child.stderr);}
  const key=storage.hash(spec.idempotencyKey),record=JSON.parse(fs.readFileSync(path.join(tmp,'.history/start-requests',key+'.json'),'utf8'));
  const run=journal.start(tmp,spec);assert.equal(run.output,record.output);assert.equal(run.state.identity.runId,record.initial.state.identity.runId);
 });
 check('a process exit inside the initial transaction write recovers only matching temporary bytes',()=>{
  const spec={...base,idempotencyKey:'initial-tx-partial-write'},script="const fs=require('node:fs'),write=fs.writeFileSync;fs.writeFileSync=function(file,bytes,options){if(/transaction\\.json\\..+\\.tmp$/.test(String(file))){write.call(this,file,Buffer.from(bytes).subarray(0,100),options);process.exit(23);}return write.apply(this,arguments);};require(process.argv[1]).start(process.argv[2],JSON.parse(process.argv[3]));";
  for(let i=0;i<2;i++){const child=spawnSync(process.execPath,['-e',script,path.join(source,'tools/lib/runtime/run-journal'),tmp,JSON.stringify(spec)],{encoding:'utf8'});assert.equal(child.status,23,child.stderr);}
  const run=journal.start(tmp,spec),dir=path.join(tmp,'outputs',run.output,'.run');assert.equal(run.reused,true);
  assert.ok(!fs.readdirSync(dir).some(name=>name.endsWith('.tmp')||name.endsWith('.candidate')||name.endsWith('.lock')));
 });
 check('the public GigaCode route recovers bootstrap and accepts overlapping core/environment snapshots',()=>{
  const integration=require('../../tools/lib/integrations/gigacode-run'),spec={...base,idempotencyKey:'public-bootstrap'},stage=storage.stage;
  storage.stage=()=>{throw Error('PUBLIC_BOOTSTRAP');};
  try{assert.throws(()=>integration.run(tmp,'start',spec),/PUBLIC_BOOTSTRAP/);}finally{storage.stage=stage;}
  const run=integration.run(tmp,'start',spec);assert.equal(run.reused,true);assert.equal(integration.run(tmp,'next',{output:run.output}).operation,'begin');
 });
 check('bootstrap also recovers starts with an existing file input and no generated input directory',()=>{
  const {inputText,...rest}=base,spec={...rest,definitionTest:true,params:{...base.params,input:'processes/example/data/bootstrap.md'},idempotencyKey:'file-bootstrap'},stage=storage.stage;
  fs.mkdirSync(path.join(tmp,'processes/example/data'),{recursive:true});fs.writeFileSync(path.join(tmp,spec.params.input),inputText);
  storage.stage=()=>{throw Error('FILE_BOOTSTRAP');};
  try{assert.throws(()=>journal.start(tmp,spec),/FILE_BOOTSTRAP/);}finally{storage.stage=stage;}
  const run=journal.start(tmp,spec);assert.equal(run.reused,true);assert.equal(fs.existsSync(path.join(tmp,'outputs',run.output,'.run/inputs')),false);assert.equal(journal.operation(tmp,'next',{output:run.output}).operation,'begin');
 });
 check('corrupt request records never silently create another run',()=>{
  const spec={...base,idempotencyKey:'corrupt'};journal.start(tmp,spec);const count=starts(),key=require('node:crypto').createHash('sha256').update(spec.idempotencyKey).digest('hex');
  fs.writeFileSync(path.join(tmp,'.history/start-requests',key+'.json'),'broken');assert.throws(()=>journal.start(tmp,spec));assert.equal(starts(),count);
 });
 check('a previously created run is not recreated after its folder is removed',()=>{
  const spec={...base,idempotencyKey:'removed'},run=journal.start(tmp,spec),folder=path.join(tmp,'outputs',run.output);
  const begun=journal.operation(tmp,'begin',{output:run.output,step:'edit'});journal.operation(tmp,'save',{...begun.save,content:base.inputText});
  journal.execute(tmp,{output:run.output,step:'draft'});journal.operation(tmp,'finish',{output:run.output,resultName:'letter.md'});
  const replay=journal.start(tmp,spec);assert.equal(replay.reused,true);assert.equal(replay.state.status,'completed');assert.equal(replay.output,run.output);
  fs.renameSync(folder,path.join(tmp,'archived-run'));const count=starts();assert.throws(()=>journal.start(tmp,spec));assert.equal(starts(),count);
 });
 const worker=path.join(tmp,'start-worker.cjs'),specFile=path.join(tmp,'start-worker.json');
 fs.writeFileSync(worker,`const j=require(${JSON.stringify(path.join(source,'tools/lib/runtime/run-journal'))});try{console.log(JSON.stringify(j.start(process.argv[2],JSON.parse(require('node:fs').readFileSync(process.argv[3],'utf8')))));}catch(e){console.error(e.message);process.exitCode=17;}`);
 fs.writeFileSync(specFile,JSON.stringify({...base,idempotencyKey:'concurrent'}));const count=starts();
 const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[worker,tmp,specFile]);let out='',err='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);child.on('error',reject);child.on('close',status=>resolve({status,out,err}));});
 const results=await Promise.all([run(),run()]);assert.ok(results.some(r=>r.status===0),JSON.stringify(results));
 for(const result of results)if(result.status!==0)assert.match(result.err,/Журнал занят|работающим процессом/);
 assert.equal(starts(),count+1);console.log('✓ concurrent copies of one start request create at most one run');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>c.close());

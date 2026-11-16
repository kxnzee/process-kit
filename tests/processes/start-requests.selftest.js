'use strict';
const c=require('../fixture')(),{tmp,fs,path,assert,check,source}=c;
const journal=require('../../tools/lib/runtime/run-journal'),storage=require('../../tools/lib/runtime/run-storage');
const {spawn}=require('node:child_process');
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

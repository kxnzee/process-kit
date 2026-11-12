'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,write,check,validate}=ctx;
const {spawnSync}=require('node:child_process');
const journal=require('../../tools/lib/runtime/run-journal');
const state=output=>JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'.run/state.json'),'utf8'));
const start=()=>journal.start(tmp,{process:'example',mode:'local',inputText:'12 задач.',params:{to:'User',subject:'Status'}}).output;
function interrupt(file,fn){
 const rename=fs.renameSync;let injected=false;
 fs.renameSync=function(from,to){if(!injected&&to===file){injected=true;throw Object.assign(new Error('INJECTED_INTERRUPTION'),{code:'EIO'});}return rename.apply(this,arguments);};
 try{assert.throws(fn,/INJECTED_INTERRUPTION/);assert.ok(injected);}finally{fs.renameSync=rename;}
}
try{
 check('recover completes interrupted trace/state/checkpoint commits once and detects manual edits',()=>{
  for(const target of ['trace.jsonl','state.json','checkpoint.json']){
   const output=start(),dir=path.join(tmp,'outputs',output,'.run');
   interrupt(path.join(dir,target),()=>journal.operation(tmp,'begin',{output,step:'edit'}));
   assert.throws(()=>journal.operation(tmp,'next',{output}),/run recover/);
   const card=journal.operation(tmp,'recover',{output});assert.equal(card.operation,'model');
   const attempt=state(output).pending.id;
   journal.operation(tmp,'recover',{output});assert.equal(state(output).pending.id,attempt);
   const events=fs.readFileSync(path.join(dir,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
   assert.equal(events.filter(e=>e.type==='step_started').length,1);
   assert.equal(events.filter(e=>e.type==='step_started')[0].id,attempt);
   const old=fs.readFileSync(path.join(dir,'state.json'),'utf8');
   write(`outputs/${output}/.run/state.json`,old.replace('"status": "running"','"status": "completed"'));
   assert.throws(()=>journal.operation(tmp,'next',{output}),/согласованность/);
   validate(['--only','outputs'],false,'согласованность');
   write(`outputs/${output}/.run/state.json`,old);
  }
 });
 check('save recovery preserves the artifact and exactly one completion without executing again',()=>{
  const output=start(),dir=path.join(tmp,'outputs',output,'.run');
  const begun=journal.operation(tmp,'begin',{output,step:'edit'});
  interrupt(path.join(dir,'state.json'),()=>journal.operation(tmp,'save',{...begun.save,artifact:'report-text',extension:'md',content:'12 задач.',next:'draft'}));
  assert.equal(journal.operation(tmp,'recover',{output}).spec.step,'draft');
  assert.equal(state(output).last_step,1);assert.equal(state(output).pending,null);
  const rows=fs.readFileSync(path.join(dir,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.filter(e=>e.type==='step_completed'&&e.id===begun.pending.id).length,1);
  assert.equal(fs.readFileSync(path.join(dir,state(output).artifacts['report-text']),'utf8'),'12 задач.');
 });
 check('finish recovery repairs failed history projection without losing the terminal state',()=>{
  const output=start(),dir=path.join(tmp,'outputs',output,'.run');
  for(const [step,artifact,next]of [['edit','report-text','draft'],['draft','mail-draft','end']]){
   const begun=journal.operation(tmp,'begin',{output,step});
   journal.operation(tmp,'save',{...begun.save,artifact,extension:'md',content:'12 задач.',next});
  }
  const history=path.join(tmp,'.history');fs.mkdirSync(history,{recursive:true});
  const stopped=spawnSync(process.execPath,['-e',"const fs=require('node:fs'),dir=process.argv[1];fs.mkdirSync(dir);fs.writeFileSync(dir+'/owner.json',JSON.stringify({pid:process.pid,host:require('node:os').hostname()}));",path.join(history,'.lock')],{encoding:'utf8'});assert.equal(stopped.status,0,stopped.stderr);
  assert.throws(()=>journal.operation(tmp,'finish',{output,resultName:'result.md',summary:'Сохранено проверенное письмо'}));
  assert.equal(state(output).status,'completed');assert.ok(fs.existsSync(path.join(dir,'transaction.json')));
  assert.equal(journal.operation(tmp,'recover',{output}).status,'completed');
  assert.equal(journal.operation(tmp,'recover',{output}).status,'completed');
  const rows=fs.readFileSync(path.join(history,'runs.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.filter(e=>e.output===output).length,1);
  assert.match(fs.readFileSync(path.join(tmp,'outputs',output,'итог.md'),'utf8'),/Сохранено проверенное письмо/);
 });
 check('recover reclaims only a dead local owner and leaves a live or unknown lock intact',()=>{
  const output=start(),dir=path.join(tmp,'outputs',output,'.run'),lock=path.join(dir,'.journal.lock');
  const child=spawnSync(process.execPath,['-e',"const fs=require('node:fs');const lock=process.argv[1];fs.mkdirSync(lock);fs.writeFileSync(lock+'/owner.json',JSON.stringify({pid:process.pid,host:require('node:os').hostname()}));",lock],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  assert.throws(()=>journal.operation(tmp,'next',{output}),/run recover/);
  assert.equal(journal.operation(tmp,'recover',{output}).operation,'begin');
  fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,host:require('node:os').hostname()}));
  assert.throws(()=>journal.operation(tmp,'recover',{output}),/работающим/);assert.ok(fs.existsSync(lock));
  fs.unlinkSync(path.join(lock,'owner.json'));
  assert.throws(()=>journal.operation(tmp,'recover',{output}),/неизвестен/);assert.ok(fs.existsSync(lock));
  fs.rmdirSync(lock);
 });
 check('recovery can resume after the recovery owner itself exits',()=>{
  const output=start(),dir=path.join(tmp,'outputs',output,'.run');
  const owner=spawnSync(process.execPath,['-e',"const storage=require(process.argv[1]);storage.lock(process.argv[2]);",path.join(tmp,'tools/lib/runtime/run-storage.js'),dir],{encoding:'utf8'});
  assert.equal(owner.status,0,owner.stderr);
  const interrupted=spawnSync(process.execPath,['-e',"const fs=require('node:fs'),path=require('node:path'),link=fs.linkSync;fs.linkSync=function(from,to){const value=link.apply(this,arguments);if(to===path.join(process.argv[2],'.recovery.lock'))process.exit(23);return value;};require(process.argv[1]).lock(process.argv[2],true);",path.join(tmp,'tools/lib/runtime/run-storage.js'),dir],{encoding:'utf8'});
  assert.equal(interrupted.status,23,interrupted.stderr);
  assert.equal(journal.operation(tmp,'recover',{output}).operation,'begin');
  assert.ok(!fs.readdirSync(dir).some(name=>name.includes('.lock')||name.endsWith('.candidate')));
 });
 check('release permits an open owner reader and a fresh claim without changing the reader snapshot',()=>{
  const storage=require('../../tools/lib/runtime/run-storage'),dir=path.join(tmp,'open-lock-reader');fs.mkdirSync(dir);
  const file=path.join(dir,'.journal.lock'),release=storage.lock(dir),entry=fs.statSync(file);
  const reader=fs.openSync(entry.isDirectory()?path.join(file,'owner.json'):file,'r');
  const before=JSON.parse(fs.readFileSync(reader,'utf8'));
  try{
   release();assert.equal(fs.existsSync(file),false);
   const releaseNext=storage.lock(dir),next=JSON.parse(fs.readFileSync(file,'utf8'));
   try{
    assert.notEqual(next.id,before.id);
    const bytes=Buffer.alloc(4096),length=fs.readSync(reader,bytes,0,bytes.length,0);
    assert.equal(JSON.parse(bytes.subarray(0,length).toString()).id,before.id);
    assert.throws(release,/Изменился владелец/);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).id,next.id);
   }finally{releaseNext();}
  }finally{fs.closeSync(reader);}
  assert.deepEqual(fs.readdirSync(dir),[]);
 });
 check('file locks preserve live, malformed and foreign-host owners rather than reclaiming them',()=>{
  const storage=require('../../tools/lib/runtime/run-storage'),dir=path.join(tmp,'file-lock-owners');fs.mkdirSync(dir);
  const file=path.join(dir,'.journal.lock');
  for(const [bytes,message]of [[JSON.stringify({pid:process.pid,host:require('node:os').hostname(),id:'live'}),/работающим/],['{',/неизвестен/],[JSON.stringify({pid:process.pid,host:'other-host',id:'foreign'}),/Нельзя проверить/]]){
   fs.writeFileSync(file,bytes);assert.throws(()=>storage.lock(dir,true),message);assert.equal(fs.readFileSync(file,'utf8'),bytes);fs.unlinkSync(file);
  }
  assert.deepEqual(fs.readdirSync(dir),[]);
 });
 check('recovery preserves an unrelated candidate and unsupported hard links fail closed',()=>{
  const storage=require('../../tools/lib/runtime/run-storage'),dir=path.join(tmp,'candidate-identity');fs.mkdirSync(dir);
  const moduleFile=path.join(tmp,'tools/lib/runtime/run-storage.js'),file=path.join(dir,'.journal.lock');
  const dead=spawnSync(process.execPath,['-e',"require(process.argv[1]).lock(process.argv[2]);",moduleFile,dir],{encoding:'utf8'});assert.equal(dead.status,0,dead.stderr);
  const owner=JSON.parse(fs.readFileSync(file,'utf8')),candidate=path.join(dir,`.journal.lock.${owner.pid}.${owner.id}.candidate`);
  // Replace the retained anchor with a genuinely unrelated inode.
  fs.unlinkSync(candidate);fs.writeFileSync(candidate,'unrelated');const release=storage.lock(dir,true);release();assert.equal(fs.readFileSync(candidate,'utf8'),'unrelated');fs.unlinkSync(candidate);
  const original=fs.linkSync;
  try{fs.linkSync=()=>{throw Object.assign(new Error('NO_HARD_LINKS'),{code:'ENOTSUP'});};assert.throws(()=>storage.lock(dir),/NO_HARD_LINKS/);}
  finally{fs.linkSync=original;}
  assert.deepEqual(fs.readdirSync(dir),[]);
 });
 check('concurrent recovery distinguishes active writers from unknown owners and serializes updates',()=>{
  // Every round must pass: repeated contention is stress coverage, never a retry of failure.
  for(let round=0;round<5;round++){
   const dir=path.join(tmp,'lock-contention-'+round),moduleFile=path.join(tmp,'tools/lib/runtime/run-storage.js');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'count.json'),'0');
   const abandoned=spawnSync(process.execPath,['-e',"require(process.argv[1]).lock(process.argv[2]);",moduleFile,dir],{encoding:'utf8'});assert.equal(abandoned.status,0,abandoned.stderr);
   const worker="const fs=require('node:fs'),path=require('node:path'),storage=require(process.argv[1]),dir=process.argv[2];let completed=0;for(let i=0;i<40;i++){let release;try{release=storage.lock(dir,true);}catch(error){if(error.message==='Журнал занят работающим процессом')continue;throw error;}try{const critical=path.join(dir,'critical'),counter=path.join(dir,'count.json');fs.closeSync(fs.openSync(critical,'wx'));const count=JSON.parse(fs.readFileSync(counter,'utf8'));fs.writeFileSync(counter,JSON.stringify(count+1));fs.unlinkSync(critical);completed++;}finally{release();}}process.stdout.write(String(completed));";
   const coordinator="const {spawn}=require('node:child_process');Promise.all(Array.from({length:4},()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',process.argv[1],process.argv[2],process.argv[3]]);let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('error',reject);child.on('close',code=>code===0?resolve(Number(out)):reject(new Error(err)));}))).then(counts=>process.stdout.write(JSON.stringify(counts))).catch(error=>{console.error(error);process.exitCode=1;});";
   const result=spawnSync(process.execPath,['-e',coordinator,worker,moduleFile,dir],{encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr);
   const counts=JSON.parse(result.stdout),total=JSON.parse(fs.readFileSync(path.join(dir,'count.json'),'utf8'));
   assert.ok(total>0);assert.equal(total,counts.reduce((sum,n)=>sum+n,0));
   assert.deepEqual(fs.readdirSync(dir),['count.json']);
  }
 });

}finally{ctx.close();}

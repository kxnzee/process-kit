'use strict';
const ctx=require('../fixture')({prefix:'rk windows настройки '}),{tmp,fs,path,assert,write,check}=ctx;
const {execFileSync,spawnSync}=require('node:child_process');
const facts=require('../../tools/lib/entities/process-facts'),settings=require('../../tools/lib/config/process-settings');
const migration=require('../../tools/lib/config/migrate-process-settings');
const git=(...args)=>execFileSync('git',args,{cwd:tmp,stdio:'pipe'});
const privateFile='processes/example/config/my.json',body='{"subject":"PRIVATE_WINDOWS_SETTING"}';
const aliases=[
 'processes/example/config/MY.JSON','processes/example/CONFIG/my.json','PROCESSES/example/config/my.json',
 'processes/example/config/my.json.','processes/example/config/my.json ','processes/example/config./my.json',
 'processes/example/config/my.json::$DATA','processes\\example\\config\\my.json',
 'processes/example/config/NUL.json','processes/example/config/COM¹.json',
];
try{
 git('init','-b','master');git('-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','fixture');
 write(privateFile,body);
 check('portable resource paths reject Windows aliases before ownership checks or reads',()=>{
  assert.equal(facts.canonicalFile(privateFile),true);
  for(const file of aliases){
   assert.equal(facts.canonicalFile(file),false,file);
   assert.equal(facts.visibleFile(file,'example',{personal:false,teamId:null}),false,file);
   assert.throws(()=>facts.assertAccess(tmp,'example',{},[file]),undefined,file);
   assert.throws(()=>facts.assertAccess(tmp,'example',{styleFile:file}),undefined,file);
  }
  assert.throws(()=>facts.assertAccess(tmp,'example',{},[privateFile]),/владения/);
  for(const file of ['processes/example/PROCESS.md','context/master/writing-style/CONTEXT.md','processes/example/templates/Отчёт.md'])assert.equal(facts.canonicalFile(file),true,file);
 });
 check('native case aliases cannot expose settings from a shared working copy',()=>{
  const alias=path.join(tmp,aliases[0]);
  if(process.platform==='win32')assert.ok(fs.existsSync(alias),'Native Windows must exercise case-insensitive file resolution');
  if(fs.existsSync(alias))assert.equal(fs.readFileSync(alias,'utf8'),body);
  const spec='start-alias.json';write(spec,JSON.stringify({process:'example',mode:'local',inputText:'Test',files:[aliases[0]]}));
  const result=spawnSync(process.execPath,['tools/kit.js','run','start',spec],{cwd:tmp,encoding:'utf8'});
  assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stderr,/канонических/);assert.ok(!result.stdout.includes('PRIVATE_WINDOWS_SETTING'));
  assert.ok(!fs.existsSync(path.join(tmp,'outputs')));
 });
 check('settings aliases retain ownership in publication and promotion classification',()=>{
  for(const [file,level]of [['processes/example/config/MY.JSON','my'],['processes/example/CONFIG/TEAM.json','team']])assert.equal(settings.levelOf(file),level);
  const receipt={schemaVersion:1,process:'example',status:'validated',files:{'processes/example/PROCESS.md':'0'.repeat(64),[aliases[0]]:'0'.repeat(64)}};
  assert.equal(require('../../tools/lib/entities/process-release').validReceipt(receipt),false);
 });
 check('promotion branches and explicit levels reject staged personal settings',()=>{
  git('add','-f',privateFile);
  for(const branch of ['promote/master/audit','promote/team-a/audit','my']){
   git('switch','-c',branch);
   const args=['tools/kit.js','check','--only','layout','--json',...(branch==='my'?['--level','master']:[])];
   const result=spawnSync(process.execPath,args,{cwd:tmp,encoding:'utf8'});
   assert.equal(result.status,1,result.stderr);assert.ok(JSON.parse(result.stdout).issues.some(row=>row.file===privateFile),result.stdout);
  }
  git('reset','--',privateFile);fs.unlinkSync(path.join(tmp,privateFile));
 });
 check('legacy extension case migrates and rolls back without evading active Run protection',()=>{
  write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:null,profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'}}));
  const original='config/my/processes/example.JSON',canonical='config/my/processes/example.json';write(original,body);
  if(!fs.existsSync(path.join(tmp,canonical))){assert.equal(migration.plan(tmp).ready,false);return;}
  assert.equal(settings.read(tmp,'my','example',['subject']).subject,'PRIVATE_WINDOWS_SETTING');
  const run='outputs/2026-11-23_проверка/.run/state.json';
  write(run,JSON.stringify({status:'running',identity:{files:{[canonical]:'0'.repeat(64)}}}));
  assert.equal(migration.plan(tmp).ready,false);assert.equal(migration.migrate(tmp,{apply:true}).applied,false);
  fs.rmSync(path.join(tmp,'outputs'),{recursive:true});
  const moved=migration.migrate(tmp,{apply:true});assert.equal(moved.applied,true);assert.equal(moved.entries[0].source,original);
  assert.equal(fs.readFileSync(path.join(tmp,privateFile),'utf8'),body);assert.ok(!fs.existsSync(path.join(tmp,original)));
  migration.rollback(tmp,moved.journal);assert.equal(fs.readFileSync(path.join(tmp,original),'utf8'),body);assert.ok(!fs.existsSync(path.join(tmp,privateFile)));
 });
}finally{ctx.close();}

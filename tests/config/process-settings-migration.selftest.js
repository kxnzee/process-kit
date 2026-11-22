'use strict';
const ctx=require('../fixture')(),{tmp,fs,path,assert,write,check}=ctx;
const {execFileSync,spawnSync}=require('node:child_process');
const settings=require('../../tools/lib/config/process-settings'),migration=require('../../tools/lib/config/migrate-process-settings');
const git=(...args)=>execFileSync('git',args,{cwd:tmp,stdio:'pipe'});
const old='config/my/processes/example.json',now='processes/example/config/my.json';
const bytes=Buffer.from('{\n  "subject": "Тема — UTF-8"\n}\n');
const exists=rel=>fs.existsSync(path.join(tmp,rel));
const call=args=>spawnSync(process.execPath,['tools/kit.js','config',...args],{cwd:tmp,encoding:'utf8'});
try{
 git('init','-b','my');git('-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','fixture');
 write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:null,profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'}}));
 write(old,bytes);
 check('dry run is read-only and legacy settings remain readable with explicit origin',()=>{
  const result=migration.migrate(tmp);assert.equal(result.ready,true);assert.equal(result.applied,false);assert.equal(result.entries[0].target,now);assert.ok(exists(old));assert.ok(!exists(now));assert.ok(!exists('.history'));
  const merged=settings.merge(tmp,'example',['subject'],['my']);assert.equal(merged.origins.subject,old);
 });
 let id;
 check('public migration preserves bytes and has a verifiable rollback journal',()=>{
  const result=call(['--migrate-process-settings','--apply']);assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);id=data.journal;
  assert.equal(data.applied,true);assert.ok(!exists(old));assert.deepEqual(fs.readFileSync(path.join(tmp,now)),bytes);
  assert.equal(settings.merge(tmp,'example',['subject'],['my']).origins.subject,now);
  assert.equal(migration.plan(tmp).entries.length,0);
  const restored=call(['--rollback-process-settings',id]);assert.equal(restored.status,0,restored.stderr);assert.deepEqual(fs.readFileSync(path.join(tmp,old)),bytes);assert.ok(!exists(now));
 });
 check('a repeated old rollback cannot undo a later migration',()=>{
  const first=migration.migrate(tmp,{apply:true});migration.rollback(tmp,first.journal);
  const second=migration.migrate(tmp,{apply:true});migration.rollback(tmp,first.journal);assert.ok(exists(now));assert.ok(!exists(old));migration.rollback(tmp,second.journal);
 });
 check('parallel apply and rollback cannot mutate the same migration',()=>{
  const dir=path.join(tmp,'.history/process-settings-migrations'),release=require('../../tools/lib/runtime/run-storage').lock(dir,false,'.migration.lock');
  try{assert.throws(()=>migration.migrate(tmp,{apply:true}),/занят/);assert.throws(()=>migration.rollback(tmp,id),/занят/);assert.ok(exists(old));assert.ok(!exists(now));}finally{release();}
 });
 check('both formats at one level fail without silently choosing or overwriting either',()=>{
  write(now,'{"subject":"new"}');assert.throws(()=>settings.merge(tmp,'example',['subject'],['my']),/Два файла/);assert.equal(migration.plan(tmp).ready,false);assert.equal(migration.migrate(tmp,{apply:true}).applied,false);assert.deepEqual(fs.readFileSync(path.join(tmp,old)),bytes);fs.unlinkSync(path.join(tmp,now));
 });
 check('an active or damaged run prevents moving its settings',()=>{
  const run='outputs/2026-11-22_миграция/.run/state.json';
  for(const body of [JSON.stringify({status:'running',identity:{files:{[old]:'hash'}}}),JSON.stringify({status:'running',identity:{files:[]}}),JSON.stringify({status:'completed'}),'broken']){
   write(run,body);assert.equal(migration.plan(tmp).ready,false);assert.equal(migration.migrate(tmp,{apply:true}).applied,false);assert.ok(exists(old));assert.ok(!exists(now));
  }
  fs.rmSync(path.join(tmp,'outputs'),{recursive:true,force:true});
 });
 check('rollback refuses changed values and foreign ownership without destroying data',()=>{
  id=migration.migrate(tmp,{apply:true}).journal;write(now,'{"subject":"changed"}');assert.throws(()=>migration.rollback(tmp,id),/изменены/);assert.equal(fs.readFileSync(path.join(tmp,now),'utf8'),'{"subject":"changed"}');
  write(now,bytes);git('branch','master');git('switch','master');assert.throws(()=>migration.rollback(tmp,id),/Чужой/);assert.ok(exists(now));git('switch','my');migration.rollback(tmp,id);
 });
 check('rollback is bound to the original team even for a shared process',()=>{
  git('switch','-c','team-a');
  fs.unlinkSync(path.join(tmp,'config/my/config.json'));
  write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'A',owners:[]}}));
  const oldTeam='config/team/processes/example.json',newTeam='processes/example/config/team.json';write(oldTeam,bytes);
  const migrated=migration.migrate(tmp,{apply:true});assert.equal(migrated.applied,true);
  git('switch','-c','team-b');write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'b',name:'B',owners:[]}}));
  assert.throws(()=>migration.rollback(tmp,migrated.journal),/Чужой/);assert.ok(exists(newTeam));
  git('switch','team-a');write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'A',owners:[]}}));migration.rollback(tmp,migrated.journal);
  fs.rmSync(path.join(tmp,'config/team'),{recursive:true});git('switch','my');
  write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:null,profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'}}));
 });
 check('orphan, undeclared and secret settings cannot be migrated',()=>{
  for(const [file,body]of [['config/my/processes/absent.json','{}'],[old,'{"notDeclared":1}'],[old,'{"subject":[{"token":"PRIVATE"}]}']]){
   write(file,body);const result=migration.migrate(tmp,{apply:true});assert.equal(result.ready,false);assert.equal(result.applied,false);assert.ok(!exists(now));if(file!==old)fs.unlinkSync(path.join(tmp,file));write(old,bytes);
  }
 });
 check('owner-local settings are pinned to a Run, but do not enter definition publication',()=>{
  write('processes/settings-test/PROCESS.md',fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8').replace('name: example','name: settings-test').replace('config: []','config: [my]'));
  const file='processes/settings-test/config/my.json';write(file,'{"subject":"first"}');
  const release=require('../../tools/lib/entities/process-release'),journal=require('../../tools/lib/runtime/run-journal');
  release.lifecycle(tmp,'validate',{process:'settings-test',params:{to:'Test'}});
  const receipt=JSON.parse(fs.readFileSync(path.join(tmp,'processes/settings-test/publication.json')));assert.ok(!Object.hasOwn(receipt.files,file));
  const started=journal.start(tmp,{process:'settings-test',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test'}});
  assert.equal(started.state.params.subject,'first');assert.ok(Object.hasOwn(started.state.identity.files,file));
  write(file,'{"subject":"second"}');assert.equal(release.current(tmp,receipt,'settings-test'),true);assert.throws(()=>journal.operation(tmp,'next',{output:started.output}),/Изменён вход/);
 });
 check('new placement preserves layered priority and excludes an unselected team',()=>{
  write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'A',owners:[]}}));
  write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:'a',profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'}}));
  write('processes/example/config/master.json','{"subject":"base"}');write('processes/example/config/team.json','{"subject":"team"}');
  assert.equal(settings.merge(tmp,'example',['subject'],['master']).params.subject,'base');
  assert.equal(settings.merge(tmp,'example',['subject'],['master','team']).params.subject,'team');
  assert.equal(settings.merge(tmp,'example',['subject'],['master','team','my']).params.subject,JSON.parse(bytes).subject);
  const migrated=migration.migrate(tmp,{apply:true});assert.equal(migrated.applied,true);
  assert.equal(settings.merge(tmp,'example',['subject'],['master','team','my']).params.subject,JSON.parse(bytes).subject);
  migration.rollback(tmp,migrated.journal);
  write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:null,profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'}}));
  assert.ok(!settings.merge(tmp,'example',['subject'],['master','team','my']).files.includes('processes/example/config/team.json'));
 });
 check('rollback recovers a partially copied migration without losing bytes',()=>{
  const moved=migration.migrate(tmp,{apply:true});write(old,bytes);
  const journalFile=path.join(tmp,'.history/process-settings-migrations',moved.journal+'.json'),record=JSON.parse(fs.readFileSync(journalFile));record.status='incomplete';fs.writeFileSync(journalFile,JSON.stringify(record));
  migration.rollback(tmp,moved.journal);assert.deepEqual(fs.readFileSync(path.join(tmp,old)),bytes);assert.ok(!exists(now));
 });
 check('layout and scope prevent promoting or reading personal settings in shared contexts',()=>{
  const facts=require('../../tools/lib/entities/process-facts');
  assert.equal(facts.visibleFile(now,'example',{personal:false,teamId:'a'}),false);
  assert.equal(facts.visibleFile(now,'example',{personal:true,teamId:null}),true);
  assert.equal(facts.visibleFile('processes/example/config/team.json','example',{personal:false,teamId:null}),false);
  write(now,bytes);git('add','-f',now);git('switch','master');
  const result=spawnSync(process.execPath,['tools/kit.js','check','--only','layout','--root',tmp,'--json'],{cwd:tmp,encoding:'utf8'});assert.equal(result.status,1,result.stderr);assert.ok(JSON.parse(result.stdout).issues.some(row=>row.file===now));
  git('switch','my');git('reset','--',now);fs.unlinkSync(path.join(tmp,now));
 });
 check('new settings layout rejects unknown levels and missing owners',()=>{
  write('processes/example/config/private.json','{}');write('processes/orphan/config/my.json','{}');
  const result=spawnSync(process.execPath,['tools/kit.js','check','--only','processFiles','--root',tmp,'--json'],{cwd:tmp,encoding:'utf8'});assert.equal(result.status,1,result.stderr);const issues=JSON.parse(result.stdout).issues;
  for(const file of ['processes/example/config/private.json','processes/orphan/config/my.json'])assert.ok(issues.some(row=>row.file===file));
 });
}finally{ctx.close();}

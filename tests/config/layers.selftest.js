'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,source,write,check}=ctx;
const {loadConfig,selectedStore}=require('../../tools/lib/config/config'),support=require('../../tools/lib/actions/action-support');
const {dependencies}=require('../../tools/lib/entities/process-dependencies'),journal=require('../fixture').runtimeJournal();
const team={schemaVersion:2,team:{id:'a',name:'Team A',owners:['Owner']},taskStores:[{id:'team-tasks',adapter:'adapters/jira/ADAPTER.md',mcpServer:'test',enabled:true,baseUrl:'https://example.invalid',projects:['A'],modules:[]}],codeStores:[],defaults:{taskStore:'team-tasks',project:'A'}};
const my={schemaVersion:2,teamId:'a',profile:{name:'Fixture User',email:'fixture@example.invalid'},storage:{mode:'local'},taskStores:[{id:'my-tasks',adapter:'adapters/jira/ADAPTER.md',mcpServer:'test',enabled:true,baseUrl:'https://personal.invalid',projects:['P']}],defaults:{taskStore:'my-tasks',project:'P'},preferences:{language:'ru'}};
const save=()=>{write('config/team/config.json',JSON.stringify(team));write('config/my/config.json',JSON.stringify(my));};
try{
 check('personal selection overrides team defaults, explicit arguments override personal selection',()=>{
  save();const config=loadConfig(tmp);
  assert.equal(config.defaults.taskStore,'my-tasks');assert.equal(config.preferences.language,'ru');
  assert.equal(selectedStore(config,'taskStore').baseUrl,'https://personal.invalid');
  assert.equal(selectedStore(config,'taskStore','team-tasks').baseUrl,'https://example.invalid');
  const params={queryFile:'processes/sdd-stories-report/queries/stories.md',parameters:{}};
  const result=support.source({cwd:tmp,params,mode:'live',actionName:'run-query',processName:'sdd-stories-report'},'taskStore');
  assert.equal(result.taskStore,'my-tasks');assert.equal(result.parameters.project,'P');
  delete my.defaults.project;save();assert.equal(loadConfig(tmp).defaults.project,undefined);my.defaults.project='P';save();
  const explicit=support.source({cwd:tmp,params:{...params,taskStore:'team-tasks',parameters:{project:'A'}},mode:'live',actionName:'run-query',processName:'sdd-stories-report'},'taskStore');
  assert.equal(explicit.parameters.project,'A');
 });
 check('personal chat address is optional, validated and independent of Git identity',()=>{
  const before={...my.preferences};
  try{
   for(const addressAs of ['Алексей Викторович',null]){
    my.preferences={...before,addressAs};save();const config=loadConfig(tmp);
    assert.equal(config.preferences.addressAs,addressAs);assert.equal(config.profile.name,my.profile.name);
    assert.equal(config.preferences.language,'ru');
    assert.deepEqual(loadConfig(tmp,['master','team']).preferences,{});
   }
   for(const addressAs of ['', ' ',false,42,[],{}]){
    my.preferences={...before,addressAs};save();assert.throws(()=>loadConfig(tmp),/preferences.addressAs/);
   }
  }finally{my.preferences=before;save();}
  assert.equal(loadConfig(tmp).preferences.addressAs,undefined);
 });
 check('chat style preferences validate supported choices while preserving legacy preferences',()=>{
  const before={...my.preferences};
  try{
   for(const addressMode of ['formal','informal'])for(const responseDetail of ['auto','brief','detailed']){
    my.preferences={...before,addressMode,responseDetail};save();
    assert.deepEqual(loadConfig(tmp).preferences,my.preferences);
    assert.equal(loadConfig(tmp).profile.name,my.profile.name);
   }
   for(const [field,values]of [['addressMode',['ты','unknown',false,null,{}]],['responseDetail',['short','unknown',3,null,[]]]]){
    for(const value of values){my.preferences={...before,[field]:value};save();assert.throws(()=>loadConfig(tmp),new RegExp('preferences.'+field));}
   }
  }finally{my.preferences=before;save();}
  assert.deepEqual(loadConfig(tmp).preferences,before);
 });
 check('personal layers cannot overwrite team entries or select another inherited team',()=>{
  my.taskStores[0].id='team-tasks';save();assert.throws(()=>loadConfig(tmp),/повтор id/);my.taskStores[0].id='my-tasks';
  my.teamId='other';save();assert.throws(()=>loadConfig(tmp),/не совпадает/);my.teamId='a';
  my.defaults.project='not-in-catalog';save();assert.throws(()=>support.source({cwd:tmp,params:{queryFile:'processes/sdd-stories-report/queries/stories.md',parameters:{}},mode:'live',actionName:'run-query',processName:'sdd-stories-report'},'taskStore'),/ресурс не входит/);my.defaults.project='P';save();
 });
 check('no-team mode excludes inherited resources and unsupported schema versions are rejected',()=>{
  my.teamId=null;save();const config=loadConfig(tmp);assert.equal(config.team,null);assert.deepEqual(config.taskStores.map(row=>row.id),['my-tasks']);assert.ok(!config.files.includes('config/team/config.json'));
  my.schemaVersion=1;save();assert.throws(()=>loadConfig(tmp),/schemaVersion 2/);my.schemaVersion=2;my.teamId='a';save();
 });
 check('explicit selection wins over step literals in preflight, snapshot and nested execution',()=>{
  const {spawnSync}=require('node:child_process');
  my.teamId='a';my.defaults={};team.taskStores[0].enabled=false;save();
  write('processes/my-priority/queries/tasks.md','# Tasks\nRead the passed keys.\n');
  write('processes/my-priority/PROCESS.md','---\nname: my-priority\nversion: 1.0.0\narea: test\nstatus: действует\npublication: required\ndescription: Priority test\nexample: test\nrequires:\n  actions: [run-query]\n  config: [master, team, my]\nentry: read\n---\n## Шаги\n### read\n- действие: run-query\n- параметры:\n  - `taskStore: team-tasks`\n  - `queryFile: processes/my-priority/queries/tasks.md`\n  - `parameters: {}`\n- артефакт: task-records\n- следующий: end\n');
  write('processes/my-parent/PROCESS.md','---\nname: my-parent\nversion: 1.0.0\narea: test\nstatus: действует\npublication: required\ndescription: Parent priority test\nexample: test\nentry: call\n---\n## Шаги\n### call\n- процесс: my-priority\n- параметры: `taskStore: team-tasks`\n- следующий: end\n');
  write('override.json','{"taskStore":"my-tasks"}');
  for(const name of ['my-priority','my-parent']){
   const preflight=spawnSync(process.execPath,[path.join(source,'tools/lib/validation/validate.js'),'--root',tmp,'--process',name,'--params',path.join(tmp,'override.json'),'--json'],{encoding:'utf8'});
   assert.equal(preflight.status,0,preflight.stdout+preflight.stderr);
   const files=dependencies(tmp,name,{taskStore:'my-tasks'},'live');assert.ok(files.includes('adapters/jira/ADAPTER.md'));
   const spec={process:name,mode:'live',date:'2026-11-04',...(name==='my-parent'?{explicitParams:{taskStore:'my-tasks'}}:{params:{taskStore:'my-tasks'}})};
   const resolution=require('../../tools/lib/config/config').resolveProcess(tmp,name,{taskStore:'my-tasks'});
   assert.equal(resolution.ready,true);assert.equal(resolution.connections[0].id,'my-tasks');
   assert.equal(resolution.connections[0].configFile,'config/my/config.json');
   const run=journal.start(tmp,spec);
   assert.deepEqual(run.connections,resolution);
   assert.ok(run.readFiles.includes(`processes/${name}/PROCESS.md`));
   assert.ok(!run.readFiles.includes('tools/lib/core/safe-path.js'));
   if(name==='my-parent')journal.operation(tmp,'enter',{output:run.output,step:'call'});
   journal.operation(tmp,'begin',{output:run.output,step:'read'});
   const state=JSON.parse(fs.readFileSync(path.join(tmp,'outputs',run.output,'.run/state.json')));
   assert.equal(state.pending.params.taskStore,'my-tasks');
  }
  assert.equal(require('../../tools/lib/entities/entities').manifest(tmp,'my-priority',{taskStore:'my-tasks'},'live',{}).ready,false);
  team.taskStores[0].enabled=true;save();
 });
 check('only declared config levels participate in connection selection',()=>{
  const {resolveProcess}=require('../../tools/lib/config/config');
  const file=path.join(tmp,'processes/my-priority/PROCESS.md'),original=fs.readFileSync(file,'utf8');
  try{
   fs.writeFileSync(file,original.replace('config: [master, team, my]','config: [master, team]'));
   assert.equal(resolveProcess(tmp,'my-priority',{taskStore:'my-tasks'}).ready,false);
   const result=resolveProcess(tmp,'my-priority',{taskStore:'team-tasks'});assert.equal(result.ready,true);assert.equal(result.connections[0].configFile,'config/team/config.json');
  }finally{fs.writeFileSync(file,original);}
 });
 check('personal-only initialization materializes the TODO example without fictional connections',()=>{
  const sample=JSON.parse(fs.readFileSync(path.join(source,'config/my/EXAMPLE.json'),'utf8'));
  assert.match(sample.profile.name,/TODO/);assert.match(sample.storage.mode,/TODO/);assert.ok(sample.taskStores.length&&sample.codeStores.length);
  const ready={...sample,teamId:null,profile:{name:'Fixture User',email:'fixture@example.invalid'},storage:{mode:'local'},taskStores:[],codeStores:[],defaults:{}};
  write('config/my/config.json',JSON.stringify(ready));
  const resolved=loadConfig(tmp);assert.equal(resolved.profile.name,'Fixture User');assert.equal(resolved.storage.mode,'local');assert.deepEqual(resolved.taskStores,[]);assert.equal(resolved.team,null);
  write('config/my/config.json',JSON.stringify({...ready,storage:{mode:'repository'}}));assert.throws(()=>loadConfig(tmp),/repositoryUrl/);
  save();
 });
 check('live snapshots capture both active config layers and reject changes',()=>{
  my.defaults={};save();
  write('processes/my-select/queries/tasks.md','# Read tasks\n');
  write('processes/my-select/PROCESS.md','---\nname: my-select\nrequires:\n  config: [master, team, my]\nversion: 1.0.0\narea: тест\nstatus: действует\npublication: required\ndescription: Проверочный процесс\nexample: test\nentry: read\n---\n## Шаги\n### read\n- действие: run-query\n- параметры:\n  - `queryFile: processes/my-select/queries/tasks.md`\n  - `parameters: {}`\n- артефакт: task-records\n- следующий: end\n');
  const files=dependencies(tmp,'my-select',{},'live');for(const file of ['config/master/config.json','config/team/config.json','config/my/config.json'])assert.ok(files.includes(file),file);
  const resolved=require('../../tools/lib/config/config').resolveProcess(tmp,'my-select');
  assert.equal(resolved.ready,true);assert.equal(resolved.connections[0].adapterFile,'adapters/jira/ADAPTER.md');
  assert.equal(resolved.connections[0].configFile,'config/team/config.json');
  assert.equal(require('../../tools/lib/config/config').resolveProcess(tmp,'my-select',{taskStore:'missing'}).ready,false);
  const {spawnSync}=require('node:child_process');
  write('missing-selection.json','{"taskStore":"missing"}');
  const cli=spawnSync(process.execPath,[path.join(source,'tools/lib/config/config.js'),'--process','my-select','--params','missing-selection.json'],{cwd:tmp,encoding:'utf8'});
  assert.equal(cli.status,1);assert.match(JSON.parse(cli.stdout).missing[0].reason,/missing/);
  const adapter='adapters/jira/ADAPTER.md',text=fs.readFileSync(path.join(tmp,adapter),'utf8');
  fs.unlinkSync(path.join(tmp,adapter));
  assert.match(require('../../tools/lib/config/config').resolveProcess(tmp,'my-select').missing[0].reason,/нет подключения/);
  write(adapter,text);

  const run=journal.start(tmp,{process:'my-select',mode:'live',date:'2026-11-04'});
  my.preferences.language='en';save();assert.throws(()=>journal.operation(tmp,'begin',{output:run.output,step:'read'}),/Изменён вход/);
 });
 check('process settings file of the nearest level fills declared params and is pinned in the snapshot',()=>{
  const {resolveProcess}=require('../../tools/lib/config/config'),{spawnSync}=require('node:child_process');
  const rules=(...args)=>spawnSync(process.execPath,[path.join(source,'tools/lib/validation/validate.js'),'--root',tmp,'--only','processFiles','--json',...args],{encoding:'utf8'});
  my.defaults={};save();
  write('processes/my-perimeter/queries/tasks.md','# Read tasks\n');
  write('processes/my-perimeter/PROCESS.md','---\nname: my-perimeter\nversion: 1.0.0\narea: тест\nstatus: действует\npublication: required\ndescription: Process settings test\nexample: test\nrequires:\n  config: [master, team, my]\nparams:\n  taskStore: ""\nentry: read\n---\n## Шаги\n### read\n- действие: run-query\n- параметры:\n  - `taskStore: {params.taskStore}`\n  - `queryFile: processes/my-perimeter/queries/tasks.md`\n  - `parameters: {}`\n- артефакт: task-records\n- следующий: end\n');
  assert.equal(resolveProcess(tmp,'my-perimeter').ready,false);
  write('config/team/processes/my-perimeter.json',JSON.stringify({taskStore:'team-tasks'}));
  let resolved=resolveProcess(tmp,'my-perimeter');
  assert.equal(resolved.ready,true,JSON.stringify(resolved.missing));
  assert.equal(resolved.connections[0].id,'team-tasks');
  assert.equal(resolved.paramOrigins['my-perimeter:taskStore'],'config/team/processes/my-perimeter.json');
  write('config/my/processes/my-perimeter.json',JSON.stringify({taskStore:'my-tasks'}));
  resolved=resolveProcess(tmp,'my-perimeter');
  assert.equal(resolved.connections[0].id,'my-tasks');
  assert.equal(resolved.paramOrigins['my-perimeter:taskStore'],'config/my/processes/my-perimeter.json');
  assert.equal(resolveProcess(tmp,'my-perimeter',{taskStore:'team-tasks'}).connections[0].id,'team-tasks');
  assert.ok(dependencies(tmp,'my-perimeter',{},'live').includes('config/my/processes/my-perimeter.json'));
  const run=journal.start(tmp,{process:'my-perimeter',mode:'live',date:'2026-11-16'});
  const state=JSON.parse(fs.readFileSync(path.join(tmp,'outputs',run.output,'.run/state.json')));
  assert.equal(state.params.taskStore,'my-tasks');
  assert.ok(Object.keys(state.identity.files).includes('config/my/processes/my-perimeter.json'));
  fs.writeFileSync(path.join(tmp,'config/my/processes/my-perimeter.json'),JSON.stringify({taskStore:'team-tasks'}));
  assert.throws(()=>journal.operation(tmp,'begin',{output:run.output,step:'read'}),/Изменён вход/);
  fs.writeFileSync(path.join(tmp,'config/my/processes/my-perimeter.json'),JSON.stringify({taskStore:'my-tasks'}));
  write('config/my/processes/my-perimeter.json',JSON.stringify({taskStr:'my-tasks'}));
  assert.throws(()=>resolveProcess(tmp,'my-perimeter'),/не объявлен в params процесса/);
  write('config/my/processes/my-perimeter.json',JSON.stringify({taskStore:'my-tasks'}));
  assert.equal(rules().status,0,rules().stdout);
  write('config/my/processes/no-such-process.json','{}');
  const orphan=rules();assert.notEqual(orphan.status,0);assert.match(orphan.stdout,/настройки процесса no-such-process, а процесса нет/);
  fs.unlinkSync(path.join(tmp,'config/my/processes/no-such-process.json'));
 });
}finally{ctx.close();}

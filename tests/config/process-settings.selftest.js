'use strict';
const ctx=require('../fixture')(),{tmp,write,fs,path,assert,check}=ctx;
const settings=require('../../tools/lib/config/process-settings');
const {processModel}=require('../../tools/lib/entities/process-model');
const {processSettings}=require('../../tools/lib/entities/process-dependencies');
try{
 const declared=['subject'];
 write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'A',owners:[]}}));
 write('config/team/processes/example.json','{"subject":"team"}');
 write('config/my/processes/example.json','{"subject":"personal"}');
 check('empty requires.config reads no settings or personal configuration',()=>{
  write('config/my/config.json','not JSON');
  const model=processModel(fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8'));
  assert.deepEqual(processSettings(tmp,'example',model),{params:{},origins:{},files:[]});
 });
 check('excluded personal config cannot disable team settings or become a dependency',()=>{
  for(const body of ['not JSON','{"teamId":null}']){
   write('config/my/config.json',body);
   const result=settings.merge(tmp,'example',declared,['master','team']);
   assert.equal(result.params.subject,'team');
   assert.ok(!result.files.some(file=>file.startsWith('config/my/')));
  }
 });
 check('declared personal scope uses canonical team exclusion and validates its config',()=>{
  write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:null,profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'}}));
  const result=settings.merge(tmp,'example',declared,['master','team','my']);
  assert.equal(result.params.subject,'personal');
  assert.ok(result.files.includes('config/my/config.json'));
  assert.ok(!result.files.some(file=>file.startsWith('config/team/')));
  write('config/my/config.json','not JSON');
  assert.throws(()=>settings.merge(tmp,'example',declared,['master','team','my']));
 });
 check('secrets in arrays are rejected at every nesting depth',()=>{
  for(const subject of [[{token:'SYNTHETIC'}],{items:[[{authorization:'SYNTHETIC'}]]}]){
   write('config/master/processes/example.json',JSON.stringify({subject}));
   assert.throws(()=>settings.merge(tmp,'example',declared,['master']),/секреты не являются параметрами/);
  }
 });
 check('local runs pin the canonical configuration that selected process settings',()=>{
  write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:'a',profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'}}));
  write('processes/settings-snapshot/PROCESS.md',fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8').replace('name: example','name: settings-snapshot').replace('config: []','config: [master, team, my]'));
  write('config/my/processes/settings-snapshot.json','{"subject":"local settings"}');
  const journal=require('../../tools/lib/runtime/run-journal');
  const started=journal.start(tmp,{process:'settings-snapshot',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test'}});
  assert.equal(started.state.params.subject,'local settings');
  assert.ok(Object.hasOwn(started.state.identity.files,'config/my/config.json'));
  write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:null,profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'}}));
  assert.throws(()=>journal.operation(tmp,'next',{output:started.output}),/Изменён вход/);
 });
}finally{ctx.close();}

'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,write,check}=ctx;
const {manifest}=require('../../tools/lib/entities/entities'),journal=require('../../tools/lib/runtime/run-journal');
try{
 check('JSON bindings preserve objects and arrays without rebinding user strings',()=>{
  const {bind}=require('../../tools/lib/entities/process-dependencies');
  const params={map:{section:['target','method'],literal:'{params.name}'},name:'Текст \"с кавычками\"',list:[1,true,'a']};
  assert.deepEqual(bind('{"map":{params.map},"list":{params.list},"name":"{params.name}"}',params),{map:params.map,list:params.list,name:params.name});
  assert.throws(()=>bind('{"missing":{params.unknown}}',params),/Нет параметра JSON/);
 });
 check('entity manifest returns entry points and a context catalog, excluding tutorial topics',()=>{
  const result=manifest(tmp,'example');assert.equal(result.ready,true);
  assert.ok(result.entities.some(item=>item.kind==='action'&&item.entry==='actions/edit-text/ACTION.md'));
  const context=result.entities.find(item=>item.kind==='context');assert.equal(context.name,'master');
  assert.ok(context.topics.includes('context/master/writing-style/CONTEXT.md'));
  assert.ok(!result.files.some(file=>file.includes('context/master/example/')));
  assert.ok(!result.readFiles.includes('context/master/writing-style/CONTEXT.md'));
 });
 check('calling an undeclared action or child process blocks resolution',()=>{
  const file=path.join(tmp,'processes/example/PROCESS.md'),original=fs.readFileSync(file,'utf8');
  try{fs.writeFileSync(file,original.replace('actions: [edit-text, prepare-mail-draft]','actions: []'));assert.throws(()=>manifest(tmp,'example'),/requires.actions/);}finally{fs.writeFileSync(file,original);}
  write('processes/my-parent/PROCESS.md','---\nname: my-parent\nentry: call\nrequires:\n  actions: []\n  processes: []\n---\n## Шаги\n### call\n- процесс: example\n- следующий: end\n');
  assert.throws(()=>manifest(tmp,'my-parent'),/requires.processes/);
 });
 check('whole action resources are protected without process-level file declarations',()=>{
  write('actions/edit-text/rules/internal.md','# Internal action resource\n');
  const run=journal.start(tmp,{process:'example',mode:'local',definitionTest:true,date:'2026-11-05',inputText:'Text',params:{to:'User',subject:'Status'}});
  assert.ok(run.entities.some(item=>item.kind==='action'&&item.name==='edit-text'));
  write('actions/edit-text/rules/internal.md','# Changed internal resource\n');
  assert.throws(()=>journal.operation(tmp,'begin',{output:run.output,step:'edit'}),/Изменён вход/);
  const next=journal.start(tmp,{process:'example',mode:'local',definitionTest:true,date:'2026-11-05',inputText:'Text',params:{to:'User',subject:'Status'}});
  write('actions/edit-text/rules/added.md','# Newly added resource\n');
  assert.throws(()=>journal.operation(tmp,'begin',{output:next.output,step:'edit'}),/состав зависимостей/);
 });
 check('personal processes can explicitly select all context levels without merging their topics',()=>{
  write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'Team A',owners:[]}}));
  write('context/team/domain/CONTEXT.md','# Team facts\n');write('context/my/domain/CONTEXT.md','# Personal facts\n');
  const text=fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8').replace('name: example','name: my-all').replace('context: [master]','context: [master, team, my]');
  write('processes/my-all/PROCESS.md',text);
  const contexts=manifest(tmp,'my-all').entities.filter(item=>item.kind==='context');
  assert.deepEqual(contexts.map(item=>item.name),['master','team','my']);
  assert.ok(contexts[1].topics.includes('context/team/domain/CONTEXT.md'));assert.ok(contexts[2].topics.includes('context/my/domain/CONTEXT.md'));
 });
}finally{ctx.close();}

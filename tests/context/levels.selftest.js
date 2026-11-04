'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,source,write,check}=ctx;
const {spawnSync}=require('node:child_process');
const {contextFile}=require('../../tools/lib/entities/context'),{dependencies}=require('../../tools/lib/entities/process-dependencies'),journal=require('../../tools/lib/runtime/run-journal');
const processSpec=(name,refs)=>`---\nname: ${name}\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: Context test\nexample: test\nentry: edit\nrequires:\n  actions: [edit-text]\n  context: [${['master',...refs].join(', ')}]\nparams:\n  styleFile: context/master/writing-style/CONTEXT.md\n---\n## Шаги\n### edit\n- действие: edit-text\n- артефакт: report-text\n- следующий: end\n`;
try{
 check('whole declared levels enter the snapshot; all their topics are protected',()=>{
  write('context/my/domain/CONTEXT.md','# Domain\nChosen facts.\n');write('context/my/unselected/CONTEXT.md','# Other\nUnselected facts.\n');
  write('processes/my-context/PROCESS.md',processSpec('my-context',['my']));
  const files=dependencies(tmp,'my-context',{},'local');assert.ok(files.includes('context/my/domain/CONTEXT.md'));assert.ok(files.includes('context/my/unselected/CONTEXT.md'));
  const run=journal.start(tmp,{process:'my-context',mode:'local',date:'2026-11-05',inputText:'Text'});
  write('context/my/unselected/CONTEXT.md','# Other\nChanged unselected facts.\n');
  assert.throws(()=>journal.operation(tmp,'begin',{output:run.output,step:'edit'}),/Изменён вход/);
  const changed=journal.start(tmp,{process:'my-context',mode:'local',date:'2026-11-05',inputText:'Text'});
  write('context/my/domain/CONTEXT.md','# Domain\nChanged selected facts.\n');
  assert.throws(()=>journal.operation(tmp,'begin',{output:changed.output,step:'edit'}),/Изменён вход/);
 });
 check('common processes cannot read personal context in preflight or snapshot resolution',()=>{
  write('processes/context-check/PROCESS.md',processSpec('context-check',['my']));
  assert.throws(()=>dependencies(tmp,'context-check',{},'local'),/нижнего уровня/);
  for(const args of [['--process','context-check','--demo'],['--only','processes']]){
   const result=spawnSync(process.execPath,[path.join(source,'tools/lib/validation/validate.js'),'--root',tmp,'--json',...args],{encoding:'utf8'});
   assert.equal(result.status,1,result.stdout);assert.match(result.stdout,/нижнего уровня/);
  }
  assert.throws(()=>contextFile(tmp,'my-context','master/../../config/my/config.json'),/Неверный путь/);
  assert.throws(()=>contextFile(tmp,'my-context','my/example/CONTEXT.md'),/Неверный путь/);
 });
 check('team context requires the matching selected team and is unavailable in no-team mode',()=>{
  write('context/team/domain/CONTEXT.md','# Team domain\nTeam facts.\n');
  write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'Team A',owners:[]}}));
  assert.equal(contextFile(tmp,'team-a-task','team/domain/CONTEXT.md'),'context/team/domain/CONTEXT.md');
  assert.throws(()=>contextFile(tmp,'team-b-task','team/domain/CONTEXT.md'),/не принадлежит/);
  const my={schemaVersion:2,teamId:null,profile:{name:'User',email:'user@example.invalid'},storage:{mode:'local'}};
  write('config/my/config.json',JSON.stringify(my));assert.throws(()=>contextFile(tmp,'my-context','team/domain/CONTEXT.md'),/не принадлежит/);
  my.teamId='a';write('config/my/config.json',JSON.stringify(my));assert.equal(contextFile(tmp,'my-context','team/domain/CONTEXT.md'),'context/team/domain/CONTEXT.md');
 });
}finally{ctx.close();}

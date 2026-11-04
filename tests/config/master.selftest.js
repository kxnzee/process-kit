'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,source,write,check}=ctx;
const {spawnSync}=require('node:child_process');
const {dependencies,resultPorts}=require('../../tools/lib/entities/process-dependencies'),journal=require('../../tools/lib/runtime/run-journal'),{loadMaster}=require('../../tools/lib/config/config');
try{
 check('master depth limit controls preflight, dependency resolution and snapshots in local mode',()=>{
  write('processes/my-leaf/PROCESS.md','---\nname: my-leaf\nentry: edit\nparams:\n  styleFile: context/master/writing-style/CONTEXT.md\n---\n## Шаги\n### edit\n- действие: edit-text\n- параметры: `text: {params.input}`\n- артефакт: report-text\n- следующий: end\n');
  write('processes/my-tree/PROCESS.md','---\nname: my-tree\nentry: call\n---\n## Шаги\n### call\n- процесс: my-leaf\n- следующий: end\n');
  const master=loadMaster(tmp);master.execution.maxProcessDepth=2;write('config/master/config.json',JSON.stringify(master));
  assert.ok(dependencies(tmp,'my-tree',{},'local').includes('config/master/config.json'));
  const run=journal.start(tmp,{process:'my-tree',mode:'local',date:'2026-11-04',inputText:'Input'});
  journal.operation(tmp,'enter',{output:run.output,step:'call'});
  master.execution.maxProcessDepth=1;write('config/master/config.json',JSON.stringify(master));
  assert.throws(()=>dependencies(tmp,'my-tree',{},'local'),/глубина/);
  assert.throws(()=>resultPorts(tmp,'my-tree'),/Цикл/);
  assert.throws(()=>journal.operation(tmp,'begin',{output:run.output,step:'edit'}),/Изменён вход/);
  const result=spawnSync(process.execPath,[path.join(source,'tools/lib/validation/validate.js'),'--root',tmp,'--process','my-tree','--demo','--json'],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stdout,/глубина/);
  master.execution.maxProcessDepth=0;write('config/master/config.json',JSON.stringify(master));assert.throws(()=>loadMaster(tmp),/minimum/);
 });
}finally{ctx.close();}

'use strict';
const c=require('../fixture')(),{tmp,write,assert,check}=c;
const journal=require('../../tools/lib/runtime/run-journal');
try{
 write('actions/audit-default/ACTION.md','---\nname: audit-default\ndescription: defaults\nkind: transform\nadapter: none\nconsumes:\n  artifacts: []\n  params: [greeting]\nproduces:\n  result: Text\ncontracts:\n  result: text\ndefaults:\n  greeting: hello\nruntime: runtime.js\n---\n# Defaults\n');
 write('actions/audit-default/runtime.js',"exports.validate=ctx=>{if(ctx.value!==ctx.params.greeting)throw new Error('Default missing or priority lost');};");
 write('processes/audit-default/PROCESS.md','---\nname: audit-default\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: defaults\nexample: test\nentry: work\n---\n## Шаги\n### work\n- действие: audit-default\n- артефакт: result\n- следующий: end\n');
 check('ARCH-005: Controller applies Action defaults to next, begin and save',()=>{
  const {output}=journal.start(tmp,{process:'audit-default',mode:'local',definitionTest:true});
  assert.equal(journal.operation(tmp,'next',{output}).params.greeting,'hello');
  const begun=journal.operation(tmp,'begin',{output,step:'work'});assert.equal(begun.pending.params.greeting,'hello');
  journal.operation(tmp,'save',{...begun.save,content:'hello'});
 });
 check('ARCH-005: explicit run parameters override Action defaults',()=>{
  const {output}=journal.start(tmp,{process:'audit-default',mode:'local',definitionTest:true,params:{greeting:'explicit'}});
  const begun=journal.operation(tmp,'begin',{output,step:'work'});assert.equal(begun.pending.params.greeting,'explicit');
  journal.operation(tmp,'save',{...begun.save,content:'explicit'});
 });
}finally{c.close();}

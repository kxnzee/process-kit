'use strict';
const c=require('../fixture')(),{tmp,write,fs,path,assert,check}=c;
const journal=require('../../tools/lib/runtime/run-journal');
try{
 const definition='processes/audit-admission/PROCESS.md',marker=path.join(tmp,'loaded');
 write(definition,'---\nname: audit-admission\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: admission\nexample: test\nentry: work\nbranchRule: rules/probe.js\n---\n## Шаги\n### work\n- действие: example\n- артефакт: result\n- следующий: end\n');
 write('processes/audit-admission/rules/probe.js',"require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../../loaded'),'loaded');exports.choose=()=>{};");
 check('ARCH-007: unpublished normal start is rejected before loading definition code',()=>{
  assert.throws(()=>journal.start(tmp,{process:'audit-admission',mode:'local',params:{rule:'default'}}),/не опубликовано/);
  assert.equal(fs.existsSync(marker),false);
 });
 check('ARCH-007: executable deep commands advertise definition-code trust, unlike safe inspection',()=>{
  const {commands}=require('../../tools/kit');
  for(const command of ['entities','check']){assert.equal(commands[command].scope,'definition-code');assert.match(commands[command].scopeNote,/код/);}
  assert.equal(commands.processes.scope,'read-only');assert.match(commands.definition.scopeNote,/inspect: read-only/);
 });
}finally{c.close();}

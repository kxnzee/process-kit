'use strict';
const c=require('../fixture')(),{tmp,write,fs,path,assert,check}=c;
const journal=require('../../tools/lib/runtime/run-journal');
try{
 check('ARCH-002: a changed file input is rejected before the next step',()=>{
  const file='processes/example/data/input.md';write(file,'12 задач.');
  const {output}=journal.start(tmp,{process:'example',mode:'local',definitionTest:true,params:{text:file,to:'Test',subject:'Audit'}});
  write(file,'99 задач.');
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'edit'}),/Изменён вход/);
 });
 check('ARCH-002: a changed branch helper is rejected before loading the rule',()=>{
  const folder='processes/audit-helper';
  write(folder+'/PROCESS.md','---\nname: audit-helper\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: helper snapshot\nexample: test\nentry: gate\nbranchRule: rules/choose.js\n---\n## Шаги\n### gate\n- branch:\n  - иначе (default): goto: work\n### work\n- действие: example\n- артефакт: result\n- следующий: end\n');
  write(folder+'/rules/choose.js',"exports.choose=()=>require('./helper');");
  write(folder+'/rules/helper.js',"module.exports={target:'work',reason:'before'};");
  const {output}=journal.start(tmp,{process:'audit-helper',mode:'local',definitionTest:true,params:{rule:'default'}});
  write(folder+'/rules/helper.js',"throw new Error('HELPER_EXECUTED');");
  assert.throws(()=>journal.operation(tmp,'next',{output}),/Изменён вход/);
 });
 check('ARCH-002/007: added runtime helper is rejected before dependency hooks execute it',()=>{
  write('actions/audit-added/ACTION.md','---\nname: audit-added\ndescription: added helper\nkind: transform\nadapter: none\nconsumes:\n  artifacts: []\n  params: []\nproduces:\n  result: Text\ncontracts:\n  result: text\nruntime: runtime.js\n---\n# Added helper\n');
  write('actions/audit-added/runtime.js',"const fs=require('node:fs'),path=require('node:path');exports.dependencies=()=>{if(fs.existsSync(path.join(__dirname,'helper.js')))require('./helper.js');return [];};");
  write('processes/audit-added/PROCESS.md','---\nname: audit-added\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: added helper\nexample: test\nentry: work\n---\n## Шаги\n### work\n- действие: audit-added\n- артефакт: result\n- следующий: end\n');
  const {output}=journal.start(tmp,{process:'audit-added',mode:'local',definitionTest:true});
  write('actions/audit-added/helper.js',"require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../helper-loaded'),'loaded');");
  assert.throws(()=>journal.operation(tmp,'next',{output}),/Изменён состав зависимостей/);
  assert.equal(fs.existsSync(path.join(tmp,'helper-loaded')),false);
 });
}finally{c.close();}

'use strict';
const c=require('../fixture')(),{tmp,write,fs,path,assert,check}=c;
const journal=require('../../tools/lib/runtime/run-journal');
try{
 check('runtime admission and shared Action helpers are frozen before any continuation',()=>{
  const started=journal.start(tmp,{process:'example',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test',subject:'Audit'}});
  const stateFile=path.join(tmp,'outputs',started.output,'.run/state.json'),before=fs.readFileSync(stateFile);
  for(const file of ['entities/process-facts.js','runtime/start-requests.js','actions/action-support.js','actions/query-file.js','actions/query-data.js','actions/code-data.js','actions/page-url.js']){
   const relative='tools/lib/'+file,full=path.join(tmp,relative),original=fs.readFileSync(full);
   assert.ok(started.files.includes(relative),relative+' is missing from the snapshot');
   try{
    fs.appendFileSync(full,"\nthrow Error('CHANGED_CORE_LOADED');\n");
    for(const command of ['next','begin'])assert.throws(()=>journal.operation(tmp,command,{output:started.output,step:'edit'}),/Изменён вход/);
    assert.deepEqual(fs.readFileSync(stateFile),before);
   }finally{fs.writeFileSync(full,original);}
  }
  assert.equal(journal.operation(tmp,'next',{output:started.output}).operation,'begin');
 });
 check('new implementation helpers are detected before definition dependency hooks load them',()=>{
  write('actions/core-probe/ACTION.md','---\nname: core-probe\ndescription: core inventory\nkind: transform\nadapter: none\nconsumes:\n  artifacts: []\n  params: []\nproduces:\n  result: Text\ncontracts:\n  result: text\nruntime: runtime.js\n---\n# Probe\n');
  write('actions/core-probe/runtime.js',"const fs=require('node:fs'),path=require('node:path');exports.dependencies=ctx=>{const file=path.join(ctx.cwd,'tools/lib/actions/optional.js');if(fs.existsSync(file))require(file);return [];};");
  write('processes/core-probe/PROCESS.md','---\nname: core-probe\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: core inventory\nexample: test\nentry: work\n---\n## Шаги\n### work\n- действие: core-probe\n- артефакт: result\n- следующий: end\n');
  const {output}=journal.start(tmp,{process:'core-probe',mode:'local',definitionTest:true});
  write('tools/lib/actions/optional.js',"require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../../CORE_HELPER_LOADED'),'loaded');");
  try{
   assert.throws(()=>journal.operation(tmp,'next',{output}),/Изменён состав зависимостей/);
   assert.equal(fs.existsSync(path.join(tmp,'CORE_HELPER_LOADED')),false);
  }finally{fs.unlinkSync(path.join(tmp,'tools/lib/actions/optional.js'));}
 });
 check('ARCH-002: caller-provided params.input remains a frozen file input without start.inputText',()=>{
  const file='processes/example/data/explicit-input.md';
  for(const params of [{input:file},{input:file,text:file},{input:file,text:file,generatedInput:file}]){
   write(file,'12 задач.');
   const {output,files}=journal.start(tmp,{process:'example',mode:'local',definitionTest:true,params:{...params,to:'Test',subject:'Audit'}});
   assert.ok(files.includes(file),'Caller input was mistaken for the Controller-generated copy');
   assert.equal(journal.operation(tmp,'next',{output}).operation,'begin');
   write(file,'99 задач.');
   for(const command of ['next','begin'])assert.throws(()=>journal.operation(tmp,command,{output,step:'edit'}),/Изменён вход/);
  }
 });
 check('ARCH-002: only the Controller-owned input copy is excluded from static inventory',()=>{
  const started=journal.start(tmp,{process:'example',mode:'local',definitionTest:true,inputText:'12 задач.',params:{input:'processes/example/missing-input.md',to:'Test',subject:'Audit'}});
  assert.notEqual(started.state.params.input,'processes/example/missing-input.md');
  assert.equal(started.state.identity.overrides.input,started.state.params.input);
  assert.ok(started.files.includes(started.state.params.input));
  assert.equal(journal.operation(tmp,'next',{output:started.output}).operation,'begin');
  fs.writeFileSync(path.join(tmp,started.state.params.input),'99 задач.');
  assert.throws(()=>journal.operation(tmp,'next',{output:started.output}),/Изменён вход/);
 });
 check('ARCH-002: an unresolved artifact token cannot be used as an unsnapshotted literal file',()=>{
  write('{untracked}','12 задач.');
  assert.throws(()=>{
   const {output}=journal.start(tmp,{process:'example',mode:'local',definitionTest:true,params:{input:'{untracked}',to:'Test',subject:'Audit'}});
   journal.operation(tmp,'begin',{output,step:'edit'});
  },/Не разрешена ссылка на артефакт|Недопустимый ресурс/);
 });
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

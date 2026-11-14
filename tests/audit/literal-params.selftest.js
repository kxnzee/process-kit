'use strict';
const c=require('../fixture')(),{tmp,write,fs,path,assert,check}=c;
const integration=require('../../tools/lib/integrations/gigacode-run');
try{
 require('node:child_process').execFileSync('git',['init','-b','master'],{cwd:tmp,stdio:'ignore'});
 check('public start preserves literal mail subjects and input text that resemble foreign resource paths',()=>{
  for(const text of ['processes/team-b-private/not-a-file.md','actions/my-private/not-a-file.md','adapters/team-b-private/not-a-file.md','context/my/not-a-file.md','{"path":"processes/team-b-private/not-a-file.md"}']){
   const result=integration.run(tmp,'start',{process:'example',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test',subject:text,inputText:text}});
   assert.equal(result.state.params.subject,text);assert.equal(result.state.params.inputText,text);
   const card=integration.run(tmp,'next',{output:result.output});assert.equal(card.params.inputText,text);
  }
 });
 const text='processes/team-b-private/not-a-file.md';
 check('literal contracts support copied Actions and bindings through a child Process',()=>{
  fs.cpSync(path.join(tmp,'actions/example'),path.join(tmp,'actions/wording'),{recursive:true});
  const action=path.join(tmp,'actions/wording/ACTION.md');
  fs.writeFileSync(action,fs.readFileSync(action,'utf8').replace('name: example','name: wording').replace('params: [text, rule]','params: [caption, rule]').replace('literalParams: [text]','literalParams: [caption]'));
  write('processes/literal-child/PROCESS.md','---\nname: literal-child\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: Literal binding acceptance\nexample: text\nentry: work\nrequires:\n  actions: [wording]\n  processes: []\n---\n## Шаги\n### work\n- действие: wording\n- параметры:\n  - `caption: {params.note}`\n  - `rule: default`\n- артефакт: result\n- следующий: end\n');
  write('processes/literal-parent/PROCESS.md','---\nname: literal-parent\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: Literal child acceptance\nexample: text\nentry: child\nrequires:\n  actions: []\n  processes: [literal-child]\n---\n## Шаги\n### child\n- процесс: literal-child\n- параметры:\n  - `note: {params.outer}`\n- следующий: end\n');
  const run=integration.run(tmp,'start',{process:'literal-parent',mode:'local',definitionTest:true,params:{outer:text}});
  integration.run(tmp,'enter',integration.run(tmp,'next',{output:run.output}).spec);
  assert.equal(integration.run(tmp,'next',{output:run.output}).params.caption,text);
 });
 check('binding literal text into a real file parameter still rejects the foreign resource',()=>{
  const file=path.join(tmp,'processes/example/PROCESS.md'),original=fs.readFileSync(file,'utf8');
  assert.ok(original.includes('styleFile: {params.styleFile}'));
  fs.writeFileSync(file,original.replace('styleFile: {params.styleFile}','styleFile: {params.subject}'));
  try{assert.throws(()=>integration.run(tmp,'start',{process:'example',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test',subject:text}}),/недоступ|владени/i);}
  finally{fs.writeFileSync(file,original);}
 });
 check('an Action without literal annotations retains conservative admission',()=>{
  const file=path.join(tmp,'actions/wording/ACTION.md'),original=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,original.replace('  literalParams: [caption]\n',''));
  try{assert.throws(()=>integration.run(tmp,'start',{process:'literal-child',mode:'local',definitionTest:true,params:{note:text}}),/недоступ|владени/i);}
  finally{fs.writeFileSync(file,original);}
 });
 check('literal Action inputs do not exempt untyped branchRule parameters before JavaScript loads',()=>{
  const file=path.join(tmp,'processes/example/PROCESS.md'),original=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,original.replace('version:','branchRule: rules/probe.js\nversion:'));
  write('processes/example/rules/probe.js',"require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../../BRANCH_LOADED'),'loaded');exports.choose=()=> 'end';");
  try{
   assert.throws(()=>integration.run(tmp,'start',{process:'example',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test',subject:text}}),/недоступ|владени/i);
   assert.equal(fs.existsSync(path.join(tmp,'BRANCH_LOADED')),false);
  }finally{fs.writeFileSync(file,original);fs.unlinkSync(path.join(tmp,'processes/example/rules/probe.js'));}
 });
 check('invalid literal contracts cannot turn declared file parameters into text exemptions',()=>{
  const file=path.join(tmp,'actions/edit-text/ACTION.md'),original=fs.readFileSync(file,'utf8');
  for(const literals of ['[inputText, inputText]','[unknown]','[styleFile]','[text]']){
   fs.writeFileSync(file,original.replace('literalParams: [inputText, режим, кому]','literalParams: '+literals));
   try{assert.throws(()=>integration.run(tmp,'start',{process:'example',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test',subject:'Review'}}),/literalParams/i);}
   finally{fs.writeFileSync(file,original);}
  }
 });
}finally{c.close();}

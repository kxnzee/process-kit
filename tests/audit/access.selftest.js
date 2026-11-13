'use strict';
const c=require('../fixture')(),{tmp,write,fs,path,assert,check}=c;
const {execFileSync,spawnSync}=require('node:child_process');
const integration=require('../../tools/lib/integrations/gigacode-run');
try{
 execFileSync('git',['init','--initial-branch=master'],{cwd:tmp,stdio:'ignore'});
 const foreign='team-b-foreign';
 fs.cpSync(path.join(tmp,'processes/example'),path.join(tmp,'processes',foreign),{recursive:true});
 const file=path.join(tmp,'processes',foreign,'PROCESS.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: example','name: '+foreign).replace('version:','branchRule: rules/probe.js\nversion:'));
 write(`processes/${foreign}/rules/probe.js`,"require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../../loaded'),'loaded');exports.choose=()=>{};");
 check('ARCH-001: direct GigaCode start rejects foreign ownership before loading code',()=>{
  for(const definitionTest of [false,true])assert.throws(()=>integration.run(tmp,'start',{process:foreign,mode:'local',definitionTest,inputText:'12 задач.'}),/недоступ|владени/i);
  assert.equal(fs.existsSync(path.join(tmp,'loaded')),false);
 });
 check('ARCH-001: public definition commands cannot bypass ownership',()=>{
  write('spec.json',JSON.stringify({process:foreign}));
  for(const command of ['validate','status','test','publish']){
   const result=spawnSync(process.execPath,['tools/kit.js','definition',command,'spec.json'],{cwd:tmp,encoding:'utf8'});
   assert.equal(result.status,1);assert.match(result.stderr,/недоступ|владени/i);
  }
  assert.equal(fs.existsSync(path.join(tmp,'loaded')),false);
 });
 check('ARCH-001: an allowed root cannot smuggle a foreign declared dependency',()=>{
  const root=path.join(tmp,'processes/example/PROCESS.md'),text=fs.readFileSync(root,'utf8');
  fs.writeFileSync(root,text.replace('processes: []','processes: [team-b-foreign]'));
  assert.throws(()=>integration.run(tmp,'start',{process:'example',mode:'local',definitionTest:true,inputText:'12 задач.'}),/недоступ|владени/i);
  assert.equal(fs.existsSync(path.join(tmp,'loaded')),false);
 });
 check('ARCH-001: personal scope only admits the selected team, including resource parameters',()=>{
  execFileSync('git',['symbolic-ref','HEAD','refs/heads/my'],{cwd:tmp,stdio:'ignore'});
  write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:'a',profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'},taskStores:[],codeStores:[],defaults:{},preferences:{}}));
  write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'A',owners:[]},taskStores:[],codeStores:[],defaults:{}}));
  const access=require('../../tools/lib/entities/process-facts').assertAccess;
  assert.throws(()=>access(tmp,foreign),/недоступ|владени/i);
  fs.cpSync(path.join(tmp,'processes/example'),path.join(tmp,'processes/my-allowed'),{recursive:true});
  const file=path.join(tmp,'processes/my-allowed/PROCESS.md');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: example','name: my-allowed').replace('processes: [team-b-foreign]','processes: []'));
  assert.doesNotThrow(()=>access(tmp,'my-allowed'));
  assert.throws(()=>access(tmp,'my-allowed',{text:'processes/team-b-foreign/data.txt'}),/недоступ|владени/i);
 });
 check('ARCH-001: entities CLI admits its actual parameter file before resolving dependencies',()=>{
  write('processes/team-b-foreign/style.txt','Foreign style');
  write('params.json',JSON.stringify({styleFile:'processes/team-b-foreign/style.txt',inputText:'12 задач.'}));
  const result=spawnSync(process.execPath,['tools/kit.js','entities','my-allowed','local','params.json'],{cwd:tmp,encoding:'utf8'});
  assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stderr,/недоступ|владени/i);
  assert.equal(result.stdout,'');
 });
 check('ARCH-001: adapter resources obey the same selected-team boundary as Processes and Actions',()=>{
  write('adapters/team-b-foreign/style.txt','Foreign style');
  const params={styleFile:'adapters/team-b-foreign/style.txt',to:'Test',subject:'Audit'};
  assert.throws(()=>integration.run(tmp,'start',{process:'my-allowed',mode:'local',definitionTest:true,inputText:'12 задач.',params}),/недоступ|владени/i);
  const actionFile=path.join(tmp,'actions/edit-text/ACTION.md'),original=fs.readFileSync(actionFile,'utf8');
  fs.writeFileSync(actionFile,original.replace('requiresFiles: [tools/lib/actions/action-support.js]','requiresFiles: [adapters/team-b-foreign/style.txt]'));
  try{assert.throws(()=>integration.run(tmp,'start',{process:'my-allowed',mode:'local',definitionTest:true,inputText:'12 задач.'}),/недоступ|владени/i);}
  finally{fs.writeFileSync(actionFile,original);}
 });
 check('ARCH-001: explicit files and requiresFiles cannot hide a foreign owner through path normalization',()=>{
  write('processes/team-b-foreign/data.md','Foreign data');
  const actionFile=path.join(tmp,'actions/edit-text/ACTION.md'),original=fs.readFileSync(actionFile,'utf8');
  const aliases=['processes/my-allowed/../team-b-foreign/data.md','tools/../processes/team-b-foreign/data.md','processes\\team-b-foreign\\data.md','Processes/team-b-foreign/data.md'];
  for(const file of aliases){
   assert.throws(()=>integration.run(tmp,'start',{process:'my-allowed',mode:'local',definitionTest:true,inputText:'12 задач.',files:[file]}),/каноническ/i);
   fs.writeFileSync(actionFile,original.replace('requiresFiles: [tools/lib/actions/action-support.js]',`requiresFiles: [${file}]`));
   try{assert.throws(()=>integration.run(tmp,'start',{process:'my-allowed',mode:'local',definitionTest:true,inputText:'12 задач.'}),/каноническ/i);}
   finally{fs.writeFileSync(actionFile,original);}
  }
 });
 check('ARCH-001: direct Action CLI checks the selected owner before loading code and preserves literal text',()=>{
  write('actions/team-b-probe/ACTION.md','---\nname: team-b-probe\ndescription: Foreign action\nkind: transform\nadapter: none\nconsumes:\n  artifacts: []\n  params: []\nproduces:\n  result: Text\ncontracts:\n  result: text\nruntime: runtime.js\n---\n# Foreign action\n');
  write('actions/team-b-probe/runtime.js',"require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../FOREIGN_ACTION_LOADED'),'loaded');");
  write('action.json',JSON.stringify({action:'team-b-probe',mode:'local'}));
  const denied=spawnSync(process.execPath,['tools/kit.js','action','action.json'],{cwd:tmp,encoding:'utf8'});
  assert.equal(denied.status,1,denied.stdout+denied.stderr);assert.match(denied.stderr,/недоступ|владени/i);
  assert.equal(fs.existsSync(path.join(tmp,'FOREIGN_ACTION_LOADED')),false);
  write('actions/my-probe/ACTION.md',fs.readFileSync(path.join(tmp,'actions/team-b-probe/ACTION.md'),'utf8').replace('name: team-b-probe','name: my-probe').replace('runtime: runtime.js','requiresFiles: [adapters/team-b-foreign/style.txt]\nruntime: runtime.js'));
  write('actions/my-probe/runtime.js',fs.readFileSync(path.join(tmp,'actions/team-b-probe/runtime.js'),'utf8'));
  write('action.json',JSON.stringify({action:'my-probe',mode:'local'}));
  const dependency=spawnSync(process.execPath,['tools/kit.js','action','action.json'],{cwd:tmp,encoding:'utf8'});
  assert.equal(dependency.status,1,dependency.stdout+dependency.stderr);assert.match(dependency.stderr,/недоступ|владени/i);
  assert.equal(fs.existsSync(path.join(tmp,'FOREIGN_ACTION_LOADED')),false);
  const text='processes/team-b-foreign/data.md';
  write('action.json',JSON.stringify({action:'example',params:{text,rule:'default'},value:{text}}));
  const ordinary=spawnSync(process.execPath,['tools/kit.js','action','action.json'],{cwd:tmp,encoding:'utf8'});
  assert.equal(ordinary.status,0,ordinary.stderr);assert.equal(JSON.parse(ordinary.stdout).status,'completed');
 });
 check('ARCH-001: bindings, literal braces, JSON parameters and Action defaults cannot hide foreign resources',()=>{
  const access=require('../../tools/lib/entities/process-facts').assertAccess;
  for(const text of ['processes/team-b-foreign/data{literal}.txt','{"data":"processes/team-b-foreign/data.txt"}'])assert.throws(()=>access(tmp,'my-allowed',{text}),/недоступ|владени/i);
  const file=path.join(tmp,'processes/my-allowed/PROCESS.md'),original=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,original.replace('text: {params.input}','text: processes/{params.team}/data.md'));
  assert.throws(()=>access(tmp,'my-allowed',{team:'team-b-foreign'}),/недоступ|владени/i);fs.writeFileSync(file,original);
  const actionFile=path.join(tmp,'actions/edit-text/ACTION.md'),actionText=fs.readFileSync(actionFile,'utf8');
  fs.writeFileSync(file,original.replace('  - `text: {params.input}`\n',''));
  fs.writeFileSync(actionFile,actionText.replace('defaults:','defaults:\n  text: processes/team-b-foreign/data.txt'));
  assert.throws(()=>access(tmp,'my-allowed'),/недоступ|владени/i);fs.writeFileSync(actionFile,actionText);
  fs.writeFileSync(actionFile,actionText.replace('requiresFiles: [tools/lib/actions/action-support.js]','requiresFiles: [processes/team-b-foreign/data.txt]'));
  assert.throws(()=>access(tmp,'my-allowed'),/недоступ|владени/i);
 });
}finally{c.close();}

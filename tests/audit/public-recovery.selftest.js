'use strict';
const c=require('../fixture')(),{tmp,fs,path,assert,check}=c;
const integration=require('../../tools/lib/integrations/gigacode-run');
let foreignOutput;
try{
 check('ARCH-001/004: public recover admits the prepared initial transaction when state is absent',()=>{
  const rename=fs.renameSync;let interrupted=false;
  fs.renameSync=function(from,to){if(!interrupted&&to.endsWith(path.join('.run','state.json'))){interrupted=true;throw Object.assign(new Error('INITIAL_STATE_INTERRUPTED'),{code:'EIO'});}return rename.apply(this,arguments);};
  try{assert.throws(()=>integration.run(tmp,'start',{process:'example',mode:'local',inputText:'12 задач.',params:{to:'Test',subject:'Status'}}),/INITIAL_STATE_INTERRUPTED/);}finally{fs.renameSync=rename;}
  assert.ok(interrupted);const output=fs.readdirSync(path.join(tmp,'outputs'))[0];
  assert.equal(fs.existsSync(path.join(tmp,'outputs',output,'.run/state.json')),false);
  assert.equal(integration.run(tmp,'recover',{output}).operation,'begin');
  assert.equal(integration.run(tmp,'recover',{output}).operation,'begin');
 });
 check('ARCH-007: unavailable or corrupt state still permits safe diagnosis without exposing contents',()=>{
  const output=fs.readdirSync(path.join(tmp,'outputs'))[0],file=path.join(tmp,'outputs',output,'.run/state.json');
  fs.writeFileSync(file,'PRIVATE_RAW_FAILURE');
  const result=integration.run(tmp,'diagnose',{output});
  assert.ok(result.reportFile);assert.ok(!fs.readFileSync(result.reportFile,'utf8').includes('PRIVATE_RAW_FAILURE'));
 });
 check('public diagnosis rejects foreign runs before exporting, including damaged state and prepared transactions',()=>{
  require('node:child_process').execFileSync('git',['init','-b','master'],{cwd:tmp,stdio:'ignore'});
  const name='team-b-private',folder=path.join(tmp,'processes',name);
  fs.cpSync(path.join(tmp,'processes/example'),folder,{recursive:true});
  const definition=path.join(folder,'PROCESS.md');fs.writeFileSync(definition,fs.readFileSync(definition,'utf8').replace('name: example','name: '+name));
  const started=require('../../tools/lib/runtime/run-journal').start(tmp,{process:name,mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test',subject:'Private'}});
  const output=started.output,dir=path.join(tmp,'outputs',output,'.run'),file=path.join(dir,'state.json'),state=fs.readFileSync(file,'utf8');
  foreignOutput=output;
  const entries=()=>fs.readdirSync(path.dirname(dir)).sort(),before=entries();
  for(const mode of ['intact','damaged','absent','transaction']){
   if(mode==='damaged')fs.writeFileSync(file,'PRIVATE_DAMAGED_STATE');
   if(mode==='absent'){fs.unlinkSync(file);fs.writeFileSync(path.join(dir,'trace.jsonl'),'PRIVATE_DAMAGED_TRACE');}
   if(mode==='transaction')fs.writeFileSync(path.join(dir,'transaction.json'),JSON.stringify({state,trace:''}));
   assert.throws(()=>integration.run(tmp,'diagnose',{output}),/владени|недоступ|владельц/i,mode);
   assert.deepEqual(entries(),before,'a denied diagnosis must not create an export');
  }
 });
 check('personal diagnosis admits the selected team and rejects another team even with damaged state',()=>{
  require('node:child_process').execFileSync('git',['symbolic-ref','HEAD','refs/heads/my'],{cwd:tmp,stdio:'ignore'});
  c.write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:'a',profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'local'},taskStores:[],codeStores:[],defaults:{},preferences:{}}));
  c.write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'A',owners:[]},taskStores:[],codeStores:[],defaults:{}}));
  const folder=path.join(tmp,'processes/team-a-owned');fs.cpSync(path.join(tmp,'processes/example'),folder,{recursive:true});
  const file=path.join(folder,'PROCESS.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: example','name: team-a-owned'));
  const run=integration.run(tmp,'start',{process:'team-a-owned',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test',subject:'Review'}});
  assert.ok(integration.run(tmp,'diagnose',{output:run.output}).reportFile);
  fs.writeFileSync(path.join(tmp,'outputs',run.output,'.run/state.json'),'PRIVATE_DAMAGED_STATE');
  assert.ok(integration.run(tmp,'diagnose',{output:run.output}).reportFile);
  assert.throws(()=>integration.run(tmp,'diagnose',{output:foreignOutput}),/недоступ|владени/i);
 });
 check('diagnosis of an owned damaged run does not require an intact definition or publication',()=>{
  const result=integration.run(tmp,'start',{process:'example',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test',subject:'Review'}});
  const state=path.join(tmp,'outputs',result.output,'.run/state.json'),definition=path.join(tmp,'processes/example/PROCESS.md');
  fs.unlinkSync(definition);fs.writeFileSync(state,'PRIVATE_DAMAGED_STATE');
  const diagnosis=integration.run(tmp,'diagnose',{output:result.output}),text=fs.readFileSync(diagnosis.reportFile,'utf8');
  assert.ok(text.includes('состояние отсутствует или повреждено'));assert.ok(!text.includes('PRIVATE_DAMAGED_STATE'));
 });
}finally{c.close();}

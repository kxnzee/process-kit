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
}finally{c.close();}

'use strict';
const fixture=require('../fixture'),c=fixture(),{tmp,write,fs,path,assert,check}=c;
const {execFileSync}=require('node:child_process');
const {catalog}=require('../../tools/lib/entities/process-catalog');
const integration=require('../../tools/lib/integrations/gigacode-run');
const git=(...args)=>execFileSync('git',args,{cwd:tmp,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const personal={schemaVersion:2,teamId:'a',profile:{name:'Ownership Test',email:'ownership@example.invalid'},storage:{mode:'local'},taskStores:[],codeStores:[],defaults:{},preferences:{}};
function processFile(name,action='example',contexts=[]){
 write(`processes/${name}/PROCESS.md`,`---\nname: ${name}\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: Ownership acceptance\nexample: test\nentry: work\nrequires:\n  actions: [${action}]\n  processes: []\n  context: [${contexts.join(', ')}]\nparams:\n  text: Ownership\n  rule: default\n---\n## Шаги\n### work\n- действие: ${action}\n- артефакт: result\n- следующий: end\n`);
}
try{
 git('init','-b','master');git('config','user.name',personal.profile.name);git('config','user.email',personal.profile.email);
 write('seed.md','seed');git('add','seed.md');git('-c','commit.gpgsign=false','commit','-m','Ownership fixture');
 for(const team of ['a','b','c']){git('branch','team-'+team);processFile('team-'+team+'-report');}
 git('switch','-c','my','--no-track');git('config','branch.my.pushRemote','no_push');
 write('config/my/config.json',JSON.stringify(personal));
 write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'A',owners:[]},taskStores:[],codeStores:[],defaults:{}}));
 fs.cpSync(path.join(tmp,'actions/example'),path.join(tmp,'actions/my-custom-action'),{recursive:true});
 const actionFile=path.join(tmp,'actions/my-custom-action/ACTION.md');
 fs.writeFileSync(actionFile,fs.readFileSync(actionFile,'utf8').replace('name: example','name: my-custom-action'));
 write('context/my/preferences/CONTEXT.md','# Preferences\nSynthetic facts.\n');
 for(const name of ['my-report','my-analytics'])processFile(name,'my-custom-action',['my']);

 check('one my branch executes multiple personal Processes sharing a my-prefixed Action and plain Context topic',()=>{
  assert.equal(git('branch','--show-current'),'my');
  const rows=catalog(tmp);assert.equal(rows.complete,true);
  assert.deepEqual(rows.processes.filter(p=>p.level==='my').map(p=>p.name).sort(),['my-analytics','my-report']);
  for(const process of ['my-report','my-analytics']){
   const started=integration.run(tmp,'start',{process,mode:'local',definitionTest:true});
   assert.ok(started.files.includes('context/my/preferences/CONTEXT.md'));
   const card=integration.run(tmp,'next',{output:started.output});assert.equal(card.action,'my-custom-action');
   const begun=integration.run(tmp,'begin',card.spec);
   integration.run(tmp,'save',{...begun.save,content:{text:'Ownership'}});
   assert.equal(integration.run(tmp,'finish',{output:started.output,resultName:'result.json'}).status,'completed');
  }
  assert.deepEqual(git('for-each-ref','--format=%(refname:short)','refs/heads/my').split('\n'),['my']);
 });

 check('a Git branch named like a personal entity does not acquire personal authority',()=>{
  for(const branch of ['my-report','my-analytics']){
   git('switch','-c',branch,'my');
   const rows=catalog(tmp);assert.equal(rows.scope.level,null);assert.equal(rows.scope.personal,false);
   assert.ok(rows.processes.every(p=>p.level==='master'));
   assert.throws(()=>integration.run(tmp,'start',{process:'my-report',mode:'local',definitionTest:true}),/недоступ|владени/i);
   git('switch','my');
  }
 });

 check('multiple primary team branches do not grant access outside the selected team or allow common-to-personal references',()=>{
  const branches=git('for-each-ref','--format=%(refname:short)','refs/heads').split('\n');
  for(const team of ['a','b','c'])assert.ok(branches.includes('team-'+team));
  const names=catalog(tmp).processes.filter(p=>p.level==='team').map(p=>p.name);assert.deepEqual(names,['team-a-report']);
  for(const team of ['b','c'])assert.throws(()=>integration.run(tmp,'start',{process:'team-'+team+'-report',mode:'local',definitionTest:true}),/недоступ|владени/i);
  git('switch','master');processFile('ownership-common','my-custom-action');
  assert.throws(()=>integration.run(tmp,'start',{process:'ownership-common',mode:'local',definitionTest:true}),/недоступ|владени/i);
  git('switch','my');
 });

 check('Git permits another local clone with its own my without creating a global user registry',()=>{
  const other=fixture({copy:false});
  try{
   execFileSync('git',['clone','--no-hardlinks','--no-checkout','--',tmp,other.tmp],{stdio:'pipe'});
   fixture.copyProject(tmp,other.tmp);
   other.write('config/my/config.json',JSON.stringify({...personal,teamId:null}));
   execFileSync('git',['branch','--unset-upstream','my'],{cwd:other.tmp,stdio:'pipe'});
   execFileSync('git',['config','branch.my.pushRemote','no_push'],{cwd:other.tmp,stdio:'pipe'});
   assert.equal(git('branch','--show-current'),'my');
   assert.equal(execFileSync('git',['branch','--show-current'],{cwd:other.tmp,encoding:'utf8'}).trim(),'my');
   const rows=catalog(other.tmp);assert.equal(rows.scope.personal,true);
   assert.deepEqual(rows.processes.filter(p=>p.level==='my').map(p=>p.name).sort(),['my-analytics','my-report']);
  }finally{other.close();}
 });
}finally{c.close();}

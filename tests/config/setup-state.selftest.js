'use strict';
const fixture=require('../fixture'),ctx=fixture(),{fs,path,assert,tmp,write,check}=ctx;
const {execFileSync,spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const {inspect}=require('../../tools/lib/config/setup-state');
const git=(...args)=>execFileSync('git',args,{cwd:tmp,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const myFile=path.join(tmp,'config/my/config.json');
const personal=()=>({schemaVersion:2,teamId:null,profile:{name:'PRIVATE_PROFILE_NAME',email:'private-profile@example.invalid'},storage:{mode:'local'},taskStores:[],codeStores:[],defaults:{},preferences:{}});
function ready(){
 if(git('branch','--show-current')!=='my')git('switch','my');
 write('config/my/config.json',JSON.stringify(personal()));
 git('config','--local','user.name','PRIVATE_PROFILE_NAME');git('config','--local','user.email','private-profile@example.invalid');
 git('config','--local','branch.my.pushRemote','no_push');
 execFileSync(process.execPath,['tools/kit.js','hooks-install'],{cwd:tmp,stdio:'pipe'});
}
function files(dir=tmp){
 const values={};
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())Object.assign(values,files(p));else values[path.relative(tmp,p)]=e.isSymbolicLink()?fs.readlinkSync(p):crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
 return values;
}
try{
 git('init','-b','master');git('config','--local','user.name','Seed');git('config','--local','user.email','seed@example.invalid');write('seed.md','seed');git('add','seed.md');git('-c','commit.gpgsign=false','commit','-m','Seed');
 check('missing personal setup reports absence without inventing saved choices',()=>{
  const result=inspect(tmp);assert.equal(result.personal.state,'missing');assert.equal(result.personalReady,false);assert.equal(result.known.team,'unknown');
  assert.equal(result.personal.configPresent,false);
 });
 git('switch','-c','my','--no-track');ready();
 check('existing no-team local setup exports only safe facts',()=>{
  const before=files(),result=inspect(tmp);
  assert.equal(result.personalReady,true);assert.equal(result.personal.state,'ready');
  assert.deepEqual(result.known,{profile:'configured',team:'without-team',storage:'local'});
  assert.deepEqual(result.connections,{tasks:0,code:0,access:'not-checked'});
  assert.deepEqual(files(),before);
  for(const value of ['PRIVATE_PROFILE_NAME','private-profile@example.invalid'])assert.ok(!JSON.stringify(result).includes(value));
  const cli=spawnSync(process.execPath,['tools/kit.js','setup-status'],{cwd:tmp,encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),result);
  assert.deepEqual(Object.keys(result).sort(),['version','personalReady','personal','known','protection','connections','issues','summary'].sort());
  assert.notEqual(spawnSync(process.execPath,['tools/kit.js','setup-status','--instructions'],{cwd:tmp}).status,0);
  assert.notEqual(spawnSync(process.execPath,['tools/kit.js','setup-status','unexpected'],{cwd:tmp}).status,0);
 });
 check('declared connections do not imply verified access or export addresses',()=>{
  const store={kind:'jira',adapter:'adapters/jira/ADAPTER.md',mcpServer:'fixture',baseUrl:'https://PRIVATE_ENDPOINT.invalid',projects:['P']};
  write('config/my/config.json',JSON.stringify({...personal(),taskStores:[{...store,id:'active',enabled:true},{...store,id:'disabled',enabled:false}]}));
  const result=inspect(tmp);assert.equal(result.personalReady,true);assert.equal(result.connections.tasks,1);assert.equal(result.connections.access,'not-checked');assert.ok(!JSON.stringify(result).includes('PRIVATE_ENDPOINT'));
  write('config/my/config.json',JSON.stringify(personal()));
 });
 check('state inspection is independent of skill instructions',()=>{
  const dir=path.join(tmp,'.gigacode/skills'),hidden=path.join(tmp,'.gigacode/skills-hidden'),before=inspect(tmp);
  fs.renameSync(dir,hidden);try{assert.deepEqual(inspect(tmp),before);}finally{fs.renameSync(hidden,dir);}
 });
 check('selected team is preserved and no-team excludes an unrelated broken team layer',()=>{
  write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'Fixture Team',owners:[]},taskStores:[],codeStores:[],defaults:{}}));
  write('config/my/config.json',JSON.stringify({...personal(),teamId:'a'}));
  assert.equal(inspect(tmp).known.team,'selected');assert.equal(inspect(tmp).personalReady,true);
  write('config/my/config.json',JSON.stringify(personal()));write('config/team/config.json','PRIVATE_BROKEN_TEAM');
  assert.equal(inspect(tmp).personalReady,true);assert.equal(inspect(tmp).known.team,'without-team');
 });
 check('repository storage is reported without exporting its address',()=>{
  const url='https://private.invalid/PRIVATE_REMOTE';git('remote','add','mine',url);git('config','--local','branch.my.pushRemote','mine');
  write('config/my/config.json',JSON.stringify({...personal(),storage:{mode:'repository',repositoryUrl:url}}));
  const result=inspect(tmp);assert.equal(result.personalReady,true);assert.equal(result.known.storage,'repository');assert.ok(!JSON.stringify(result).includes(url));assert.ok(!JSON.stringify(result).includes('PRIVATE_REMOTE'));
 });
 check('every effective push address must match storage and differ from origin',()=>{
  const approved='https://private.invalid/PRIVATE_REMOTE',common='https://common.invalid/COMMON_REMOTE',other='https://other.invalid/UNAPPROVED_REMOTE';
  git('remote','add','origin',common);
  const rejected=()=>{const result=inspect(tmp);assert.equal(result.personalReady,false);assert.equal(result.protection.push,false);assert.ok(result.issues.includes('personal-push-mismatch'));assert.equal(result.known.storage,'repository');assert.ok(!JSON.stringify(result).includes('REMOTE'));};
  try{
   for(const address of [other,common]){git('config','--local','--replace-all','remote.mine.pushurl',address);rejected();}
   git('config','--local','--replace-all','remote.mine.pushurl',approved);assert.equal(inspect(tmp).personalReady,true);
   git('config','--local','--add','remote.mine.pushurl',other);rejected();
   git('config','--local','--replace-all','remote.mine.pushurl',approved);
   git('config','--local','remote.origin.pushurl',approved);rejected();
   git('config','--local','--unset-all','remote.origin.pushurl');
   git('remote','set-url','origin',approved);rejected();
  }finally{
   git('config','--local','--unset-all','remote.mine.pushurl');git('remote','remove','origin');
  }
  assert.equal(inspect(tmp).personalReady,true);
 });
 ready();
 check('missing protection cannot turn existing known choices into a fresh installation',()=>{
  fs.unlinkSync(path.join(tmp,'.git/hooks/pre-push'));
  const result=inspect(tmp);assert.equal(result.personalReady,false);assert.equal(result.known.team,'without-team');assert.equal(result.known.storage,'local');assert.ok(result.issues.includes('local-hooks-missing'));
 });
 ready();
 check('invalid personal config is never treated as absent and never leaks an error',()=>{
  write('config/my/config.json','{"PRIVATE_BROKEN https://private.invalid/?token=PRIVATE_TOKEN');
  const result=inspect(tmp);assert.equal(result.personal.state,'invalid');assert.ok(!JSON.stringify(result).includes('PRIVATE_'));assert.ok(!JSON.stringify(result).includes('private.invalid'));
 });
 fs.unlinkSync(myFile);write('private-target.json','PRIVATE_TARGET');
 let linked=false;
 try{fs.symlinkSync(path.join(tmp,'private-target.json'),myFile);linked=true;}
 catch(error){
  if(process.platform!=='win32'||!['EPERM','EACCES','ENOTSUP'].includes(error.code))throw error;
  console.log('↷ linked config: Windows does not permit file symlinks; other config checks remain mandatory');
 }
 if(linked)try{
  check('linked personal config is rejected without reading its target',()=>{
   const result=inspect(tmp);assert.equal(result.personal.state,'invalid');assert.ok(!JSON.stringify(result).includes('PRIVATE_TARGET'));
  });
 }finally{fs.unlinkSync(myFile);}
 ready();
 check('existing personal branch or config on another branch requires opening it, never recreation',()=>{
  git('switch','master');let result=inspect(tmp);assert.equal(result.personal.state,'outside-personal');
  fs.unlinkSync(myFile);result=inspect(tmp);assert.ok(result.issues.includes('open-existing-personal-copy'));
 });
 ready();
 check('custom hooks and profile mismatch require specific repair',()=>{
  git('config','--local','core.hooksPath','PRIVATE_CUSTOM_PATH');let result=inspect(tmp);assert.ok(result.issues.includes('custom-hooks-path'));assert.ok(!JSON.stringify(result).includes('PRIVATE_CUSTOM_PATH'));git('config','--local','--unset','core.hooksPath');
  git('config','--local','user.name','Different');result=inspect(tmp);assert.ok(result.issues.includes('local-profile-mismatch'));assert.equal(result.known.profile,'configured');
 });
 check('outside Git returns unknown instead of missing',()=>{
  const other=fixture({copy:false});try{const result=inspect(other.tmp);assert.equal(result.personal.state,'unknown');}finally{other.close();}
 });
 check('broken shared configuration does not get reported as a broken personal file',()=>{
  const file=path.join(tmp,'config/master/config.json'),bytes=fs.readFileSync(file);
  fs.writeFileSync(file,'PRIVATE_SHARED_ERROR');try{const result=inspect(tmp);assert.equal(result.personal.state,'unknown');assert.ok(result.issues.includes('shared-config-unavailable'));assert.ok(!result.issues.includes('personal-config-invalid'));assert.ok(!JSON.stringify(result).includes('PRIVATE_SHARED_ERROR'));}finally{fs.writeFileSync(file,bytes);}
 });
}finally{ctx.close();}

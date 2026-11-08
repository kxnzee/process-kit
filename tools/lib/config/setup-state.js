'use strict';
// Read-only application input. Export facts, never instructions, settings or raw errors.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {inside}=require('../core/safe-path'),{loadConfig,loadMaster}=require('./config');
function inspect(cwd){
 const git=(...args)=>{try{return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();}catch{return null;}};
 const result={version:1,personalReady:false,personal:{state:'unknown',configPresent:null,branch:'unknown'},known:{profile:'unknown',team:'unknown',storage:'unknown'},protection:{hooks:false,push:false},connections:{tasks:0,code:0,access:'not-checked'},issues:[],summary:[]};
 function finish(state){
  result.personal.state=state;
  if(state==='ready')result.summary.push('Личная копия уже настроена. Повторно создавать её не нужно.');
  if(result.known.team==='without-team')result.summary.push('Выбор «без команды» уже сохранён.');
  if(result.known.team==='selected')result.summary.push('Команда уже выбрана в личных настройках.');
  if(result.known.storage==='local')result.summary.push('Хранение только на этом компьютере уже выбрано.');
  if(result.known.storage==='repository')result.summary.push('Хранение в личном репозитории уже выбрано.');
  if(state==='ready')result.summary.push(result.connections.tasks+result.connections.code?'Подключения объявлены; доступ к системам ещё не проверен.':'Подключения к системам пока не настроены.');
  return result;
 }
 if(git('rev-parse','--is-inside-work-tree')!=='true'){result.issues.push('git-unavailable');return finish('unknown');}
 const branch=git('symbolic-ref','--quiet','--short','HEAD');
 if(branch===null){result.issues.push('branch-unavailable');return finish('unknown');}
 result.personal.branch=branch==='my'?'personal':'other';
 const hasMy=branch==='my'||git('show-ref','--verify','--quiet','refs/heads/my')!==null;
 try{loadMaster(cwd);}catch{
  result.issues.push('shared-config-unavailable');
  result.summary.push('Не удалось проверить общие настройки этой копии. Личную настройку менять пока нельзя.');
  return finish('unknown');
 }
 let my;
 try{
  const file=inside(cwd,'config/my/config.json');result.personal.configPresent=fs.existsSync(file);
  if(result.personal.configPresent){
   my=JSON.parse(fs.readFileSync(file,'utf8'));
   loadConfig(cwd,['master','my']);
  }
 }catch{result.issues.push('personal-config-invalid');return finish('invalid');}
 if(!result.personal.configPresent){
  if(hasMy){result.issues.push(branch==='my'?'personal-config-missing':'open-existing-personal-copy');return finish('incomplete');}
  return finish('missing');
 }
 result.known.profile='configured';
 result.known.team=my.teamId===null?'without-team':'selected';
 result.known.storage=my.storage.mode;
 let config;
 try{config=loadConfig(cwd);}catch{result.issues.push('selected-config-unavailable');return finish('incomplete');}
 result.connections.tasks=config.taskStores.filter(x=>x.enabled!==false).length;
 result.connections.code=config.codeStores.filter(x=>x.enabled!==false).length;
 if(branch!=='my'){result.issues.push('open-existing-personal-copy');return finish('outside-personal');}
 if(git('config','--local','--get','user.name')!==my.profile.name||git('config','--local','--get','user.email')!==my.profile.email)result.issues.push('local-profile-mismatch');
 if(git('rev-parse','--verify','HEAD')===null)result.issues.push('personal-history-missing');
 const customHooks=git('config','--get','core.hooksPath');
 result.protection.hooks=!customHooks&&['pre-commit','pre-push'].every(name=>{
  try{
   const hook=git('rev-parse','--git-path','hooks/'+name);if(hook===null)return false;
   const file=path.resolve(cwd,hook);if(fs.lstatSync(file).isSymbolicLink())return false;
   fs.accessSync(file,fs.constants.X_OK);
   return fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')===fs.readFileSync(inside(cwd,'.gigacode/hooks/'+name),'utf8').replace(/\r\n/g,'\n');
  }catch{return false;}
 });
 if(!result.protection.hooks)result.issues.push(customHooks?'custom-hooks-path':'local-hooks-missing');
 const push=git('config','--local','--get','branch.my.pushRemote'),upstream=git('rev-parse','--abbrev-ref','@{upstream}');
 let destinationMatches=push==='no_push';
 if(my.storage.mode==='repository'){
  const addresses=(...args)=>(git('remote','get-url',...args)||'').split(/\r?\n/).filter(Boolean);
  const own=addresses('--push','--all','mine');
  const common=[...addresses('--all','origin'),...addresses('--push','--all','origin')];
  destinationMatches=push==='mine'&&git('remote','get-url','mine')===my.storage.repositoryUrl&&own.length>0&&own.every(address=>address===my.storage.repositoryUrl&&!common.includes(address));
 }
 result.protection.push=upstream===null&&destinationMatches;
 if(!result.protection.push)result.issues.push('personal-push-mismatch');
 if(result.issues.length)return finish('incomplete');
 result.personalReady=true;return finish('ready');
}
module.exports={inspect};
if(require.main===module){
 const args=process.argv.slice(2);
 if(args.length){console.error('Использование: node tools/kit.js setup-status');process.exitCode=2;}
 else console.log(JSON.stringify(inspect(process.cwd()),null,2));
}

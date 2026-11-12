'use strict';
// Shared read-only scope and receipt facts. No definition modules or live systems.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {inside}=require('../core/safe-path'),{owner,allowedReference}=require('./process-model');
const {current,validReceipt}=require('./process-release');
function scopeFor(cwd,options={},issue=()=>{}){
 if(Object.keys(options).some(key=>!['level','team'].includes(key))||options.level!==undefined&&!['master','team','my'].includes(options.level)||options.team!==undefined&&(!/^[a-z0-9]+$/.test(options.team)||options.level!=='team'))throw new Error('Нужны --level master|team|my и, при необходимости, --team <код> для team');
 let branch=null;
 try{branch=execFileSync('git',['symbolic-ref','--quiet','--short','HEAD'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();}catch{}
 const base=branch?.match(/^promote\/(master|team-[a-z0-9]+)\/.+$/)?.[1]||branch;
 const branchTeam=base?.match(/^team-([a-z0-9]+)$/)?.[1];
 const scope={level:options.level||(base==='my'?'my':/^master(?:-|$)/.test(base||'')?'master':branchTeam?'team':null),teamId:null,personal:false};
 if(!scope.level)issue('scope-unknown');
 if(scope.level==='team'||scope.level==='my'){
  try{
   const config=require('../config/config').loadConfig(cwd);
   if(scope.level==='my'&&!config.files.includes('config/my/config.json'))throw new Error('No personal config');
   if(scope.level==='team'&&(!config.teamId||(options.team||branchTeam)&&config.teamId!==(options.team||branchTeam)))throw new Error('Team mismatch');
   scope.teamId=config.teamId;scope.personal=scope.level==='my';
  }catch{issue('scope-unavailable');}
 }
 return scope;
}
function visible(name,scope){
 const ownership=owner(name);
 return !(ownership.level===2&&!scope.personal||ownership.level===1&&ownership.team!==scope.teamId);
}
function visibleFile(file,name,scope){
 if(!canonicalFile(file))return false;
 const [folder,ref]=file.split('/');
 if(['processes','actions'].includes(folder))return /^[a-z0-9][a-z0-9-]*$/.test(ref||'')&&visible(ref,scope)&&allowedReference(name,ref);
 return folder==='context'&&['master','team','my'].includes(ref)&&{master:0,team:1,my:2}[ref]<=owner(name).level&&(ref!=='team'||!!scope.teamId)&&(ref!=='my'||scope.personal);
}
function canonicalFile(file){return typeof file==='string'&&!file.includes('\\')&&!file.split('/').some(part=>!part||part==='.'||part==='..');}
function publicationFacts(cwd,name,scope,issue){
 const file=`processes/${name}/publication.json`;
 try{
  const full=inside(cwd,file);
  if(!fs.existsSync(full))return {status:'draft',current:false};
  const receipt=JSON.parse(fs.readFileSync(full,'utf8'));
  if(!validReceipt(receipt,name)||!Object.entries(receipt.files).every(([file,digest])=>typeof digest==='string'&&visibleFile(file,name,scope))||receipt.status!=='validated'&&receipt.outputs.some(output=>typeof output!=='string'||!output))throw new Error('Invalid receipt');
  const valid=current(cwd,receipt,name);
  return {status:valid?receipt.status:'stale',current:valid};
 }catch{issue('publication-unavailable',file);return {status:'unknown',current:false};}
}
module.exports={scopeFor,visible,visibleFile,canonicalFile,publicationFacts};

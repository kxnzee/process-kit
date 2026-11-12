'use strict';
// Discovery facts only. Never validate a route, load its executable modules or check the network.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {inside}=require('../core/safe-path'),{parseFrontmatter}=require('../core/markdown');
const {NAME,owner}=require('./process-model'),{current,validReceipt}=require('./process-release');

function catalog(cwd,options={}){
 if(Object.keys(options).some(key=>!['level','team'].includes(key))||options.level!==undefined&&!['master','team','my'].includes(options.level)||options.team!==undefined&&(!/^[a-z0-9]+$/.test(options.team)||options.level!=='team'))throw new Error('Нужны --level master|team|my и, при необходимости, --team <код> для team');
 const issues=[];
 const issue=(code,file)=>issues.push({code,...(file?{file}:{})});
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
 const processes=[];
 // Failure to read the root is fatal; a broken visible entry produces an explicit partial catalog.
 const entries=fs.readdirSync(inside(cwd,'processes'),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
 for(const entry of entries){
  const ownership=owner(entry.name);
  if(ownership.level===2&&!scope.personal||ownership.level===1&&ownership.team!==scope.teamId)continue;
  if(!NAME.test(entry.name)){if(entry.isDirectory()||entry.isSymbolicLink())issue('invalid-entry');continue;}
  if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
  const file=`processes/${entry.name}/PROCESS.md`;
  let data,examples;
  try{
   const parsed=parseFrontmatter(fs.readFileSync(inside(cwd,file),'utf8'));data=parsed.data;
   examples=data?.examples??data?.example;examples=Array.isArray(examples)?examples:[examples];
   if(parsed.error||!data||data.name!==entry.name||typeof data.description!=='string'||!data.description.trim()||data.title!==undefined&&(typeof data.title!=='string'||!data.title.trim())||!['действует','устарел'].includes(data.status)||!examples.length||examples.some(value=>typeof value!=='string'||!value.trim()))throw new Error('Invalid metadata');
  }catch{issue('metadata-unavailable',file);continue;}
  let publication={status:'draft',current:false};
  const receiptFile=`processes/${entry.name}/publication.json`;
  try{
   const full=inside(cwd,receiptFile);
   if(fs.existsSync(full)){
    const receipt=JSON.parse(fs.readFileSync(full,'utf8'));
    if(!validReceipt(receipt,entry.name))throw new Error('Invalid receipt');
    const valid=current(cwd,receipt,entry.name);
    publication={status:valid?receipt.status:'stale',current:valid};
   }
  }catch{publication={status:'unknown',current:false};issue('publication-unavailable',receiptFile);}
  processes.push({name:data.name,file,title:data.title||data.name,description:data.description,examples,level:['master','team','my'][ownership.level],teamId:ownership.team,educational:entry.name==='example',status:data.status,publication});
 }
 return {version:1,complete:issues.length===0,scope,processes,issues};
}
module.exports={catalog};
if(require.main===module){
 try{
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--level','--team'].includes(key)||!args[i+1]||Object.hasOwn(options,key.slice(2)))throw new Error('Arguments');options[key.slice(2)]=args[i+1];}
  console.log(JSON.stringify(catalog(process.cwd(),options),null,2));
 }catch{console.error('Не удалось получить каталог процессов. Использование: node tools/kit.js processes [--level master|team|my] [--team <код>]. Проверьте корень копии и область просмотра.');process.exitCode=1;}
}

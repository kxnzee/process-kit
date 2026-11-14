'use strict';
// Shared read-only scope and receipt facts. No definition modules or live systems.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {inside}=require('../core/safe-path'),{owner,allowedReference,processModel,NAME}=require('./process-model');
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
// Public GigaCode admission. Parse the complete declared tree before loading any JS.
// Core embedding APIs remain a trusted-host boundary, not a JavaScript sandbox.
function accessRules(cwd){
 const scope=scopeFor(cwd);
 function allowed(ref,from){
  if(typeof ref!=='string'||!NAME.test(ref)||!visible(ref,scope)||from&&!allowedReference(from,ref))throw new Error('Определение недоступно по уровню владения');
 }
 function resources(value,from,literals=new Set()){
  if(Array.isArray(value)){for(const item of value)resources(item,from);return;}
  if(value&&typeof value==='object'){for(const [key,item] of Object.entries(value))if(!literals.has(key))resources(item,from);return;}
  if(typeof value!=='string')return;
  if(/^[{[]/.test(value.trimStart())){let parsed;try{parsed=JSON.parse(value);}catch{}if(parsed&&typeof parsed==='object'){resources(parsed,from);return;}}
  const resource=value.match(/^(processes|actions|adapters)\/([^/]+)(?:\/|$)/);
  if(resource)allowed(resource[2],from);
  if(value.startsWith('context/')&&!visibleFile(value,from,scope))throw new Error('Ресурс недоступен по уровню владения');
 }
 function paths(value,from){
  if(value===undefined)return;
  if(!Array.isArray(value)||value.some(file=>!canonicalFile(file)||!(/^(processes|actions|adapters|context|tools|config|docs)\//.test(file)||file==='.gigacode/settings.json')))throw new Error('Нужен список канонических относительных путей файлов');
  for(const file of value)resources(file,from);
 }
 return {allowed,resources,paths};
}
function assertActionAccess(cwd,name){
 const {allowed,paths}=accessRules(cwd);allowed(name);
 const meta=require('../core/markdown').parseFrontmatter(fs.readFileSync(inside(cwd,`actions/${name}/ACTION.md`),'utf8')).data||{};
 paths(meta.requiresFiles,name);
}
function assertDiagnosticAccess(cwd,output){
 if(!require('../core/paths').validRunFolderName(output))throw new Error('Неверный output');
 const {allowed}=accessRules(cwd),dir=inside(cwd,`outputs/${output}/.run`),roots=new Set(),names=new Set();
 const parse=text=>{try{return JSON.parse(text);}catch{return null;}};
 const read=file=>{try{return fs.readFileSync(inside(dir,file),'utf8');}catch{return '';}};
 function state(value){
  if(value?.identity?.process!==undefined){roots.add(value.identity.process);names.add(value.identity.process);}
  if(value?.cursorProcess!==undefined)names.add(value.cursorProcess);
 }
 function trace(text){for(const line of String(text||'').split('\n')){
  const event=parse(line);if(!event||typeof event!=='object')continue;
  if(event.process!==undefined)names.add(event.process);
  if(event.type==='started'&&event.process!==undefined)roots.add(event.process);
 }}
 state(parse(read('state.json')));
 const transaction=parse(read('transaction.json'));
 state(parse(transaction?.state));trace(transaction?.trace);trace(read('trace.jsonl'));
 if(!roots.size)throw new Error('Невозможно определить владельца запуска для диагностики');
 for(const name of names)allowed(name);
}
function assertAccess(cwd,name,params={},files=[]){
 const {allowed,resources,paths}=accessRules(cwd),{stepParams,childParams,action:metadata,literalParams}=require('./process-dependencies');
 const maxDepth=require('../config/config').loadMaster(cwd).execution.maxProcessDepth;
 const checks=[],bindings=[],literals=new Set();
 function visit(ref,inherited,stack=[]){
  allowed(ref,stack.at(-1));
  if(stack.includes(ref)||stack.length>=maxDepth)throw new Error('Цикл или глубина подпроцессов');
  const model=processModel(fs.readFileSync(inside(cwd,`processes/${ref}/PROCESS.md`),'utf8'));
  const declared=model.data.requires||{},values={...model.data.params,...inherited};
  checks.push({values,ref,strict:!!model.data.branchRule});
  for(const step of model.steps)bindings.push(...Object.entries(step.params));
  const actions=new Set([...(Array.isArray(declared.actions)?declared.actions:[]),...model.steps.filter(s=>s.kind==='action').map(s=>s.ref)]);
  for(const action of actions){
   allowed(action,ref);
   const meta=metadata(cwd,action);for(const key of literalParams(meta))literals.add(key);
   paths(meta.requiresFiles,action);
   for(const step of model.steps.filter(s=>s.kind==='action'&&s.ref===action)){
    const effective=stepParams(values,step,params,{},meta.defaults);checks.push({values:effective,ref,meta});
    for(const key of ['query','template','rule'])if(NAME.test(effective[key]||''))allowed(effective[key],ref);
   }
  }
  const children=new Set(Array.isArray(declared.processes)?declared.processes:[]);
  for(const step of model.steps.filter(s=>s.kind==='process')){
   allowed(step.ref,ref);children.delete(step.ref);
   visit(step.ref,childParams(cwd,model,step,values,{},params),[...stack,ref]);
  }
  for(const child of children)visit(child,values,[...stack,ref]);
 }
 visit(name,params);
 // Follow literal bindings as data. Every actual nonliteral use is still checked.
 let changed=true;
 while(changed){changed=false;for(const [key,value] of bindings)if(literals.has(key))for(const match of (JSON.stringify(value)||'').matchAll(/\{params\.([^}]+)\}/g))if(!literals.has(match[1])){literals.add(match[1]);changed=true;}}
 for(const {values,ref,meta,strict} of checks){
  const own=new Set(meta?literalParams(meta):[]),skip=new Set([...literals].filter(key=>!strict&&(!meta||!meta.consumes.params.includes(key)||own.has(key))));
  resources(values,ref,skip);
 }
 paths(files,name);
}
function visibleFile(file,name,scope){
 if(!canonicalFile(file))return false;
 const [folder,ref]=file.split('/');
 if(['processes','actions'].includes(folder))return /^[a-z0-9][a-z0-9-]*$/.test(ref||'')&&visible(ref,scope)&&allowedReference(name,ref);
 return folder==='context'&&['master','team','my'].includes(ref)&&{master:0,team:1,my:2}[ref]<=owner(name).level&&(ref!=='team'||!!scope.teamId)&&(ref!=='my'||scope.personal);
}
function canonicalFile(file){return typeof file==='string'&&!/^[a-zA-Z]:/.test(file)&&!file.includes('\\')&&!file.split('/').some(part=>!part||part==='.'||part==='..');}
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
module.exports={assertDiagnosticAccess,assertActionAccess,assertAccess,scopeFor,visible,visibleFile,canonicalFile,publicationFacts};

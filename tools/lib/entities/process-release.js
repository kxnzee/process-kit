#!/usr/bin/env node
'use strict';
// Definition lifecycle receipt, beside its owner. Does not execute a process or publish to Git.
const fs=require('node:fs');
const {inside}=require('../core/safe-path'),{root}=require('../core/paths');
const {validateDefinition}=require('./process-definition'),{dependencies}=require('./process-dependencies');
const {atomic,hash}=require('../runtime/run-storage');
const relevant=file=>/^(processes|actions|context)\//.test(file)&&!file.endsWith('/publication.json');
function snapshot(cwd,files){return Object.fromEntries([...new Set(files)].filter(relevant).sort().map(file=>[file,hash(fs.readFileSync(inside(cwd,file)))]));}
function validReceipt(receipt,process=receipt?.process){
 if(!receipt||receipt.schemaVersion!==1||receipt.process!==process||!['validated','tested','published'].includes(receipt.status)||!receipt.files||Array.isArray(receipt.files)||!Object.hasOwn(receipt.files,`processes/${process}/PROCESS.md`))return false;
 if(receipt.status!=='validated'&&(receipt.scope!=='local/demo'||!Array.isArray(receipt.outputs)||!receipt.outputs.length))return false;
 return Object.entries(receipt.files).every(([file,digest])=>relevant(file)&&/^[a-f0-9]{64}$/.test(digest));
}
function current(cwd,receipt,process=receipt?.process){
 try{
  if(!validReceipt(receipt,process))return false;
  return Object.entries(receipt.files).every(([file,digest])=>hash(fs.readFileSync(inside(cwd,file)))===digest);
 }catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function assertPublished(cwd,name,files=[]){
 validateDefinition(cwd,name);
 const file=inside(cwd,`processes/${name}/publication.json`);
 const receipt=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 if(receipt?.status!=='published'||receipt.process!==name||!current(cwd,receipt))throw new Error('Определение не опубликовано или изменилось после проверки: выполните definition validate/test/publish');
 for(const [file,digest]of Object.entries(snapshot(cwd,files)))if(receipt.files[file]!==digest)throw new Error('Выбранная зависимость не проверена при публикации: '+file);
}
function assertPublishedTree(cwd,name,params,mode,overrides,files){
 const model=validateDefinition(cwd,name);
 assertPublished(cwd,name,(files||dependencies(cwd,name,params,mode,[],overrides)).filter(f=>f!==params.dataFile));
 const {childParams}=require('./process-dependencies');
 for(const step of model.steps.filter(s=>s.kind==='process'))assertPublishedTree(cwd,step.ref,childParams(cwd,model,step,params,{},overrides),mode,overrides);
}
function lifecycle(cwd,operation,spec){
 const model=validateDefinition(cwd,spec.process),file=inside(cwd,`processes/${spec.process}/publication.json`);
 const previous=operation!=='validate'&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 if(operation==='status')return {process:spec.process,status:current(cwd,previous,spec.process)?previous.status:'draft',policy:model.data.publication||'required',scope:previous?.scope||null};
 if(!['validate','test','publish'].includes(operation))throw new Error('Нужна операция validate/test/publish/status');
 let receipt;
 if(operation==='validate'){
  const params={...model.data.params,...spec.params};
  const files=dependencies(cwd,spec.process,params,spec.mode==='demo'?'demo':'local',[],spec.params||{}).filter(f=>f!==params.dataFile);
  receipt={schemaVersion:1,process:spec.process,status:'validated',files:snapshot(cwd,files)};
 }else{
  if(previous?.process!==spec.process||!current(cwd,previous))throw new Error('Сначала definition validate для текущей версии');
  receipt=previous;
  if(operation==='test'){
   if(!Array.isArray(spec.outputs)||!spec.outputs.length)throw new Error('Нужны outputs завершённых проверочных прогонов');
   const covered=new Set(),allFiles=new Set(Object.keys(previous.files));
   for(const output of spec.outputs){
    const card=require('../runtime/run-journal').operation(cwd,'next',{output});
    const dir=inside(cwd,`outputs/${output}/.run`),state=JSON.parse(fs.readFileSync(inside(dir,'state.json'),'utf8'));
    if(card.status!=='completed'||state.identity.process!==spec.process||!state.identity.definitionTest||!['local','demo'].includes(state.identity.mode))throw new Error('Требуется завершённый local/demo definitionTest текущего процесса');
    for(const f of Object.keys(state.identity.files))if(f!==state.identity.params.dataFile)allFiles.add(f);
    const rows=fs.readFileSync(inside(dir,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    for(const e of rows)if(e.type==='branch_decision')covered.add(`${e.process}:${e.step}:${e.next}`);
   }
   const seen=new Set();
   function coverage(name){
    if(seen.has(name))return;seen.add(name);const m=validateDefinition(cwd,name);
    for(const step of m.steps){
     if(step.kind==='branch')for(const target of step.targets)if(!covered.has(`${name}:${step.name}:${target}`))throw new Error(`Не проверена ветка ${name}:${step.name} → ${target}`);
     if(step.kind==='process')coverage(step.ref);
    }
   }
   coverage(spec.process);
   receipt={...receipt,status:'tested',files:snapshot(cwd,[...allFiles]),scope:'local/demo',outputs:spec.outputs};
  }else{
   if(previous.status!=='tested'&&previous.status!=='published')throw new Error('Сначала definition test с проверенными маршрутами');
   receipt={...receipt,status:'published'};
  }
 }
 receipt.updated=new Date().toISOString();atomic(file,receipt);
 return {process:spec.process,status:receipt.status,file,scope:receipt.scope||null};
}
module.exports={assertPublished,assertPublishedTree,lifecycle,current,validReceipt};
if(require.main===module){try{const [operation,file,...rest]=process.argv.slice(2);if(!file||rest.length)throw new Error('node tools/kit.js definition <validate|test|publish|status> <spec.json>');console.log(JSON.stringify(lifecycle(root(),operation,JSON.parse(fs.readFileSync(file,'utf8'))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}

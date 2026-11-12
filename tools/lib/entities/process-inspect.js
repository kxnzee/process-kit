'use strict';
// Static facts for authoring, including incomplete definitions. Never require owner code.
const fs=require('node:fs');
const {inside}=require('../core/safe-path'),{parseFrontmatter}=require('../core/markdown');
const {processModel,NAME,owner,allowedReference}=require('./process-model');
const {scopeFor,visible,visibleFile,canonicalFile,publicationFacts}=require('./process-facts');

function inspect(cwd,spec){
 if(!spec||typeof spec!=='object'||Array.isArray(spec)||Object.keys(spec).some(key=>!['process','level','team'].includes(key))||typeof spec.process!=='string'||!NAME.test(spec.process))throw new Error('inspect: нужны process и необязательные level/team');
 const name=spec.process,issues=[],items=[],seen=new Set();
 const issue=(code,file)=>{if(!issues.some(item=>item.code===code&&item.file===file))issues.push({code,...(file?{file}:{})});};
 const scope=scopeFor(cwd,Object.fromEntries(Object.entries(spec).filter(([key])=>key!=='process')),issue);
 const file=`processes/${name}/PROCESS.md`;
 const result={version:1,process:name,scope,definition:{status:'unavailable'},dependencies:{coverage:'static-only',items},publication:{status:'unknown',current:false},issues,
  limitations:['No definition code executed; dynamic dependencies and connections are not checked.','Parsed files and current receipt hashes do not prove validity, readiness or completion of the user task.']};
 if(!visible(name,scope)){issue('ownership-unavailable');return result;}
 function probe(file,directory=false){
  try{const full=inside(cwd,file),stat=fs.statSync(full);return (directory?stat.isDirectory():stat.isFile())?'present':'unavailable';}
  catch(error){return error.code==='ENOENT'?'missing':'unavailable';}
 }
 function resource(file,from){
  if(!visibleFile(file,from,scope)&&!(canonicalFile(file)&&/^tools\/[a-zA-Z0-9_./-]+$/.test(file))){issue('dependency-path-unavailable');return;}
  const status=probe(file);items.push({kind:'file',file,status});if(status!=='present')issue('dependency-'+status,file);
 }
 function entity(kind,ref,from,stack=[]){
  if(typeof ref!=='string'||!NAME.test(ref)){issue('dependency-invalid');return;}
  const folder=kind==='process'?'processes':'actions',file=`${folder}/${ref}/${kind==='process'?'PROCESS':'ACTION'}.md`;
  // Both reference hierarchy and configured team/personal scope apply before any read.
  if(!allowedReference(from,ref)||!visible(ref,scope)){items.push({kind,name:ref,status:'forbidden'});issue('dependency-forbidden');return;}
  if(stack.includes(ref)&&kind==='process'){issue('dependency-cycle',file);return;}
  const key=kind+':'+ref;if(seen.has(key))return;seen.add(key);
  const status=probe(file),item={kind,name:ref,file,status};items.push(item);
  if(status!=='present'){issue('dependency-'+status,file);return;}
  let text,parsed;
  try{text=fs.readFileSync(inside(cwd,file),'utf8');parsed=parseFrontmatter(text);}catch{item.status='unavailable';issue('dependency-unavailable',file);return;}
  if(!parsed.data||parsed.error){item.metadata='partial';issue('metadata-partial',file);return;}
  const data=parsed.data;item.metadata=data.name===ref?'parsed':'partial';
  if(data.name!==ref)issue('metadata-partial',file);
  if(kind==='process')return visit(ref,text,[...stack,ref]);
  // Only literal header paths. Runtime dependency callbacks, adapters and scripts stay unloaded.
  if(data.runtime!==undefined){if(data.runtime==='runtime.js')resource(`actions/${ref}/runtime.js`,ref);else issue('dependency-invalid',file);}
  if(data.requiresFiles!==undefined){
   if(!Array.isArray(data.requiresFiles))issue('dependency-invalid',file);
   else for(const value of data.requiresFiles)resource(value,ref);
  }
  if(data.contracts!==undefined){
   if(!data.contracts||typeof data.contracts!=='object'||Array.isArray(data.contracts))issue('dependency-invalid',file);
   else for(const value of Object.values(data.contracts))if(value!=='text'){
    if(typeof value==='string'&&/^contracts\/[a-z0-9][a-z0-9.-]*\.json$/.test(value))resource(`actions/${ref}/${value}`,ref);else issue('dependency-invalid',file);
   }
  }
 }
 function visit(ref,text,stack){
  const file=`processes/${ref}/PROCESS.md`,model=processModel(text),data=model.data;
  const missing=['name','version','area','status','description'].filter(key=>typeof data[key]!=='string'||!data[key].trim());
  if(!data.example&&!(Array.isArray(data.examples)&&data.examples.length))missing.push('example/examples');
  if(data.name!==ref||missing.length)issue('metadata-partial',file);
  if(model.errors.length)issue('structure-partial',file);
  if(ref===name){
   const metadata=Object.fromEntries(['name','title','version','area','status','description','publication'].filter(key=>typeof data[key]==='string').map(key=>[key,data[key]]));
   result.definition={status:missing.length||data.name!==ref||model.errors.length?'partial':'parsed',metadata,missingFields:missing,structure:{steps:model.steps.length,problems:model.errors.length}};
  }
  const req=data.requires;
  if(!req||typeof req!=='object'||Array.isArray(req)){issue('declarations-partial',file);}
  const declared=req&&typeof req==='object'&&!Array.isArray(req)?req:{};
  if(Object.keys(declared).some(key=>!['actions','processes','context','config'].includes(key)))issue('declarations-partial',file);
  for(const [key,kind]of [['actions','action'],['processes','process']]){
   const values=declared[key]??[];
   if(!Array.isArray(values)){issue('declarations-partial',file);}
   const refs=Array.isArray(values)?values:[];
   if(new Set(refs).size!==refs.length)issue('declarations-partial',file);
   for(const step of model.steps.filter(step=>step.kind===kind)){
    if(!refs.includes(step.ref))issue('dependency-undeclared',file);
   }
   for(const target of new Set([...refs,...model.steps.filter(step=>step.kind===kind).map(step=>step.ref)]))entity(kind,target,ref,stack);
  }
  for(const key of ['context','config']){
   const values=declared[key]??[];
   if(!Array.isArray(values)||new Set(values).size!==values.length){issue('declarations-partial',file);continue;}
   for(const level of values){
    if(!['master','team','my'].includes(level)){issue('dependency-invalid',file);continue;}
    const rank={master:0,team:1,my:2}[level];
    // Config levels select the caller's environment; they are not entity ownership.
    if(key==='context'&&(rank>owner(ref).level||level==='team'&&!scope.teamId||level==='my'&&!scope.personal)){items.push({kind:key,name:level,status:'forbidden'});issue('dependency-forbidden');continue;}
    const entry=key==='config'?`config/${level}/config.json`:`context/${level}`;
    const status=probe(entry,key==='context');items.push({kind:key,name:level,file:entry,status});if(status!=='present')issue('dependency-'+status,entry);
   }
  }
  if(data.branchRule!==undefined){
   if(typeof data.branchRule==='string'&&/^rules\/[a-z0-9][a-z0-9.-]*\.js$/.test(data.branchRule))resource(`processes/${ref}/${data.branchRule}`,ref);else issue('dependency-invalid',file);
  }
 }
 const status=probe(file);
 if(status!=='present'){result.definition.status=status;issue('definition-'+status,file);}
 else{
  try{const text=fs.readFileSync(inside(cwd,file),'utf8');seen.add('process:'+name);visit(name,text,[name]);}
  catch{result.definition={status:'unavailable'};issue('definition-unavailable',file);}
 }
 result.publication=publicationFacts(cwd,name,scope,issue);
 return result;
}
module.exports={inspect};

'use strict';
// Resolve declared files only. Does not execute steps, inspect expected data or choose branches.
const fs=require('node:fs');
const {inside}=require('../core/safe-path'),{processModel,parameter,NAME,allowedReference}=require('./process-model'),{parseFrontmatter}=require('../core/markdown'),{loadContract}=require('../contracts/value-contract');
function action(cwd,name){
 if(!NAME.test(name||''))throw new Error('Неверное действие');const data=parseFrontmatter(fs.readFileSync(inside(cwd,`actions/${name}/ACTION.md`),'utf8')).data;
 if(!data||data.name!==name||!data.produces||typeof data.produces!=='object'||Array.isArray(data.produces)||Object.keys(data.produces).length!==1||Object.entries(data.produces).some(([key,value])=>!NAME.test(key)||typeof value!=='string'||!value.trim()))throw new Error('Неверное определение действия '+name);
 if(!['source','transform','act'].includes(data.kind)||!data.consumes||!['artifacts','params'].every(k=>Array.isArray(data.consumes[k])&&data.consumes[k].every(v=>typeof v==='string')&&new Set(data.consumes[k]).size===data.consumes[k].length))throw new Error('Неверный вход действия '+name);
 if(!data.contracts||Object.keys(data.contracts).length!==1||Object.keys(data.produces).some(k=>!Object.hasOwn(data.contracts,k)))throw new Error('Нужен контракт каждого выхода '+name);
 for(const ref of Object.values(data.contracts))if(ref!=='text'&&!/^contracts\/[a-z0-9][a-z0-9.-]*\.json$/.test(ref))throw new Error('Неверный путь контракта '+name);
 if(data.runtime&&data.runtime!=='runtime.js')throw new Error('runtime должен быть runtime.js');
 if(data.requiresFiles&&!Array.isArray(data.requiresFiles))throw new Error('requiresFiles: нужен список');
 return data;
}
function bind(value,params,artifacts={}){
 if(Array.isArray(value))return value.map(item=>bind(item,params,artifacts));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,bind(item,params,artifacts)]));
 if(typeof value!=='string')return value;
 const exact=value.match(/^\{params\.([^}]+)\}$/);if(exact)return params[exact[1]];
 if(/^[{[]/.test(value)){try{return bind(JSON.parse(value),params,artifacts);}catch(error){if(!(error instanceof SyntaxError))throw error;}}
 return value.replace(/\{params\.([^}]+)\}|\{([a-z0-9-]+)\}/g,(text,key,artifact)=>key?(params[key]??text):(artifacts[artifact]??text));
}
function stepParams(params,step,overrides={},artifacts={}){
 const scope={...params,...overrides};
 return {...scope,...Object.fromEntries(Object.entries(step.params).map(([key,value])=>[key,bind(value,scope,artifacts)])),...overrides};
}
function childParams(cwd,parent,step,params,artifacts={},overrides={}){
 const child=processModel(fs.readFileSync(inside(cwd,`processes/${step.ref}/PROCESS.md`),'utf8'));
 const scope={...params,...overrides};
 return {...params,...child.data.params,...Object.fromEntries(Object.entries(step.params).map(([key,value])=>[key,bind(value,scope,artifacts)])),...overrides};
}
function dependencies(cwd,name,params={},mode='local',extras=[],overrides=params){
 const files=new Set(),visiting=new Set();const include=file=>{const full=inside(cwd,file);if(!fs.statSync(full).isFile())throw new Error('Нет файла '+file);files.add(file);return fs.readFileSync(full,'utf8');};
 function entityFiles(folder){for(const item of fs.readdirSync(inside(cwd,folder),{withFileTypes:true})){const file=folder+'/'+item.name;if(item.isDirectory())entityFiles(file);else include(file);}}
 const maxDepth=require('../config/config').loadMaster(cwd).execution.maxProcessDepth;include('config/master/config.json');
 if(mode==='live')include('.gigacode/settings.json');
 function visit(process,values,depth=0){
  if(!NAME.test(process)||visiting.has(process)||depth>=maxDepth)throw new Error('Цикл или глубина подпроцессов');visiting.add(process);
  const model=processModel(include(`processes/${process}/PROCESS.md`));require('./entities').declarations(cwd,process,model);values={...model.data.params,...values};if(model.errors.length)throw new Error(model.errors.join('; '));
  for(const level of model.data.requires?.context||[])for(const file of require('./context').contextLevel(cwd,process,level))include(file);
  if(model.data.requires?.context?.includes('team'))for(const file of require('../config/config').loadConfig(cwd).files)include(file);
  const config=mode==='live'&&model.data.requires?.config?.length?require('../config/config').loadConfig(cwd,model.data.requires.config):null;
  if(config)for(const file of config.files)include(file);
  for(const ref of model.data.requires?.actions||[])entityFiles('actions/'+ref);
  for(const step of model.steps){
   if(step.kind==='process'){if(!allowedReference(process,step.ref))throw new Error('Ссылка вниз по уровням');visit(step.ref,childParams(cwd,model,step,values,{},overrides),depth+1);continue;}
   if(step.kind!=='action')continue;
   if(!allowedReference(process,step.ref))throw new Error('Ссылка вниз по уровням');include(`actions/${step.ref}/ACTION.md`);const meta=action(cwd,step.ref);
   for(const [key,folder]of Object.entries({query:'queries',template:'templates',rule:'rules'}))if(meta.consumes?.params?.includes(key)){
    const selected=parameter({...model,data:{...model.data,params:values}},step,key,overrides);if(!NAME.test(selected||'')||!allowedReference(process,selected))throw new Error('Неверный/отсутствующий '+key+' для '+step.ref);include(`actions/${step.ref}/${folder}/${selected}.md`);
   }
   const effective=stepParams(values,step,overrides);
   const context={cwd,processName:process,actionName:step.ref,meta,params:effective,mode,preflight:true};
   if(meta.runtime)include(`actions/${step.ref}/${meta.runtime}`);
   for(const file of meta.requiresFiles||[])include(file);
   const policy=require('../actions/action-runtime').runtime(cwd,step.ref,meta);
   for(const file of policy.dependencies?.(context)||[])include(file);
   const recipe=fs.readFileSync(inside(cwd,`actions/${step.ref}/ACTION.md`),'utf8');
   for(const m of recipe.matchAll(/(?:^|[\s`(])((?:rules|templates|queries)\/[a-z0-9][a-z0-9.-]*\.md)/gm))include(`actions/${step.ref}/${m[1]}`);
   for(const ref of Object.values(meta.contracts))if(ref.startsWith('contracts/')){include(`actions/${step.ref}/${ref}`);loadContract(cwd,`actions/${step.ref}/${ref}`);}
   if(mode==='live'&&meta.kind!=='transform')for(const slot of ['taskStore','codeStore'])if(meta.consumes.params.includes(slot)){
    if(!config)throw new Error('requires.config не объявлен для сетевого шага');
    const fields=require('../config/config').requiredFields(cwd,process,effective);
    const selected=require('../config/config').resolveStore(cwd,config,slot,effective[slot],fields);include(selected.adapterFile);
   }
  }
  visiting.delete(process);
 }
 visit(name,params);
 for(const file of extras)if(!files.has(file)){
  if(file.startsWith('context/'))require('../actions/action-support').resource(cwd,name,file);
  if(!/^(processes|actions|context|adapters|config|docs|tools)\//.test(file)&&file!=='.gigacode/settings.json')throw new Error('Неверный дополнительный файл');include(file);
 }
 if(params.dataFile){if(mode!=='demo')throw new Error('dataFile только для demo');include(params.dataFile);}
 for(const file of ['tools/kit.js','tools/lib/runtime/run-journal.js','tools/lib/entities/process-dependencies.js','tools/lib/contracts/value-contract.js','tools/lib/contracts/artifact-contract.js','tools/lib/core/safe-path.js','tools/lib/entities/process-model.js','tools/lib/core/markdown.js','tools/lib/runtime/history.js','tools/lib/core/paths.js','tools/lib/actions/action-runtime.js','tools/lib/config/config.js','tools/lib/config/config-contract.js','tools/lib/entities/context.js','tools/lib/entities/entities.js'])include(file);
 return [...files].sort();
}
// Possible final ports; callers without an explicit alias can rely only on a single common port.
function resultPorts(cwd,name,stack=[]){
 if(stack.includes(name)||stack.length>=require('../config/config').loadMaster(cwd).execution.maxProcessDepth)throw new Error('Цикл подпроцессов');
 const model=processModel(fs.readFileSync(inside(cwd,`processes/${name}/PROCESS.md`),'utf8'));if(model.errors.length)throw new Error(model.errors.join('; '));
 const found=new Set();
 function visit(at,last,active=new Set()){
  if(at==='end'){if(last)found.add(last);return;}
  if(active.has(at))throw new Error('Цикл маршрута');const next=new Set([...active,at]),step=model.steps.find(s=>s.name===at);if(!step)throw new Error('Нет шага');
  if(step.kind==='branch'){for(const target of step.targets)visit(target,last,next);return;}
  if(step.kind==='process'){for(const port of resultPorts(cwd,step.ref,[...stack,name]))visit(step.next,step.artifact||port,next);return;}
  if(step.kind==='action'){const meta=action(cwd,step.ref);visit(step.next,step.artifact||Object.keys(meta.produces)[0],next);}
 }
 visit(model.entry,null);return [...found];
}
module.exports={dependencies,action,bind,stepParams,childParams,resultPorts};

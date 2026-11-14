'use strict';
// Resolve declared files only. Does not execute steps, inspect expected data or choose branches.
const fs=require('node:fs');
const {inside}=require('../core/safe-path'),{processModel,NAME,allowedReference}=require('./process-model'),{parseFrontmatter}=require('../core/markdown'),{loadContract}=require('../contracts/value-contract');
function literalParams(meta){
 const list=Object.hasOwn(meta.consumes||{},'literalParams')?meta.consumes.literalParams:[];
 if(!Array.isArray(list)||list.some(key=>typeof key!=='string'||!meta.consumes?.params?.includes(key))||new Set(list).size!==list.length)throw new Error('consumes.literalParams: нужен список уникальных имён из consumes.params');
 if(list.some(key=>/File$/.test(key)||['inputs','resultContract','data','records'].includes(key)||key==='text'&&meta.runtime&&meta.consumes.params.includes('inputText')))throw new Error('Файловый параметр нельзя объявить literalParams');
 return list;
}
function action(cwd,name){
 if(!NAME.test(name||''))throw new Error('Неверное действие');const data=parseFrontmatter(fs.readFileSync(inside(cwd,`actions/${name}/ACTION.md`),'utf8')).data;
 if(!data||data.name!==name||!data.produces||typeof data.produces!=='object'||Array.isArray(data.produces)||Object.keys(data.produces).length!==1||Object.entries(data.produces).some(([key,value])=>!NAME.test(key)||typeof value!=='string'||!value.trim()))throw new Error('Неверное определение действия '+name);
 if(!['source','transform','act'].includes(data.kind)||!data.consumes||!['artifacts','params'].every(k=>Array.isArray(data.consumes[k])&&data.consumes[k].every(v=>typeof v==='string')&&new Set(data.consumes[k]).size===data.consumes[k].length))throw new Error('Неверный вход действия '+name);
 literalParams(data);
 if(data.adapter==='environment-tool'&&data.kind!=='source')throw new Error('environment-tool допустим только для source');
 if(data.adapter==='environment-tool'&&data.consumes.params.some(p=>['taskStore','codeStore'].includes(p)))throw new Error('environment-tool не заменяет объявленное подключение');
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
 if(/^[{[]/.test(value)){
  // JSON values can contain unquoted typed bindings, e.g. {"map":{params.map}}.
  // Replace only tokens outside JSON strings, parse JSON, then restore typed values.
  const references=new Map();let encoded='',quoted=false,escaped=false;
  for(let i=0;i<value.length;){
   const match=!quoted&&value.slice(i).match(/^\{params\.([^}]+)\}/);
   if(match){
    if(!Object.hasOwn(params,match[1]))throw new Error('Нет параметра JSON: '+match[1]);
    const token='pk-binding-'+require('node:crypto').randomUUID();references.set(token,params[match[1]]);encoded+=JSON.stringify(token);i+=match[0].length;continue;
   }
   const ch=value[i++];encoded+=ch;
   if(escaped){escaped=false;continue;}if(quoted&&ch==='\\'){escaped=true;continue;}if(ch==='"')quoted=!quoted;
  }
  function expand(item){
   if(typeof item==='string'&&references.has(item))return references.get(item);
   if(Array.isArray(item))return item.map(expand);
   if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,entry])=>[key,expand(entry)]));
   return bind(item,params,artifacts);
  }
  try{return expand(JSON.parse(encoded));}catch(error){if(!(error instanceof SyntaxError))throw error;}
 }
 return value.replace(/\{params\.([^}]+)\}|\{([a-z0-9-]+)\}/g,(text,key,artifact)=>key?(params[key]??text):(artifacts[artifact]??text));
}
function stepParams(params,step,overrides={},artifacts={},defaults={}){
 const scope={...defaults,...params,...overrides};
 return {...scope,...Object.fromEntries(Object.entries(step.params).map(([key,value])=>[key,bind(value,scope,artifacts)])),...overrides};
}
function childParams(cwd,parent,step,params,artifacts={},overrides={}){
 const child=processModel(fs.readFileSync(inside(cwd,`processes/${step.ref}/PROCESS.md`),'utf8'));
 const scope={...params,...overrides};
 return {...params,...child.data.params,...Object.fromEntries(Object.entries(step.params).map(([key,value])=>[key,bind(value,scope,artifacts)])),...overrides};
}
// Static owner inventory: safe to compare before loading any definition hooks.
function definitionFiles(cwd,name,params={},overrides=params){
 const files=new Set(),maxDepth=require('../config/config').loadMaster(cwd).execution.maxProcessDepth;
 function tree(folder){for(const entry of fs.readdirSync(inside(cwd,folder),{withFileTypes:true})){const file=folder+'/'+entry.name;if(file.endsWith('/publication.json'))continue;if(entry.isDirectory())tree(file);else{inside(cwd,file);files.add(file);}}}
 function visit(name,inherited,stack=[]){
  if(!NAME.test(name||''))throw new Error('Неверное имя процесса');
  if(stack.includes(name)||stack.length>=maxDepth)throw new Error('Цикл или глубина подпроцессов');
  const file=`processes/${name}/PROCESS.md`;files.add(file);
  const model=processModel(fs.readFileSync(inside(cwd,file),'utf8')),values={...model.data.params,...inherited};
  if(model.data.branchRule)tree(`processes/${name}/rules`);
  for(const ref of model.data.requires?.actions||[]){if(!NAME.test(ref))throw new Error('Неверное действие');tree('actions/'+ref);}
  for(const step of model.steps.filter(s=>s.kind==='action')){
   const meta=action(cwd,step.ref),effective=stepParams(values,step,overrides,{},meta.defaults);
   for(const key of ['rulesFile','rendererFile'])if(meta.consumes.params.includes(key)&&effective[key]!==undefined){
    const selected=require('../actions/action-support').resource(cwd,name,effective[key],model.data.requires);
    if(!/^(processes|actions)\/[a-z0-9][a-z0-9-]*\/.+\.js$/.test(selected))throw new Error(key+': нужен JS-модуль владельца Process/Action');
    // Collect the selected module and colocated helpers as data, before any require().
    tree(selected.slice(0,selected.lastIndexOf('/')));
   }
  }
  const declared=new Set(model.data.requires?.processes||[]);
  for(const step of model.steps.filter(s=>s.kind==='process')){declared.delete(step.ref);visit(step.ref,childParams(cwd,model,step,values,{},overrides),[...stack,name]);}
  for(const ref of declared)visit(ref,childParams(cwd,model,{ref,params:{}},values,{},overrides),[...stack,name]);
 }
 visit(name,params);return [...files].sort();
}
function dependencies(cwd,name,params={},mode='local',extras=[],overrides=params,options={}){
 const files=new Set(),visiting=new Set();const include=file=>{const full=inside(cwd,file);if(!fs.statSync(full).isFile())throw new Error('Нет файла '+file);files.add(file);return fs.readFileSync(full,'utf8');};
 function entityFiles(folder){for(const item of fs.readdirSync(inside(cwd,folder),{withFileTypes:true})){const file=folder+'/'+item.name;if(item.isDirectory())entityFiles(file);else include(file);}}
 const maxDepth=require('../config/config').loadMaster(cwd).execution.maxProcessDepth;include('config/master/config.json');
 function visit(process,values,depth=0){
  if(!NAME.test(process)||visiting.has(process)||depth>=maxDepth)throw new Error('Цикл или глубина подпроцессов');visiting.add(process);
  const model=processModel(include(`processes/${process}/PROCESS.md`));require('./entities').declarations(cwd,process,model);values={...model.data.params,...values};if(model.errors.length)throw new Error(model.errors.join('; '));
  if(model.data.branchRule){include(`processes/${process}/${model.data.branchRule}`);entityFiles(`processes/${process}/rules`);}
  for(const level of model.data.requires?.context||[])for(const file of require('./context').contextLevel(cwd,process,level))include(file);
  if(model.data.requires?.context?.includes('team'))for(const file of require('../config/config').loadConfig(cwd).files)include(file);
  const config=mode==='live'&&model.data.requires?.config?.length?require('../config/config').loadConfig(cwd,model.data.requires.config):null;
  if(config)for(const file of config.files)include(file);
  for(const ref of model.data.requires?.actions||[])entityFiles('actions/'+ref);
  for(const step of model.steps){
   if(step.kind==='process'){if(!allowedReference(process,step.ref))throw new Error('Ссылка вниз по уровням');visit(step.ref,childParams(cwd,model,step,values,{},overrides),depth+1);continue;}
   if(step.kind!=='action')continue;
   if(!allowedReference(process,step.ref))throw new Error('Ссылка вниз по уровням');include(`actions/${step.ref}/ACTION.md`);const meta=action(cwd,step.ref);
   const effective=stepParams(values,step,overrides,{},meta.defaults);
   for(const [key,folder]of Object.entries({query:'queries',template:'templates',rule:'rules'}))if(meta.consumes?.params?.includes(key)){
    const selected=effective[key];if(!NAME.test(selected||'')||!allowedReference(process,selected))throw new Error('Неверный/отсутствующий '+key+' для '+step.ref);include(`actions/${step.ref}/${folder}/${selected}.md`);
   }
   const context={cwd,processName:process,actionName:step.ref,meta,params:effective,mode,preflight:true,generatedInput:options.generatedInput};
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
 for(const file of definitionFiles(cwd,name,params,overrides))include(file);
 visit(name,params);
 for(const file of extras)if(!files.has(file)){
  if(file.startsWith('context/'))require('../actions/action-support').resource(cwd,name,file);
  if(!/^(processes|actions|context|adapters|config|docs|tools)\//.test(file))throw new Error('Неверный дополнительный файл');include(file);
 }
 if(params.dataFile){if(mode!=='demo')throw new Error('dataFile только для demo');include(params.dataFile);}
 for(const file of ['tools/kit.js','tools/lib/runtime/run-journal.js','tools/lib/runtime/run-storage.js','tools/lib/runtime/trust.js','tools/lib/entities/process-definition.js','tools/lib/entities/process-release.js','tools/lib/entities/process-dependencies.js','tools/lib/contracts/value-contract.js','tools/lib/contracts/artifact-contract.js','tools/lib/core/safe-path.js','tools/lib/entities/process-model.js','tools/lib/core/markdown.js','tools/lib/runtime/history.js','tools/lib/core/paths.js','tools/lib/actions/action-runtime.js','tools/lib/config/config.js','tools/lib/config/config-contract.js','tools/lib/entities/context.js','tools/lib/entities/entities.js'])include(file);
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
module.exports={literalParams,definitionFiles,dependencies,action,bind,stepParams,childParams,resultPorts};

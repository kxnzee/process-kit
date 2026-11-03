'use strict';
// Resolve declared files only. Does not execute steps, inspect expected data or choose branches.
const fs=require('node:fs');
const {inside}=require('./safe-path'),{processModel,parameter,NAME,allowedReference}=require('./process-model'),{parseFrontmatter}=require('./markdown'),{loadContract}=require('./value-contract');
function action(cwd,name){
 if(!NAME.test(name||''))throw new Error('Неверное действие');const data=parseFrontmatter(fs.readFileSync(inside(cwd,`actions/${name}/ACTION.md`),'utf8')).data;
 if(!data||data.name!==name||!data.produces||typeof data.produces!=='object'||Array.isArray(data.produces)||Object.keys(data.produces).length!==1||Object.entries(data.produces).some(([key,value])=>!NAME.test(key)||typeof value!=='string'||!value.trim()))throw new Error('Неверное определение действия '+name);
 if(!['source','transform','act'].includes(data.kind)||!data.consumes||!['artifacts','params'].every(k=>Array.isArray(data.consumes[k])&&data.consumes[k].every(v=>typeof v==='string')&&new Set(data.consumes[k]).size===data.consumes[k].length))throw new Error('Неверный вход действия '+name);
 if(!data.contracts||Object.keys(data.contracts).length!==1||Object.keys(data.produces).some(k=>!Object.hasOwn(data.contracts,k)))throw new Error('Нужен контракт каждого выхода '+name);
 for(const ref of Object.values(data.contracts))if(ref!=='text'&&!/^contracts\/[a-z0-9][a-z0-9.-]*\.json$/.test(ref))throw new Error('Неверный путь контракта '+name);
 return data;
}
function bind(value,params,artifacts={}){if(typeof value!=='string')return value;const m=value.match(/^\{params\.([^}]+)\}$/);if(m)return params[m[1]];return value.replace(/\{params\.([^}]+)\}|\{([a-z0-9-]+)\}/g,(text,key,artifact)=>key?(params[key]??text):(artifacts[artifact]??text));}
function childParams(cwd,parent,step,params,artifacts={}){const child=processModel(fs.readFileSync(inside(cwd,`processes/${step.ref}.md`),'utf8'));return {...params,...child.data.params,...Object.fromEntries(Object.entries(step.params).map(([k,v])=>[k,bind(v,params,artifacts)]))};}
function dependencies(cwd,name,params={},mode='local',extras=[]){
 const files=new Set(),visiting=new Set();const include=file=>{const full=inside(cwd,file);if(!fs.statSync(full).isFile())throw new Error('Нет файла '+file);files.add(file);return fs.readFileSync(full,'utf8');};
 const config=mode==='live'?JSON.parse(include('config/sources.json')):null;if(config)include('.gigacode/settings.json');
 function visit(process,values,depth=0){
  if(!NAME.test(process)||visiting.has(process)||depth>=5)throw new Error('Цикл или глубина подпроцессов');visiting.add(process);
  const model=processModel(include(`processes/${process}.md`));if(model.errors.length)throw new Error(model.errors.join('; '));
  for(const file of model.data.requires?.context||[])include(file.startsWith('context/')?file:'context/'+file);
  for(const step of model.steps){
   if(step.kind==='process'){if(!allowedReference(process,step.ref))throw new Error('Ссылка вниз по уровням');visit(step.ref,childParams(cwd,model,step,values),depth+1);continue;}
   if(step.kind!=='action')continue;
   if(!allowedReference(process,step.ref))throw new Error('Ссылка вниз по уровням');include(`actions/${step.ref}/ACTION.md`);const meta=action(cwd,step.ref);
   for(const [key,folder]of Object.entries({query:'queries',template:'templates',rule:'rules'}))if(meta.consumes?.params?.includes(key)){
    const selected=parameter({...model,data:{...model.data,params:values}},step,key);if(!NAME.test(selected||'')||!allowedReference(process,selected))throw new Error('Неверный/отсутствующий '+key+' для '+step.ref);include(`actions/${step.ref}/${folder}/${selected}.md`);
   }
   const recipe=fs.readFileSync(inside(cwd,`actions/${step.ref}/ACTION.md`),'utf8');
   for(const m of recipe.matchAll(/(?:^|[\s`(])((?:rules|templates|queries)\/[a-z0-9][a-z0-9.-]*\.md)/gm))include(`actions/${step.ref}/${m[1]}`);
   for(const ref of Object.values(meta.contracts))if(ref.startsWith('contracts/')){include(`actions/${step.ref}/${ref}`);loadContract(cwd,`actions/${step.ref}/${ref}`);}
   if(config&&meta.kind!=='transform')for(const [slot,collection]of [['taskStore','taskStores'],['codeStore','codeStores']])if(meta.consumes.params.includes(slot)){
    const id=parameter({...model,data:{...model.data,params:values}},step,slot)??config.defaults?.[slot],entry=config[collection]?.find(v=>v.id===id);if(!entry||entry.enabled===false)throw new Error('Не настроено подключение '+slot);const adapter=String(entry.adapter).replace(/^adapters\//,'').replace(/\.md$/,'');if(!NAME.test(adapter)||/^TODO/i.test(adapter))throw new Error('Не настроен адаптер');include('adapters/'+adapter+'.md');
   }
  }
  visiting.delete(process);
 }
 visit(name,params);if(fs.existsSync(inside(cwd,'context/common.md')))include('context/common.md');
 for(const file of ['context/my-preferences.md'])if(fs.existsSync(inside(cwd,file)))include(file);
 if([...files].some(f=>f==='actions/assess-sdd/ACTION.md'||f==='actions/run-query/ACTION.md'))include('tools/sdd-data.js');
 for(const file of extras)if(!files.has(file)){
  if(file.startsWith('tests/')&&!(mode==='demo'&&file===params.dataFile))throw new Error('Тестовый эталон не является входом');
  if(!/^(processes|actions|context|adapters|config|docs|tools|tests)\//.test(file)&&file!=='.gigacode/settings.json')throw new Error('Неверный дополнительный файл');include(file);
 }
 if(params.dataFile){if(mode!=='demo')throw new Error('dataFile только для demo');include(params.dataFile);}
 for(const file of ['tools/run-journal.js','tools/process-dependencies.js','tools/value-contract.js','tools/artifact-contract.js','tools/safe-path.js','tools/process-model.js','tools/markdown.js','tools/history.js','tools/paths.js'])include(file);
 return [...files].sort();
}
// Possible final ports; callers without an explicit alias can rely only on a single common port.
function resultPorts(cwd,name,stack=[]){
 if(stack.includes(name)||stack.length>=5)throw new Error('Цикл подпроцессов');
 const model=processModel(fs.readFileSync(inside(cwd,`processes/${name}.md`),'utf8'));if(model.errors.length)throw new Error(model.errors.join('; '));
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
module.exports={dependencies,action,bind,childParams,resultPorts};

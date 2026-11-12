'use strict';
// Shared definition checks for check, start and publication. No agent or network API.
const fs=require('node:fs');
const {inside}=require('../core/safe-path');
const {processModel,NAME,allowedReference,parameter}=require('./process-model');
function validateDefinition(cwd,name,stack=[]){
 if(!NAME.test(name||''))throw new Error('Неверное имя процесса');
 if(stack.includes(name)||stack.length>=require('../config/config').loadMaster(cwd).execution.maxProcessDepth)throw new Error('Цикл или глубина подпроцессов');
 const model=processModel(fs.readFileSync(inside(cwd,`processes/${name}/PROCESS.md`),'utf8')),d=model.data;
 const errors=[...model.errors];
 for(const key of ['name','version','area','status','description'])if(typeof d[key]!=='string'||!d[key].trim())errors.push('нет '+key);
 if(d.name!==name)errors.push('name не совпадает с именем папки');
 if(!/^\d+\.\d+\.\d+$/.test(d.version||''))errors.push('version не в формате X.Y.Z');
 if(!['действует','устарел'].includes(d.status))errors.push('status: действует или устарел');
 if(!d.example&&!(Array.isArray(d.examples)&&d.examples.length))errors.push('нет example/examples');
 if(d.params!==undefined&&(!d.params||typeof d.params!=='object'||Array.isArray(d.params)))errors.push('params: нужен объект');
 if(d.publication!==undefined&&!['required','legacy'].includes(d.publication))errors.push('publication: required или legacy');
 if(d.branchRule!==undefined&&!/^rules\/[a-z0-9][a-z0-9.-]*\.js$/.test(d.branchRule))errors.push('branchRule: нужен JS-файл в rules/ процесса');
 if(errors.length)throw new Error(errors.join('; '));
 require('./entities').declarations(cwd,name,model);
 for(const level of d.requires.context||[])require('./context').contextLevel(cwd,name,level);
 const {action,resultPorts}=require('./process-dependencies');
 for(const step of model.steps){
  if(step.ref&&!allowedReference(name,step.ref))throw new Error('Ссылка вниз по уровням');
  if(step.name==='end'&&step.kind)throw new Error('end — терминальный узел, он не может выполнять действие');
  if(step.kind==='process')validateDefinition(cwd,step.ref,[...stack,name]);
  if(step.kind==='action'){
   const meta=action(cwd,step.ref);
   for(const [key,folder]of Object.entries({query:'queries',template:'templates',rule:'rules'})){
    if(!meta.consumes.params.includes(key)&&!(key in step.params))continue;
    const value=parameter(model,step,key);if(value==null)continue;
    if(!NAME.test(String(value)))throw new Error(`параметр ${key}: нужно явное имя файла данных`);
    if(!allowedReference(name,value))throw new Error('Ссылка на данные нижнего уровня: '+value);
    if(!fs.existsSync(inside(cwd,`actions/${step.ref}/${folder}/${value}.md`)))throw new Error(`нет данных действия ${step.ref}/${folder}/${value}.md`);
   }
   if(!NAME.test(step.artifact||''))throw new Error(`шаг ${step.name}: нужен артефакт`);
  }
 }
 if(d.branchRule){const file=inside(cwd,`processes/${name}/${d.branchRule}`);delete require.cache[require.resolve(file)];if(typeof require(file).choose!=='function')throw new Error('branchRule должен экспортировать choose');}
 // A required input must exist on every incoming path, including bindings of subprocesses.
 const predecessors=new Map(model.steps.map(s=>[s.name,[]]));
 for(const step of model.steps)for(const target of step.kind==='branch'?step.targets:[step.next])if(predecessors.has(target))predecessors.get(target).push(step.name);
 const cache=new Map();
 function after(at){
  if(cache.has(at))return cache.get(at);
  const step=model.steps.find(s=>s.name===at),parents=predecessors.get(at)||[];
  let available=new Set();
  if(parents.length&&at!==model.entry){available=new Set(after(parents[0]));for(const parent of parents.slice(1)){const other=after(parent);available=new Set([...available].filter(key=>other.has(key)));}}
  const bindings=Object.values(step.params||{}).flatMap(v=>typeof v==='string'?[...v.matchAll(/\{([a-z0-9-]+)\}/g)].map(m=>m[1]):[]);
  const meta=step.kind==='action'?action(cwd,step.ref):null;
  for(const input of [...bindings,...(meta?.consumes.artifacts||[])])if(!available.has(input))throw new Error(`вход ${input} недоступен на всех путях к шагу ${at}`);
  if(meta)available.add(step.artifact);
  if(step.kind==='process'){
   const ports=resultPorts(cwd,step.ref);
   if(!ports.length)throw new Error(`подпроцесс ${step.ref} не создаёт результата`);
   if(!step.artifact&&ports.length!==1)throw new Error(`шаг ${at}: нужен псевдоним результата подпроцесса`);
   available.add(step.artifact||ports[0]);
  }
  cache.set(at,available);return available;
 }
 for(const step of model.steps)after(step.name);
 // Every terminating path must contain an action result; end itself is only a sentinel.
 function terminal(at,hasResult){
  if(at==='end'){if(!hasResult)throw new Error('Маршрут завершается без результата');return;}
  const step=model.steps.find(s=>s.name===at);
  for(const target of step.kind==='branch'?step.targets:[step.next])terminal(target,hasResult||['action','process'].includes(step.kind));
 }
 terminal(model.entry,false);
 return model;
}
function branchChoice(cwd,process,model,step,params,artifacts){
 if(!model.data.branchRule||['model','user'].includes(step.decision))return null;
 const file=inside(cwd,`processes/${process}/${model.data.branchRule}`);delete require.cache[require.resolve(file)];
 const result=require(file).choose({step:step.name,params,artifacts});
 if(!result||typeof result!=='object'||!step.targets.includes(result.target)||typeof result.reason!=='string'||!result.reason.trim())throw new Error('branchRule вернул недопустимую ветку или пустое основание');
 return result;
}
function validateRunInput(cwd,name,model,params){
 if(!model.data.branchRule)return;
 const file=inside(cwd,`processes/${name}/${model.data.branchRule}`);delete require.cache[require.resolve(file)];
 require(file).validateInput?.(params);
}
module.exports={validateDefinition,branchChoice,validateRunInput};

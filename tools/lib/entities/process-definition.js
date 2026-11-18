'use strict';
// Shared definition checks for check, start and publication. No agent or network API.
const fs=require('node:fs');
const {inside}=require('../core/safe-path');
const {processModel,NAME,VERSION,STATUSES,allowedReference,parameter}=require('./process-model');
function validateDefinition(cwd,name,stack=[],ruleChecks=[]){
 if(!NAME.test(name||''))throw new Error('Неверное имя процесса');
 if(stack.includes(name)||stack.length>=require('../config/config').loadMaster(cwd).execution.maxProcessDepth)throw new Error('Цикл или глубина подпроцессов');
 const file=`processes/${name}/PROCESS.md`,text=fs.readFileSync(inside(cwd,file),'utf8'),rows=text.split(/\r?\n/);
 const model=processModel(text),d=model.data,issues=[];
 const fieldLine=key=>{const at=rows.findIndex(row=>row.startsWith(key+':'));return at<0?1:at+1;};
 const add=(msg,line=1,source=file)=>issues.push({file:source,line,msg});
 const capture=(fn,line=1)=>{try{return fn();}catch(error){if(error.issues)issues.push(...error.issues);else add(error.message,line);}};
 const fail=()=>{if(issues.length)throw Object.assign(new Error(issues.map(issue=>issue.msg).join('; ')),{issues});};
 for(const msg of model.errors){
  const stepName=msg.match(/^(?:шаг |повтор имени шага |цикл маршрута на шаге |недостижимый шаг )([^ :]+)/)?.[1];
  add(msg,model.steps.find(step=>step.name===stepName)?.ln||fieldLine('entry'));
 }
 for(const key of ['name','version','area','status','description'])if(typeof d[key]!=='string'||!d[key].trim())add('нет '+key,fieldLine(key));
 if(d.name!==name)add('name не совпадает с именем папки',fieldLine('name'));
 if(!VERSION.test(d.version||''))add('version не в формате X.Y.Z',fieldLine('version'));
 if(!STATUSES.includes(d.status))add('status: действует или устарел',fieldLine('status'));
 if(!d.example&&!(Array.isArray(d.examples)&&d.examples.length))add('нет example/examples',fieldLine('example'));
 if(d.params!==undefined&&(!d.params||typeof d.params!=='object'||Array.isArray(d.params)))add('params: нужен объект',fieldLine('params'));
 if(d.runtimeInputs!==undefined&&(!Array.isArray(d.runtimeInputs)||new Set(d.runtimeInputs).size!==d.runtimeInputs.length||d.runtimeInputs.some(key=>typeof key!=='string'||!Object.hasOwn(d.params||{},key))))add('runtimeInputs: нужен список уникальных имён из params',fieldLine('runtimeInputs'));
 if(d.publication!==undefined&&d.publication!=='required')add('publication: допускается только required; legacy нужно перевести через validate/test/publish',fieldLine('publication'));
 if(d.branchRule!==undefined&&!/^rules\/[a-z0-9][a-z0-9.-]*\.js$/.test(d.branchRule))add('branchRule: нужен JS-файл в rules/ процесса',fieldLine('branchRule'));
 capture(()=>require('./entities').declarations(cwd,name,model),fieldLine('requires'));
 if(Array.isArray(d.requires?.context))for(const level of d.requires.context)capture(()=>require('./context').contextLevel(cwd,name,level),fieldLine('requires'));
 const {action,resultPorts}=require('./process-dependencies'),metadata=new Map();
 for(const step of model.steps){
  if(step.ref&&(!NAME.test(step.ref)||!allowedReference(name,step.ref))){add('Ссылка вниз по уровням или неверное имя: '+step.ref,step.ln);continue;}
  if(step.name==='end'&&step.kind)add('end — терминальный узел, он не может выполнять действие',step.ln);
  if(step.kind==='process')capture(()=>validateDefinition(cwd,step.ref,[...stack,name],ruleChecks),step.ln);
  if(step.kind==='action'){
   const meta=capture(()=>action(cwd,step.ref),step.ln);
   if(meta){
    metadata.set(step.name,meta);
    for(const [key,folder]of Object.entries({query:'queries',template:'templates',rule:'rules'})){
     if(!meta.consumes.params.includes(key)&&!(key in step.params))continue;
     const value=parameter(model,step,key);if(value==null)continue;
     if(!NAME.test(String(value))){add(`параметр ${key}: нужно явное имя файла данных`,step.ln);continue;}
     if(!allowedReference(name,value)){add('Ссылка на данные нижнего уровня: '+value,step.ln);continue;}
     if(!fs.existsSync(inside(cwd,`actions/${step.ref}/${folder}/${value}.md`)))add(`нет данных действия ${step.ref}/${folder}/${value}.md`,step.ln);
    }
   }
   if(!NAME.test(step.artifact||''))add(`шаг ${step.name}: нужен артефакт`,step.ln);
  }
 }
 // Report independent metadata/resource errors together. Do not traverse a broken graph
 // or load its branch code just to collect follow-on failures.
 fail();
 if(d.branchRule)ruleChecks.push({file,rule:`processes/${name}/${d.branchRule}`,line:fieldLine('branchRule')});
 const predecessors=new Map(model.steps.map(s=>[s.name,[]]));
 for(const step of model.steps)for(const target of step.kind==='branch'?step.targets:[step.next])if(predecessors.has(target))predecessors.get(target).push(step.name);
 const cache=new Map();
 function after(at){
  if(cache.has(at))return cache.get(at);
  const step=model.steps.find(s=>s.name===at),parents=predecessors.get(at)||[];
  let available=new Set();
  if(parents.length&&at!==model.entry){available=new Set(after(parents[0]));for(const parent of parents.slice(1)){const other=after(parent);available=new Set([...available].filter(key=>other.has(key)));}}
  const bindings=Object.values(step.params||{}).flatMap(v=>typeof v==='string'?[...v.matchAll(/\{([a-z0-9-]+)\}/g)].map(m=>m[1]):[]);
  const meta=metadata.get(at);
  for(const input of new Set([...bindings,...(meta?.consumes.artifacts||[])]))if(!available.has(input))add(`вход ${input} недоступен на всех путях к шагу ${at}`,step.ln);
  if(meta)available.add(step.artifact);
  if(step.kind==='process'){
   const ports=capture(()=>resultPorts(cwd,step.ref),step.ln)||[];
   if(!ports.length)add(`подпроцесс ${step.ref} не создаёт результата`,step.ln);
   if(!step.artifact&&ports.length!==1)add(`шаг ${at}: нужен псевдоним результата подпроцесса`,step.ln);
   available.add(step.artifact||ports[0]);
  }
  cache.set(at,available);return available;
 }
 for(const step of model.steps)after(step.name);
 // Every terminating path must contain an action result; end itself is only a sentinel.
 function terminal(at,hasResult){
  if(at==='end'){if(!hasResult)add('Маршрут завершается без результата',fieldLine('entry'));return;}
  const step=model.steps.find(s=>s.name===at);
  for(const target of step.kind==='branch'?step.targets:[step.next])terminal(target,hasResult||['action','process'].includes(step.kind));
 }
 terminal(model.entry,false);
 fail();
 if(!stack.length){
  for(const check of ruleChecks)try{const rule=inside(cwd,check.rule);delete require.cache[require.resolve(rule)];if(typeof require(rule).choose!=='function')throw new Error('branchRule должен экспортировать choose');}catch(error){add(error.message,check.line,check.file);}
  fail();
 }
 return model;
}
function branchChoice(cwd,process,model,step,params,artifacts){
 if(!model.data.branchRule||['model','user'].includes(step.decision))return null;
 const file=inside(cwd,`processes/${process}/${model.data.branchRule}`);delete require.cache[require.resolve(file)];
 const result=require(file).choose({step:step.name,params,artifacts});
 if(!result||typeof result!=='object'||!step.targets.includes(result.target)||typeof result.reason!=='string'||!result.reason.trim())throw new Error('branchRule вернул недопустимую ветку или пустое основание');
 return result;
}
function validateRunInput(cwd,name,model,params,context={}){
 if(!model.data.branchRule)return;
 const file=inside(cwd,`processes/${name}/${model.data.branchRule}`);delete require.cache[require.resolve(file)];
 require(file).validateInput?.(params,context);
}
module.exports={validateDefinition,branchChoice,validateRunInput};

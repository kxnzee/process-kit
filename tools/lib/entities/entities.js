'use strict';
// Entity declarations and catalogs. Internal resources are resolved by their owner.
const fs=require('node:fs');
const {inside}=require('../core/safe-path'),{NAME,allowedReference}=require('./process-model');
const LEVELS=['master','team','my'];
function levels(value,label){
 if(!Array.isArray(value)||new Set(value).size!==value.length||value.some(level=>!LEVELS.includes(level)))throw new Error(label+': нужен список уникальных уровней master/team/my');
 return value;
}
function declarations(cwd,name,model){
 const req=model.data.requires;
 if(!req||typeof req!=='object'||Array.isArray(req))throw new Error('Нет requires');
 for(const key of Object.keys(req))if(!['actions','processes','context','config'].includes(key))throw new Error('Неизвестная зависимость requires.'+key);
 for(const [key,folder,entry]of [['actions','actions','ACTION.md'],['processes','processes','PROCESS.md']]){
  const refs=req[key]||[];
  if(!Array.isArray(refs)||new Set(refs).size!==refs.length||refs.some(ref=>typeof ref!=='string'||!NAME.test(ref)))throw new Error('requires.'+key+': нужны имена сущностей');
  for(const ref of refs){if(!allowedReference(name,ref))throw new Error('Ссылка вниз по уровням: '+ref);if(!fs.statSync(inside(cwd,`${folder}/${ref}/${entry}`)).isFile())throw new Error('Нет сущности '+ref);}
  for(const step of model.steps.filter(step=>step.kind===(key==='actions'?'action':'process')))if(!refs.includes(step.ref))throw new Error(`${step.ref} не перечислено в requires.${key}`);
 }
 levels(req.context||[],'requires.context');levels(req.config||[],'requires.config');
 return req;
}
function manifest(cwd,name,params={},mode='local',overrides=params){
 if(!NAME.test(name||'')||!params||typeof params!=='object'||Array.isArray(params)||!['local','demo','live'].includes(mode))throw new Error('Нужны имя процесса, объект параметров и режим local/demo/live');
 const {processModel}=require('./process-model'),{dependencies,childParams}=require('./process-dependencies');
 const entities=[],seen=new Set();
 function add(kind,name,entry,extra={}){const key=kind+':'+name;if(!seen.has(key)){seen.add(key);entities.push({kind,name,entry,...extra});}}
 function visit(name,inherited,stack=[]){
  if(stack.includes(name)||stack.length>=require('../config/config').loadMaster(cwd).execution.maxProcessDepth)throw new Error('Цикл или глубина подпроцессов');
  const entry=`processes/${name}/PROCESS.md`,model=processModel(fs.readFileSync(inside(cwd,entry),'utf8')),req=declarations(cwd,name,model),values={...model.data.params,...inherited};
  add('process',name,entry);
  for(const ref of req.actions||[])add('action',ref,`actions/${ref}/ACTION.md`);
  for(const level of req.context||[])add('context',level,`context/${level}`,{topics:require('./context').contextLevel(cwd,name,level)});
  for(const level of req.config||[])add('config',level,require('../config/config').FILES[level],{available:fs.existsSync(inside(cwd,require('../config/config').FILES[level]))});
  for(const step of model.steps.filter(step=>step.kind==='process'))visit(step.ref,childParams(cwd,model,step,values,{},overrides),[...stack,name]);
 }
 visit(name,params);
 const connections=mode==='live'?require('../config/config').resolveProcess(cwd,name,params,overrides):null;
 if(connections&&!connections.ready)return {ready:false,entities,connections,missing:connections.missing,readFiles:[]};
 for(const connection of connections?.connections||[])add('adapter',connection.id,connection.adapterFile,{mcpServer:connection.mcpServer});
 const files=dependencies(cwd,name,params,mode,[],overrides);
 return {ready:true,entities,connections,files,readFiles:entities.flatMap(item=>item.kind==='context'?['context/README.md']:item.available===false?[]:[item.entry]),note:'Сначала читайте точки входа нужных сущностей. Темы контекста выбирайте по задаче; конфликты не разрешаются приоритетом.'};
}
module.exports={levels,declarations,manifest};
if(require.main===module){try{const [name,mode='local',paramsFile,...rest]=process.argv.slice(2);if(rest.length||!['local','demo','live'].includes(mode))throw new Error('node tools/kit.js entities <процесс> [local|demo|live] [params.json]');const result=manifest(process.cwd(),name,paramsFile?JSON.parse(fs.readFileSync(paramsFile,'utf8')):{},mode);console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}}

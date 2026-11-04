'use strict';
const fs=require('node:fs');
const {inside}=require('../core/safe-path'),{allowedReference}=require('../entities/process-model');
const {loadContract,validateValue}=require('../contracts/value-contract');
function resource(cwd,processName,value){
 if(typeof value!=='string'||value.includes('\\')||value.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('Нужен точный путь ресурса');
 if(value.startsWith('context/')){const model=require('../entities/process-model').processModel(fs.readFileSync(inside(cwd,`processes/${processName}/PROCESS.md`),'utf8'));const level=value.split('/')[1];if(!model.data.requires?.context?.includes(level))throw new Error('Контекст не объявлен в requires.context: '+level);return require('../entities/context').contextFile(cwd,processName,value);}
 const parts=value.split('/');
 if(parts[0]==='actions'){const model=require('../entities/process-model').processModel(fs.readFileSync(inside(cwd,`processes/${processName}/PROCESS.md`),'utf8'));if(!model.data.requires?.actions?.includes(parts[1]))throw new Error('Экшен не объявлен в requires.actions: '+parts[1]);}
 if(!['actions','processes','context','adapters'].includes(parts[0])||!allowedReference(processName,parts[1]))throw new Error('Недопустимый ресурс '+value);
 if(!fs.statSync(inside(cwd,value)).isFile())throw new Error('Нет ресурса '+value);return value;
}
function object(value){if(typeof value==='string')value=JSON.parse(value);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Нужен объект аргументов');return value;}
const read=(cwd,file)=>JSON.parse(fs.readFileSync(inside(cwd,file),'utf8'));
function source(ctx,slot){
 const params={...ctx.params,parameters:object(ctx.params.parameters)};
 const config=ctx.mode==='demo'?{defaults:{}}:require('../config/config').loadConfig(ctx.cwd,require('../entities/process-model').processModel(fs.readFileSync(inside(ctx.cwd,`processes/${ctx.processName}/PROCESS.md`),'utf8')).data.requires?.config||[]);
 if(!params[slot])params[slot]=config.defaults[slot];
 if(ctx.mode!=='demo'){
   const collection=slot==='taskStore'?'taskStores':'codeStores',entry=config[collection].find(item=>item.id===params[slot]);
   const key=slot==='taskStore'?'project':'repository';
   if(entry&&params.parameters[key]===undefined){const resource=require('../config/config').selectedResource(config,slot,entry);if(resource!==undefined)params.parameters={...params.parameters,[key]:resource};}
 }
 if(ctx.mode!=='demo'&&!ctx.preflight)require('../config/config').selectedStore(config,slot,params[slot]);
 require('./query-file').queryFile(ctx.cwd,ctx.processName,params.queryFile);
 const input={queryFile:params.queryFile,[slot]:params[slot]||(ctx.mode==='demo'?'demo':ctx.preflight?'preflight':undefined),parameters:params.parameters,...(params.dataFile?{dataFile:params.dataFile}:{})};
 validateValue(loadContract(ctx.cwd,`actions/${ctx.actionName}/contracts/input.json`),input);return params;
}
function partition(groups){const seen=new Set();for(const rows of groups)for(const row of rows){if(seen.has(row.key))throw new Error('Группы содержат повторяющийся ключ '+row.key);seen.add(row.key);}}
module.exports={resource,object,read,source,partition,loadContract,validateValue};

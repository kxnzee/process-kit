'use strict';
const s=require('../../tools/lib/actions/action-support'),{selectionId}=require('../../tools/lib/actions/query-data');
module.exports={
 canExecute(ctx){return ctx.mode==='demo';},
 execute(ctx){if(ctx.mode!=='demo')throw new Error('Источник требует чтения MCP по адаптеру');return require('../../tools/lib/actions/code-data').evidenceFromFixture(s.read(ctx.cwd,ctx.params.dataFile),ctx.inputs['task-records'],ctx.params.queryFile);},
 dependencies(ctx){s.source({...ctx,preflight:true},'codeStore');return [ctx.params.queryFile,`actions/${ctx.actionName}/contracts/input.json`,`actions/${ctx.actionName}/contracts/task-records.json`];},
 prepare(ctx){const params=s.source(ctx,'codeStore'),tasks=ctx.inputs['task-records'];s.validateValue(s.loadContract(ctx.cwd,`actions/${ctx.actionName}/contracts/task-records.json`),tasks);if(tasks.selectionId!==selectionId(tasks))throw new Error('Изменён входной task-records');return params;},
 normalize(ctx){return {...structuredClone(ctx.value),queryFile:ctx.params.queryFile};},
 validate(ctx){s.partition([ctx.value.records]);const tasks=ctx.inputs?.['task-records'];if(tasks){const keys=new Set(tasks.records.map(r=>r.key));if(ctx.value.selectionId!==tasks.selectionId||ctx.value.records.some(r=>!keys.has(r.key)))throw new Error('Свидетельства кода относятся к другому отбору');}}
};

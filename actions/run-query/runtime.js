'use strict';
const support=require('../../tools/lib/actions/action-support'),{selectionId}=require('../../tools/lib/actions/query-data');
module.exports={
 canExecute(ctx){return ctx.mode==='demo';},
 execute(ctx){if(ctx.mode!=='demo')throw new Error('Источник требует чтения MCP по адаптеру');const fixture=support.read(ctx.cwd,ctx.params.dataFile);return require('../../tools/lib/actions/query-data').queryFixture(fixture,ctx.params.queryFile);},
 dependencies(ctx){support.source({...ctx,preflight:true},'taskStore');return [ctx.params.queryFile,`actions/${ctx.actionName}/contracts/input.json`];},
 prepare(ctx){return support.source(ctx,'taskStore');},
 normalize(ctx){const value=structuredClone(ctx.value);value.meta={...value.meta,queryFile:ctx.params.queryFile};value.selectionId=selectionId(value);return value;},
 validate(ctx){support.partition([ctx.value.records,ctx.value.excluded,ctx.value.unverified]);}
};

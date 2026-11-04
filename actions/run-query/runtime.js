'use strict';
const support=require('../../tools/lib/actions/action-support'),{selectionId}=require('../../tools/lib/actions/query-data');
module.exports={
 dependencies(ctx){support.source({...ctx,preflight:true},'taskStore');return [ctx.params.queryFile,`actions/${ctx.actionName}/contracts/input.json`];},
 prepare(ctx){return support.source(ctx,'taskStore');},
 normalize(ctx){const value=structuredClone(ctx.value);value.meta={...value.meta,queryFile:ctx.params.queryFile};value.selectionId=selectionId(value);return value;},
 validate(ctx){support.partition([ctx.value.records,ctx.value.excluded,ctx.value.unverified]);}
};

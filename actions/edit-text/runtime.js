'use strict';
const s=require('../../tools/lib/actions/action-support');
module.exports={dependencies(ctx){return [s.resource(ctx.cwd,ctx.processName,ctx.params.styleFile)];}};

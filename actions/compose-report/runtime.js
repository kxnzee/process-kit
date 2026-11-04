'use strict';
const s=require('../../tools/lib/actions/action-support');
module.exports={
 dependencies(ctx){s.validateValue(s.loadContract(ctx.cwd,`actions/${ctx.actionName}/contracts/input.json`),{data:ctx.params.data,templateFile:ctx.params.templateFile,...(ctx.params.maxFindingsPerReport!==undefined?{maxFindingsPerReport:ctx.params.maxFindingsPerReport}:{})});return [...(/^\{[a-z0-9-]+\}$/.test(ctx.params.data)?[]:[s.resource(ctx.cwd,ctx.processName,ctx.params.data)]),s.resource(ctx.cwd,ctx.processName,ctx.params.templateFile),`actions/${ctx.actionName}/contracts/input.json`];},
 prepare(ctx){if(typeof ctx.params.data!=='string')throw new Error('Нужен путь data');s.read(ctx.cwd,ctx.params.data);return ctx.params;},
 validate(ctx){if(/\{\{[#/]|\{\{\w+\}\}/.test(ctx.value))throw new Error('В отчёте остались незаполненные переменные шаблона');}
};

'use strict';
const {inside}=require('../../tools/lib/core/safe-path'),s=require('../../tools/lib/actions/action-support');
function renderer(ctx){if(!ctx.params.rendererFile)return null;const file=s.resource(ctx.cwd,ctx.processName,ctx.params.rendererFile,ctx.requires);if(!file.endsWith('.js'))throw new Error('rendererFile: нужен локальный JS-модуль');const full=inside(ctx.cwd,file);delete require.cache[require.resolve(full)];const value=require(full);if(typeof value.render!=='function'||typeof value.validate!=='function')throw new Error('rendererFile должен экспортировать render и validate');return value;}
function execute(ctx){const module=renderer(ctx);if(!module)throw new Error('Текст формирует модель по ACTION.md; готового rendererFile нет');return module.render(s.read(ctx.cwd,ctx.params.data),ctx.params);}
module.exports={
 dependencies(ctx){const input={data:ctx.params.data,templateFile:ctx.params.templateFile};for(const key of ['maxFindingsPerReport','rendererFile'])if(ctx.params[key]!==undefined)input[key]=ctx.params[key];s.validateValue(s.loadContract(ctx.cwd,`actions/${ctx.actionName}/contracts/input.json`),input);renderer(ctx);return [...(/^\{[a-z0-9-]+\}$/.test(ctx.params.data)?[]:[s.resource(ctx.cwd,ctx.processName,ctx.params.data,ctx.requires)]),s.resource(ctx.cwd,ctx.processName,ctx.params.templateFile,ctx.requires),...(ctx.params.rendererFile?[ctx.params.rendererFile]:[]),`actions/${ctx.actionName}/contracts/input.json`];},
 prepare(ctx){s.read(ctx.cwd,ctx.params.data);renderer(ctx);return ctx.params;},
 canExecute(ctx){return !!ctx.params.rendererFile;},execute,
 validate(ctx){if(/\{\{[\s\S]*?\}\}/.test(ctx.value))throw new Error('В отчёте остались незаполненные переменные шаблона');renderer(ctx)?.validate(ctx.value,s.read(ctx.cwd,ctx.params.data),ctx.params);}
};

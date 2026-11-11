'use strict';
const fs=require('node:fs'),{inside}=require('../../tools/lib/core/safe-path'),s=require('../../tools/lib/actions/action-support');
function renderer(ctx){if(!ctx.params.rendererFile)return null;const file=s.resource(ctx.cwd,ctx.processName,ctx.params.rendererFile,ctx.requires);if(!file.endsWith('.js'))throw new Error('rendererFile: нужен локальный JS-модуль');const full=inside(ctx.cwd,file);delete require.cache[require.resolve(full)];const value=require(full);if(typeof value.render!=='function'||typeof value.validate!=='function')throw new Error('rendererFile должен экспортировать render и validate');return value;}
function execute(ctx){const module=renderer(ctx);if(!module)throw new Error('Текст формирует модель по ACTION.md; готового rendererFile нет');return module.render(s.read(ctx.cwd,ctx.params.data),ctx.params);}
// Переменной считается только имя, объявленное в шаблоне: отчёт цитирует тексты задач дословно,
// а в них встречаются {{...}} чужих форм — любая пара скобок про настоящую переменную не говорит.
// Управление шаблона ({{#each}}, {{/if}}) остаётся ошибкой всегда; без доступного шаблона
// (проверка вне шага процесса) проверка имени тоже остаётся строгой.
function declared(ctx){if(!ctx.params.templateFile)return null;try{return new Set([...fs.readFileSync(inside(ctx.cwd,s.resource(ctx.cwd,ctx.processName,ctx.params.templateFile,ctx.requires)),'utf8').matchAll(/\{\{\s*([\w.$-]+)/g)].map(m=>m[1]));}catch{return null;}}
function unfilled(ctx){const text=String(ctx.value),names=declared(ctx);return [...new Set([...text.matchAll(/\{\{[^{}]*\}\}/g)].map(m=>m[0].trim()).filter(raw=>{if(!/^\{\{[\w.$-]+\}\}$/.test(raw))return true;return names?names.has(raw.slice(2,-2).trim()):true;}))];}
module.exports={
 dependencies(ctx){const input={data:ctx.params.data,templateFile:ctx.params.templateFile};for(const key of ['maxFindingsPerReport','rendererFile'])if(ctx.params[key]!==undefined)input[key]=ctx.params[key];s.validateValue(s.loadContract(ctx.cwd,`actions/${ctx.actionName}/contracts/input.json`),input);renderer(ctx);return [...(/^\{[a-z0-9-]+\}$/.test(ctx.params.data)?[]:[s.resource(ctx.cwd,ctx.processName,ctx.params.data,ctx.requires)]),s.resource(ctx.cwd,ctx.processName,ctx.params.templateFile,ctx.requires),...(ctx.params.rendererFile?[ctx.params.rendererFile]:[]),`actions/${ctx.actionName}/contracts/input.json`];},
 prepare(ctx){s.read(ctx.cwd,ctx.params.data);renderer(ctx);return ctx.params;},
 canExecute(ctx){return !!ctx.params.rendererFile;},execute,
 validate(ctx){const left=unfilled(ctx);if(left.length)throw new Error(`В отчёте остались незаполненные переменные шаблона: ${left.join(', ')}`);renderer(ctx)?.validate(ctx.value,s.read(ctx.cwd,ctx.params.data),ctx.params);}
};

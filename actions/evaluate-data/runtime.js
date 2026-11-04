'use strict';
const {isDeepStrictEqual}=require('node:util'),{inside}=require('../../tools/lib/core/safe-path'),s=require('../../tools/lib/actions/action-support');
function rule(ctx){s.resource(ctx.cwd,ctx.processName,ctx.params.rulesFile);if(!ctx.params.rulesFile.endsWith('.js'))throw new Error('Нужен JS-модуль правила');const file=inside(ctx.cwd,ctx.params.rulesFile);delete require.cache[require.resolve(file)];const loaded=require(file);if(typeof loaded.evaluate!=='function')throw new Error('Правило должно экспортировать evaluate');return loaded;}
function evaluate(ctx){const args=s.object(ctx.params.inputs),inputs={};for(const [name,file]of Object.entries(args))inputs[name]=s.read(ctx.cwd,file);const value=rule(ctx).evaluate(inputs,s.object(ctx.params.parameters));s.validateValue(s.loadContract(ctx.cwd,ctx.params.resultContract),value);return value;}
module.exports={
 dependencies(ctx){const inputFiles=Object.values(s.object(ctx.params.inputs)).filter(file=>!(typeof file==='string'&&/^\{[a-z0-9-]+\}$/.test(file))).map(file=>s.resource(ctx.cwd,ctx.processName,file));s.object(ctx.params.parameters);const loaded=rule(ctx);const contract=s.resource(ctx.cwd,ctx.processName,ctx.params.resultContract);s.loadContract(ctx.cwd,contract);return [...inputFiles,ctx.params.rulesFile,contract,...(loaded.files||[]).map(file=>file.startsWith('tools/')?file:s.resource(ctx.cwd,ctx.processName,file))];},
 prepare(ctx){evaluate(ctx);return {...ctx.params,inputs:s.object(ctx.params.inputs),parameters:s.object(ctx.params.parameters)};},
 validate(ctx){if(!isDeepStrictEqual(ctx.value,evaluate(ctx)))throw new Error('Результат не соответствует вычислению правила');}
};
module.exports.evaluate=evaluate;

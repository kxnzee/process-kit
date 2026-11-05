'use strict';
const fs=require('node:fs'),{inside}=require('../../tools/lib/core/safe-path'),s=require('../../tools/lib/actions/action-support');
function input(ctx){if(typeof ctx.params.inputText==='string'){if(!ctx.params.inputText.trim())throw new Error('Нужен непустой inputText');return ctx.params.inputText;}if(typeof ctx.params.text!=='string'||!ctx.params.text.trim())throw new Error('Нужен text (файл) или inputText');return fs.readFileSync(inside(ctx.cwd,ctx.params.text),'utf8');}
function facts(text){return [...new Set([...(text.match(/https?:\/\/[^\s)]+/g)||[]),...(text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g)||[]),...(text.match(/\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/gi)||[]),...(text.match(/\d+(?:[.,]\d+)*/g)||[])])];}
module.exports={
 dependencies(ctx){return [s.resource(ctx.cwd,ctx.processName,ctx.params.styleFile,ctx.requires)];},
 prepare(ctx){input(ctx);return ctx.params;},
 validate(ctx){const original=input(ctx);for(const fact of facts(original)){const escaped=fact.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=/^\d+(?:[.,]\d+)*$/.test(fact)?new RegExp('(?<!\\d)'+escaped+'(?!\\d)'):new RegExp(escaped,'i');if(!pattern.test(ctx.value))throw new Error('При редактировании потерян факт: '+fact);}}
};

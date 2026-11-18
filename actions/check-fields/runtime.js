'use strict';
const fs=require('node:fs'),{isDeepStrictEqual}=require('node:util'),s=require('../../tools/lib/actions/action-support');
function checks(ctx){const file=s.resource(ctx.cwd,ctx.processName,ctx.params.checksFile,ctx.requires),data=s.read(ctx.cwd,file);if(!Array.isArray(data.checks))throw new Error('checksFile: нужен checks[]');for(const item of data.checks){if(!item||typeof item.fieldId!=='string'||!['nonempty','equals','notNull','contains'].includes(item.check))throw new Error('Неверная проверка поля');if(item.check==='contains'&&!(typeof item.value==='string'&&item.value||Array.isArray(item.value)&&item.value.length&&item.value.every(v=>typeof v==='string'&&v)))throw new Error('contains: нужен непустой список строк');}return data.checks;}
function execute(ctx){
 const list=checks(ctx),records=typeof ctx.params.records==='object'?ctx.params.records:s.read(ctx.cwd,ctx.params.records),statusCounts={pass:0,fail:0,unreadable:0};
 const items=list.length?records.records.map(row=>{const results=list.map(rule=>{
  const present=Object.hasOwn(row,rule.fieldId),value=row[rule.fieldId];let status;
  if(!present)status='unreadable';else if(rule.check==='notNull')status=value===null?'fail':'pass';else if(typeof value!=='string')status='unreadable';else if(rule.check==='nonempty')status=/^(?:-|—|null|н\/д)?$/i.test(value.replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').trim())?'fail':'pass';else if(rule.check==='equals')status=value===String(rule.value)?'pass':'fail';else status=(Array.isArray(rule.value)?rule.value:[rule.value]).some(part=>value.includes(part))?'pass':'fail';
  statusCounts[status]++;const requirement=rule.check==='nonempty'?'заполнено':rule.check==='notNull'?'не null':rule.check==='equals'?'равно '+rule.value:'содержит '+(Array.isArray(rule.value)?rule.value.join(', '):rule.value);
  return {fieldId:rule.fieldId,label:rule.label||'',requirement,status,value:!present?null:rule.check==='notNull'?JSON.stringify(value).slice(0,300):typeof value==='string'?value.slice(0,300):String(value===null?'null':typeof value)};
 });return {key:row.key,summary:typeof row.summary==='string'?row.summary:'',results,failedCount:results.filter(result=>result.status!=='pass').length};}):[];
 return {checksFile:ctx.params.checksFile,processedCount:records.records.length,checkCount:list.length,skipped:!list.length,statusCounts,items};
}
module.exports={dependencies(ctx){checks(ctx);return [ctx.params.checksFile];},canExecute(){return true;},execute,validate(ctx){if(!isDeepStrictEqual(ctx.value,execute(ctx)))throw new Error('Результат не соответствует проверкам полей');}};

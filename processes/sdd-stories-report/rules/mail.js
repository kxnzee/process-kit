'use strict';
function evaluate(inputs,parameters){
 const report=inputs.report;
 if(!report?.meta||!Array.isArray(report.plainStories)||!report.plainStories.length)throw new Error('Нет историй без SDD для письма');
 const explicit=parameters.recipients;
 if(explicit!==undefined&&typeof explicit!=='string')throw new Error('Получатели должны быть строкой');
 const names=report.plainStories.map(row=>row.responsible||row.assignee).filter(value=>typeof value==='string'&&value.trim()&&value.trim()!=='—').map(value=>value.trim());
 const to=explicit?.trim()||[...new Set(names)].join('; ');
 if(!to)throw new Error('Нет получателей: уточните их у пользователя');
 return {to,subject:`SDD за ${report.meta.window}: истории без SDD`,meta:{window:report.meta.window,demo:report.meta.demo===true},stories:report.plainStories.map(row=>({key:row.key,summary:row.summary,url:row.url,responsible:row.responsible||row.assignee||'—'}))};
}
module.exports={evaluate};

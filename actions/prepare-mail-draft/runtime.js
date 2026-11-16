'use strict';
function recipients(value){
 if(Array.isArray(value)){if(value.some(item=>typeof item!=='string'))throw new Error('Нужны текстовые получатели черновика');value=value.map(item=>item.trim()).filter(Boolean);}
 else if(typeof value==='string')value=value.split(/[;,\r\n]+/).map(item=>item.trim()).filter(Boolean);
 else throw new Error('Нужны получатели черновика');
 const result=[...new Set(value)];
 if(!result.length||result.some(item=>/[\r\n\u0000-\u001f]/.test(item)))throw new Error('Нужны корректные получатели черновика');
 return result.join(', ');
}
function execute({params,inputs}){
 const to=recipients(params.to),subject=params.subject,body=inputs['report-text'];
 if(typeof subject!=='string'||!subject.trim()||/[\r\n\u0000-\u001f]/.test(subject))throw new Error('Нужна однострочная тема письма');
 if(typeof body!=='string'||!body.trim())throw new Error('Нужен текст тела письма');
 return `Статус: черновик\nКому: ${to}\nТема: ${subject}\n\n${body}`;
}
module.exports={canExecute:()=>true,execute,prepare(ctx){execute({...ctx,inputs:{'report-text':'preflight'}});return ctx.params;},validate(ctx){if(ctx.value!==execute(ctx))throw new Error('Черновик не соответствует получателям, теме или исходному телу: используйте run execute');}};

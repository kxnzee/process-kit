'use strict';
const {isDeepStrictEqual}=require('node:util');
const support=require('../../tools/lib/actions/action-support');
function dependencies(ctx){return ctx.params.peopleFile?[support.resource(ctx.cwd,ctx.processName,ctx.params.peopleFile,ctx.requires)]:[];}
function automatic(ctx){return ctx.params.mailMode==='off'||ctx.mode==='demo'||!!ctx.params.peopleFile;}
function execute(ctx){
 if(!automatic(ctx))throw new Error('Живой справочник читает агент после begin');
 if(ctx.params.peopleFile)return support.read(ctx.cwd,support.resource(ctx.cwd,ctx.processName,ctx.params.peopleFile,ctx.requires));
 const scores=ctx.inputs?.['score-table'];if(!scores)throw new Error('Нужен сохранённый score-table');
 const reason=ctx.params.offlineReason||(ctx.mode==='demo'?'ДАННЫЕ ДЕМО: почтовый справочник не опрашивался':'Почтовое подключение недоступно — справочник не опрашивался');
 const raw=String(ctx.params.goal??'').trim(),goal=raw?Number(raw.replace(',','.')):NaN;
 return Object.fromEntries(scores.employees.filter(person=>person.name&&(!Number.isFinite(goal)||typeof person.total==='number'&&person.total<goal)).map(person=>[person.name,{name:person.name,причина:reason}]));
}
module.exports={dependencies,canExecute:automatic,execute,validate(ctx){if(!automatic(ctx)){const scores=ctx.inputs['score-table'],raw=String(ctx.params.goal??'').trim(),goal=raw?Number(raw.replace(',','.')):NaN;const names=[...new Set(scores.employees.filter(p=>p.name&&(!Number.isFinite(goal)||typeof p.total==='number'&&p.total<goal)).map(p=>p.name))].sort();if(!isDeepStrictEqual(Object.keys(ctx.value).sort(),names))throw new Error('Карта должна охватывать всех адресатов рекомендаций');for(const [name,row]of Object.entries(ctx.value))if(!row||row.name!==name||!row.email&&!row.причина&&!Array.isArray(row.кандидаты))throw new Error('Нет адреса, кандидатов или причины');return;}const expected=execute(ctx);if(ctx.params.mailMode==='off'&&!ctx.params.peopleFile){if(!isDeepStrictEqual(Object.keys(ctx.value).sort(),Object.keys(expected).sort())||Object.entries(ctx.value).some(([name,row])=>row.name!==name||typeof row.причина!=='string'||!row.причина.trim()||row.email||row.кандидаты))throw new Error('Пропуск справочника должен сохранять причину без адресов');}else if(!isDeepStrictEqual(ctx.value,expected))throw new Error('Карта не соответствует выбранному локальному источнику');}};

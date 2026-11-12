'use strict';
const support=require('../../tools/lib/actions/action-support'),{pageUrl}=require('../../tools/lib/actions/page-url');
function dependencies(ctx){
 pageUrl(ctx.params.methodologyUrl);
 const files=[support.resource(ctx.cwd,ctx.processName,ctx.params.methodologyAdapterFile)];
 const notes=support.object(ctx.params.parameters).methodologyNotes;
 if(notes)files.push(support.resource(ctx.cwd,ctx.processName,notes));
 return files;
}
function prepare(ctx){
 const parameters=support.object(ctx.params.parameters);
 if(!parameters.methodologyMap||typeof parameters.methodologyMap!=='object'||Array.isArray(parameters.methodologyMap)||!Object.keys(parameters.methodologyMap).length)throw new Error('Нужен непустой methodologyMap');
 if(!['live','demo'].includes(ctx.mode))throw new Error('Сверка методики допускается только в live/demo');
 dependencies({...ctx,params:{...ctx.params,parameters}});
 return {parameters};
}
function validate(ctx){
 const v=ctx.value,parameters=support.object(ctx.params.parameters),expected=Object.keys(parameters.methodologyMap||{});
 if(v.mode!==ctx.mode||v.source.pageUrl!==ctx.params.methodologyUrl)throw new Error('Источник или режим сверки не соответствует запросу');
 if(v.total!==v.sections.length||v.matched+v.mismatched+v.unverified!==v.total)throw new Error('Счётчики сверки не соответствуют разделам');
 for(const status of ['matched','mismatched','unverified'])if(v[status]!==v.sections.filter(s=>s.status===status).length)throw new Error('Неверный счётчик сверки '+status);
 const actual=v.sections.map(s=>s.section);
 if(actual.length!==new Set(actual).size||JSON.stringify([...actual].sort())!==JSON.stringify(expected.sort()))throw new Error('Сверка должна охватывать все разделы methodologyMap');
 for(const row of v.unverifiedSections)if(v.sections.some(s=>s.section===row.section&&s.status!=='unverified'))throw new Error('Непрочитанный раздел не может быть подтверждён');
 for(const row of v.sections.filter(s=>s.status==='unverified'))if(!v.unverifiedSections.some(s=>s.section===row.section))throw new Error('Нет причины непроверенного раздела');
 if(ctx.mode==='live'&&(!v.source.connection?.trim()||(v.source.readToEnd&&(!v.source.version?.trim()||!v.source.updatedAt?.trim()))))throw new Error('Нет подтверждённых сведений о прочитанной версии методики');
}
module.exports={dependencies,prepare,validate};

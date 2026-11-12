'use strict';
const fs=require('node:fs'),{inside}=require('../../tools/lib/core/safe-path');
const support=require('../../tools/lib/actions/action-support'),{NAME}=require('../../tools/lib/entities/process-model');
function dependencies(ctx){
 const rule=ctx.params.rules||'classify-issuance';if(!NAME.test(rule))throw new Error('Нужно точное имя rules классификации');
 return [`actions/${ctx.actionName}/POLICY.md`,`actions/${ctx.actionName}/rules/${rule}.md`].map(file=>support.resource(ctx.cwd,ctx.processName,file));
}
function prepare(ctx){
 if(!['demo','live'].includes(ctx.mode))throw new Error('Классификация допускается только в live/demo');
 const value={relatedDepth:1,commentsLimit:20,...ctx.params};
 for(const key of ['relatedDepth','commentsLimit']){value[key]=Number(value[key]);if(!Number.isInteger(value[key])||value[key]<0)throw new Error(key+': нужно целое число >=0');}
 const selection=JSON.parse(fs.readFileSync(inside(ctx.cwd,value.records),'utf8'));
 if(!Array.isArray(selection.records))throw new Error('Нужна одна сохранённая выборка records');
 return value;
}
function validate(ctx){
 const v=ctx.value,selection=JSON.parse(fs.readFileSync(inside(ctx.cwd,ctx.params.records),'utf8'));
 if(v.mode!==ctx.mode||v.store!==(ctx.params.taskStore||'demo'))throw new Error('Режим или подключение классификации не соответствует шагу');
 if(v.policyFile!==`actions/${ctx.actionName}/POLICY.md`||v.rulesFile!==`actions/${ctx.actionName}/rules/${ctx.params.rules||'classify-issuance'}.md`)throw new Error('Классификация использовала другие правила');
 if(v.relatedDepth!==ctx.params.relatedDepth||v.commentsLimit!==ctx.params.commentsLimit||v.releaseCount!==selection.records.length)throw new Error('Пределы чтения или число релизов не соответствуют входу');
 const expected=selection.records.flatMap(r=>(r.members||[]).map(m=>r.key+':'+m.key)),actual=v.items.map(row=>row.release+':'+row.key);
 if(new Set(actual).size!==actual.length||JSON.stringify(actual.slice().sort())!==JSON.stringify(expected.slice().sort()))throw new Error('Классификация должна содержать каждую задачу входного состава ровно один раз');
 if(v.byClass.total!==v.items.length)throw new Error('Неверный total классификации');
 for(const cls of ['contained','technical','unknown'])if(v.byClass[cls]!==v.items.filter(row=>row.classification===cls).length)throw new Error('Неверный счётчик класса '+cls);
 for(const agreement of ['confirmed','reasoned','conflict','weak','question'])if(v.byAgreement[agreement]!==v.items.filter(row=>row.agreement===agreement).length)throw new Error('Неверный счётчик сверки '+agreement);
 for(const [field,status]of [['conflicts','conflict'],['weak','weak'],['questions','question']]){
  const keys=[...new Set(v.items.filter(row=>row.agreement===status).map(row=>row.key))].sort();
  if(JSON.stringify([...v[field]].sort())!==JSON.stringify(keys))throw new Error('Список '+field+' не соответствует классификации');
 }
 for(const item of v.items)if(item.classification!=='unknown'&&!item.basis?.trim())throw new Error('Класс без основания недопустим');
}
module.exports={dependencies,prepare,validate};

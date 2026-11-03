'use strict';
const {action}=require('./process-dependencies'),{validateValue,loadContract}=require('./value-contract');
function partition(groups){const seen=new Set();for(const rows of groups)for(const row of rows){if(seen.has(row.key))throw new Error('Группы содержат повторяющийся ключ '+row.key);seen.add(row.key);}}
function validateArtifact(cwd,actionName,port,extension,value,context={}){
 const meta=action(cwd,actionName),ref=meta.contracts[port];if(!ref)throw new Error('Необъявленный выход '+port);
 if(ref==='text'){if(!['md','txt'].includes(extension)||typeof value!=='string'||!value.trim())throw new Error('Нужен непустой текстовый результат');if(actionName==='compose-report'&&/\{\{[#/]|\{\{\w+\}\}/.test(value))throw new Error('В отчёте остались незаполненные переменные шаблона');return;}
 if(extension!=='json')throw new Error('Контракт требует JSON');if(ref!=='json')validateValue(loadContract(cwd,`actions/${actionName}/${ref}`),value);
 if(actionName==='run-query'){partition([value.stories,value.excluded,value.unverified]);if(value.stories.some(r=>['prs','prsComplete','via','commit'].some(k=>Object.hasOwn(r,k))))throw new Error('Источник задач не должен содержать свидетельства кода или расчёт');}
 if(actionName==='read-code-evidence'){partition([value.records]);if(context.taskRecords){const keys=new Set(context.taskRecords.stories.map(r=>r.key));if(value.selectionId!==context.taskRecords.selectionId||value.records.some(r=>!keys.has(r.key)))throw new Error('Свидетельства кода относятся к другому отбору');}}
 if(actionName==='assess-sdd'){
  if(context.taskRecords){const before=[...context.taskRecords.stories,...context.taskRecords.excluded,...context.taskRecords.unverified].map(r=>r.key).sort(),after=[...value.sddStories,...value.plainStories,...value.excluded,...value.unverified].map(r=>r.key).sort();if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Расчёт потерял или добавил ключи отбора');}
  partition([value.sddStories,value.plainStories,value.excluded,value.unverified]);const c=value.counters,total=value.sddStories.length+value.plainStories.length;
  if(c.storyCount!==total||c.sddCount!==value.sddStories.length||c.plainCount!==value.plainStories.length||c.unverifiedCount!==value.unverified.length)throw new Error('Счётчики не соответствуют группам');
  const label=value.sddStories.filter(r=>r.via==='метка'||r.via==='метка и PR').length,commit=value.sddStories.filter(r=>r.via==='PR с артефактами'||r.via==='метка и PR').length;
  if(c.labelCount!==label||c.commitCount!==commit||c.sddShare!==(total?(100*c.sddCount/total).toFixed(1).replace('.',','):'0'))throw new Error('Показатели не соответствуют готовым группам');
 }
}
module.exports={validateArtifact};

'use strict';
const {selectionId}=require('./query-data');
function evidenceFromFixture(fixture,tasks,queryFile){
 if(!tasks||!Array.isArray(tasks.records)||tasks.selectionId!==selectionId(tasks))throw new Error('Нужен сохранённый task-records');
 const inputKeys=tasks.records.map(row=>row.key);
 if(inputKeys.some(key=>typeof key!=='string'||!key.trim())||new Set(inputKeys).size!==inputKeys.length)throw new Error('Нужны уникальные входные key');
 const data=fixture?.codeEvidence;
 if(typeof queryFile!=='string'||data?.queryFile!==queryFile||!Array.isArray(data.records))throw new Error('фикстура кода не соответствует выбранному запросу');
 const keys=data.records.map(row=>row?.key);
 if(keys.some(key=>typeof key!=='string'||!key.trim())||new Set(keys).size!==keys.length)throw new Error('Нужны уникальные key свидетельств кода');
 const index=new Map(data.records.map(row=>[row.key,row]));
 return {selectionId:tasks.selectionId,queryFile,records:inputKeys.map(key=>index.has(key)?structuredClone(index.get(key)):{key,prsComplete:false,reason:'В демоданных нет свидетельств для ключа'})};
}
module.exports={evidenceFromFixture};

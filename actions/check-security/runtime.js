'use strict';
const s=require('../../tools/lib/actions/action-support');
module.exports={validate(ctx){const records=s.read(ctx.cwd,ctx.params.records),value=ctx.value;
 if(value.items.length!==records.records.length||value.checkedCount!==records.records.length)throw new Error('Неполная проверка безопасности');
 for(const [i,item]of value.items.entries()){
  const row=records.records[i];if(item.key!==row.key||item.summary!==(typeof row.summary==='string'?row.summary:''))throw new Error('Подменена запись проверки безопасности');
  if(item.violation!==!!item.findings.length)throw new Error('Нарушение и находки не согласованы');
  for(const finding of item.findings)if(typeof row[finding.place]!=='string'||!row[finding.place].includes(finding.quote))throw new Error('Находка должна цитировать исходное поле');
  for(const field of item.unreadFields)if(typeof row[field]==='string')throw new Error('Читаемое поле объявлено нечитаемым');
 }
 if(value.violationCount!==value.items.filter(item=>item.violation).length||value.unreadableCount!==value.items.filter(item=>item.unreadFields.length).length)throw new Error('Неверные счётчики безопасности');
}};

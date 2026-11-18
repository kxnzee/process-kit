'use strict';
const s=require('../../tools/lib/actions/action-support');
function manifest(ctx){const file=s.resource(ctx.cwd,ctx.processName,ctx.params.manifestFile,ctx.requires),list=s.read(ctx.cwd,file);if(!Array.isArray(list))throw new Error('manifestFile: нужен массив');for(const item of list){if(!item||typeof item.field!=='string'||!item.field)throw new Error('Манифест: нужно поле');s.resource(ctx.cwd,ctx.processName,item.rulesFile,ctx.requires);}return list;}
function execute(ctx){if(manifest(ctx).length)throw new Error('Текстовые правила проверяет агент после begin');const records=s.read(ctx.cwd,ctx.params.records);return {manifestFile:ctx.params.manifestFile,processedCount:records.records.length,totalFailedCount:0,skipped:true,sections:[]};}
module.exports={dependencies(ctx){return [ctx.params.manifestFile,...manifest(ctx).map(item=>item.rulesFile)];},canExecute(ctx){return !manifest(ctx).length;},execute,validate(ctx){
 const list=manifest(ctx),value=ctx.value,records=s.read(ctx.cwd,ctx.params.records);
 if(value.manifestFile!==ctx.params.manifestFile||value.processedCount!==records.records.length||value.skipped!==!list.length||value.sections.length!==list.length)throw new Error('Проверка правил не соответствует манифесту или выборке');
 let total=0;for(const [index,section]of value.sections.entries()){
  const declared=list[index];if(section.field!==declared.field||section.rulesFile!==declared.rulesFile||section.items.length!==records.records.length)throw new Error('Неверная секция правил');
  const counts={pass:0,fail:0,unknown:0,unreadable:0};
  for(const [i,item]of section.items.entries()){const row=records.records[i];if(item.key!==row.key||item.summary!==(typeof row.summary==='string'?row.summary:''))throw new Error('Подменена запись проверки');
   if(item.results.length!==section.ruleCount||new Set(item.results.map(r=>r.ruleId)).size!==item.results.length)throw new Error('Неполный состав правил');
   for(const result of item.results){counts[result.status]++;if(result.status==='pass'&&!result.basis||result.basis&&(typeof row[section.field]!=='string'||!row[section.field].includes(result.basis)))throw new Error('Основание должно быть цитатой поля');}
   const failed=item.results.filter(r=>r.status!=='pass').length;if(item.failedCount!==failed)throw new Error('Неверный failedCount');total+=failed;
  }
  for(const key of Object.keys(counts))if(section.statusCounts[key]!==counts[key])throw new Error('Неверные счётчики правил');
 }
 if(value.totalFailedCount!==total)throw new Error('Неверный totalFailedCount');
}};

'use strict';
const cell=value=>String(value??'—').replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
function render(data,options={}){
 const m=data.meta,c=data.counters;
 for(const key of ['reportTitle','generatedAt','window','label','statusesAccepted','taskStoreName','codeStoreName','queryFile'])if(typeof m?.[key]!=='string'||!m[key].trim())throw new Error('Нет обязательного meta.'+key);
 for(const key of ['storyCount','sddCount','plainCount','labelCount','commitCount','sddShare','unverifiedCount'])if(c?.[key]===undefined)throw new Error('Нет обязательного counters.'+key);
 for(const key of ['sddStories','plainStories','unverified'])if(!Array.isArray(data[key]))throw new Error('Нет массива '+key);
 const lines=[`# ${m.reportTitle}`,'',`Дата: ${m.generatedAt} · Окно: ${m.window} · Метка: ${m.label} · Засчитаны статусы: ${m.statusesAccepted}`,`Задачи: ${m.taskStoreName} · Код: ${m.codeStoreName}`,`Запрос: ${m.queryFile} · Шаблон: ${options.templateFile||'report.md'}`,''];
 if(m.demo)lines.push('**ДАННЫЕ ДЕМО**','');
 lines.push('## Итог','','| Показатель | Значение |','|---|---|',`| Стори в выборке | ${c.storyCount} |`,`| Выполнено по SDD | ${c.sddCount} — с меткой ${c.labelCount}, через PR с артефактами ${c.commitCount} |`,`| Выполнено без SDD | ${c.plainCount} |`,`| Доля SDD | ${c.sddShare} % |`,`| Проверить не удалось (в расчёт не входят) | ${c.unverifiedCount} |`,'');
 function table(title,headers,rows){lines.push('## '+title,'','| '+headers.join(' | ')+' |','|'+headers.map(()=>'---').join('|')+'|');if(rows.length)for(const row of rows)lines.push('| '+row.map(cell).join(' | ')+' |');else lines.push('нет записей');lines.push('');}
 table('Стори, выполненные по SDD',['Задача','Статус','В работе с','Засчитано по','Коммит','Ответственный'],data.sddStories.map(r=>[r.key,r.status,r.inProgressAt,r.via,r.commit,r.responsible]));
 table('Стори, выполненные без SDD',['Задача','Статус','В работе с','Ответственный'],data.plainStories.map(r=>[r.key,r.status,r.inProgressAt,r.responsible]));
 table('Проверить не удалось',['Задача','Причина'],data.unverified.map(r=>[r.key,r.reason]));
 lines.push('## Ссылки','');for(const r of [...data.sddStories,...data.plainStories])lines.push(`- ${r.key}: ${r.url}`);
 lines.push('','## Как читать этот отчёт','',`- Отбор определяется периодом начала работы, текущим статусом и КЭ. Метка ${m.label} и принятый PR классифицируют уже отобранные истории.`,`- По SDD: метка ${m.label} или подтверждённый принятый PR с изменениями спецификаций.`,`- Без SDD: оба признака проверены и отсутствуют. Непроверенные истории не входят в знаменатель.`);
 return lines.join('\n')+'\n';
}
function validate(text,data,options){if(text.replace(/\r\n/g,'\n').trim()!==render(data,options).trim())throw new Error('Отчёт не соответствует данным и форме процесса: используйте штатное формирование');}
module.exports={render,validate};

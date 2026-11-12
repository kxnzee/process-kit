'use strict';
// Export a limited, allowlisted view of a run. Never copy input, parameters or raw errors.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {inside}=require('../core/safe-path'),{validRunFolderName}=require('../core/paths');
const NAME=/^[a-z0-9][a-z0-9-]*$/;
function identifier(value){return typeof value==='string'&&NAME.test(value)&&value.length<=100?value:'не определено';}
function timestamp(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)?value:'не определено';}
function category(reason){
 if(typeof reason!=='string')return 'нет сохранённой причины';
 const rules=[
  [/Изменён вход|Изменён сохранённый шаг|Изменены параметры|Изменён результат|Изменён состав зависимостей|Нарушена согласованность/i,'нарушена целостность данных запуска'],
  [/ECONN|ETIMEDOUT|timeout|тайм.?аут|недоступ|не удалось подключ|отказано в доступе|403|401/i,'источник или подключение недоступны'],
  [/ENOENT|не найден|не найдено|нет файла|отсутствует файл/i,'не найден необходимый файл или ресурс'],
  [/контракт|схем|формат|JSON|неверн|нужен|отсутствует|не совпада/i,'ошибка входных данных или проверки результата'],
 ];
 return rules.find(([pattern])=>pattern.test(reason))?.[1]||'не определена по сохранённым данным';
}
function report(cwd,output){
 if(!validRunFolderName(output))throw new Error('Укажите точное имя папки запуска');
 const folder=inside(cwd,'outputs/'+output),dir=inside(folder,'.run');
 if(!fs.statSync(dir,{throwIfNoEntry:false})?.isDirectory())throw new Error('Журнал выбранного запуска не найден');
 let state={},stateIssue=null;try{state=JSON.parse(fs.readFileSync(inside(dir,'state.json'),'utf8'));if(!state||typeof state!=='object'||Array.isArray(state))throw Error();}catch{state={};stateIssue='состояние отсутствует или повреждено';}
 let consistency=null;try{const verified=require('./run-storage').verify(dir);if(state.schemaVersion===2&&!verified)consistency='отсутствует контрольная запись';}catch{consistency='состояние и журнал не согласованы';}
 let events=[],traceIssue=null;try{
  const data=fs.readFileSync(inside(dir,'trace.jsonl'),'utf8');
  for(const line of data.split('\n').filter(Boolean)){try{const item=JSON.parse(line);if(item&&typeof item==='object')events.push(item);}catch{traceIssue='есть повреждённые записи';}}
 }catch{traceIssue='история событий отсутствует или недоступна';}
 let revision='не определена';try{const v=execFileSync('git',['rev-parse','--verify','HEAD'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();if(/^[a-f0-9]{40,64}$/i.test(v))revision=v;}catch{}
 const processName=identifier(state.identity?.process),snapshot=state.identity?.files?.[`processes/${processName}/PROCESS.md`];
 const processHash=typeof snapshot==='string'&&/^[a-f0-9]{64}$/.test(snapshot)?snapshot:'не определён';
 const status=['running','failed','completed'].includes(state.status)?state.status:'не определён';
 const mode=['live','local','demo'].includes(state.identity?.mode)?state.identity.mode:'не определён';
 const allowed=new Set(['started','step_started','step_completed','branch_decision','process_entered','process_left','finished','step_retry_authorized']);
 const lines=['# Диагностика запуска','',`Создано: ${new Date().toISOString()}`,`Процесс: ${processName}`,`Отпечаток описания процесса при запуске: ${processHash}`,`Режим: ${mode}`,`Статус: ${status}`,`Текущий процесс: ${identifier(state.cursorProcess)}`,`Текущий шаг: ${identifier(state.pending?.step||state.next_step)}`,`Последний завершённый шаг: ${identifier(state.last_step_name)}`,`Категория сбоя: ${category(state.failure?.reason)}`,`Обновлено: ${timestamp(state.updated)}`,`Версия Node.js: ${process.version}`,`Коммит текущей рабочей копии: ${revision}`,'Коммит не подтверждает отсутствие локальных изменений и может отличаться от версии во время запуска.',...(stateIssue?[`Состояние: ${stateIssue}`]:[]),...(traceIssue?[`История: ${traceIssue}`]:[]),...(consistency?[`Целостность: ${consistency}`]:[]),'','## События'];
 const safeEvents=events.filter(e=>allowed.has(e.type));
 if(!safeEvents.length)lines.push('Подходящих записей нет.');
 for(const e of safeEvents)lines.push(`- ${timestamp(e.ts)} | ${e.type} | процесс: ${identifier(e.process)} | шаг: ${identifier(e.step)}`);
 lines.push('','## Для разработчика','Сопоставьте события с определением процесса и версией реализации. Категория сбоя приблизительная, это не установленная причина. Данных может быть недостаточно для воспроизведения.','В отчёт не включены исходные данные, параметры, содержимое результатов, сырые ошибки и переписка. Проверьте отчёт перед передачей.','','');
 const bytes=lines.join('\n');let target;
 for(let i=1;i<=999;i++){const name=i===1?'диагностика.md':`диагностика-${i}.md`;target=inside(folder,name);try{fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});return {reportFile:target,status,events:safeEvents.length};}catch(error){if(error.code!=='EEXIST')throw error;}}
 throw new Error('Не удалось выбрать свободное имя диагностического файла');
}
module.exports={report,category};

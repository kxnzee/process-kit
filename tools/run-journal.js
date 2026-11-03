#!/usr/bin/env node
'use strict';
// Persistence only: GigaCode executes actions and chooses branches. No tests, MCP or step execution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {root,runFolderUnique,validRunFolderName}=require('./paths');
const {processModel,NAME}=require('./process-model');
const {updateHistory}=require('./history');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function inside(base,relative){if(typeof relative!=='string'||path.isAbsolute(relative))throw new Error('Нужен относительный путь');const file=path.resolve(base,relative);if(file!==path.resolve(base)&&!file.startsWith(path.resolve(base)+path.sep))throw new Error('Путь выходит из папки');let at=path.resolve(base);for(const part of path.relative(base,file).split(path.sep).filter(Boolean)){at=path.join(at,part);if(fs.lstatSync(at,{throwIfNoEntry:false})?.isSymbolicLink())throw new Error('Ссылки не допускаются');}return file;}
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{fs.rmSync(tmp,{force:true});}}
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const now=()=>new Date().toISOString();
function rows(dir){const file=inside(dir,'trace.jsonl');return fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];}
function event(dir,type,data={}){const row={ts:now(),type,...data};fs.appendFileSync(inside(dir,'trace.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});fs.appendFileSync(inside(dir,'run.md'),`${row.ts} ${type}${data.step?' '+data.step:''}\n`);return row;}
function dateValue(value){if(typeof value!=='string')return null;const m=value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);const iso=m?`${m[3]}-${m[2]}-${m[1]}`:value;if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))return null;const d=new Date(iso+'T00:00:00Z');return Number.isNaN(+d)||d.toISOString().slice(0,10)!==iso?null:iso;}
function effectiveParams(cwd,spec,defaults={}){
 const params={...defaults,...spec.params,...spec.explicitParams};
 for(const key of ['startDate','endDate'])if(params[key]==='today')params[key]=spec.date;
 if(Object.keys(params).some(k=>/token|password|secret|authorization/i.test(k)))throw new Error('Секреты не являются параметрами');
 if(spec.mode==='demo'&&params.dataFile){
  const fixture=json(inside(cwd,params.dataFile)),window=fixture.meta?.window;
  const match=typeof window==='string'&&window.match(/^(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})\s*[—–]\s*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})$/);
  if(window&&!match)throw new Error('Неверный период demo-фикстуры');
  if(match){for(const [key,value]of [['startDate',match[1]],['endDate',match[2]]]){if(!dateValue(value))throw new Error('Неверная дата demo');if(Object.hasOwn(spec.explicitParams||{},key)&&dateValue(spec.explicitParams[key])!==dateValue(value))throw new Error('Явный период не совпадает с demo-фикстурой');params[key]=value;}if(dateValue(match[1])>dateValue(match[2]))throw new Error('Обратный период demo');}
 }
 return params;
}
function summary(cwd,output,state,spec={}){const folder=inside(cwd,'outputs/'+output),demo=state.identity.mode==='demo',status=state.status==='completed'?'готово':state.status==='failed'?'не получилось: '+(spec.reason||'шаг остановлен'):'выполняется';atomic(inside(folder,'итог.md'),`# ${state.title}\nДата: ${state.updated}\nЧем закончилось: ${demo?'Пробный прогон, ничего не отправлено. ':''}${status}\nЧто сделано: ${spec.summary||'Завершено шагов: '+state.last_step+'.'}\nОткуда данные: ${demo?'тестовые данные выбранной фикстуры':state.identity.mode==='local'?'переданный текст':'объявленные подключения'}\nЧто отправлено и кому: ${state.identity.mode==='live'?'см. подтверждённые результаты шагов':'ничего не отправлено'}\n${state.result?'Файлы в этой папке:\n- '+state.result+' — результат\n':''}`);}
function start(cwd,spec){
 if(spec.inputText!==undefined&&typeof spec.inputText!=='string')throw new Error('inputText должен быть текстом');
 if(!NAME.test(spec.process||'')||!['local','live','demo'].includes(spec.mode))throw new Error('Нужны process и mode');
 const model=processModel(fs.readFileSync(inside(cwd,`processes/${spec.process}.md`),'utf8'));if(model.errors.length)throw new Error(model.errors.join('; '));
 const params=effectiveParams(cwd,spec,model.data.params||{}),slug=(spec.mode==='demo'?'проба-':'')+(spec.slug||spec.process);
 const proposed=runFolderUnique(cwd,`${spec.date}_${slug}`);if(!proposed)throw new Error('Неверное/занятое имя output');const output=path.basename(proposed),dir=inside(cwd,`outputs/${output}/.run`);
 const files=new Set([`processes/${spec.process}.md`,'tools/run-journal.js',...(spec.files||[])]);
 for(const step of model.steps)if(step.kind==='action')files.add(`actions/${step.ref}/ACTION.md`);
 for(const context of model.data.requires?.context||[])files.add(context.startsWith('context/')?context:'context/'+context);
 if(fs.existsSync(inside(cwd,'context/common.md')))files.add('context/common.md');
 if(model.steps.some(step=>step.ref==='assess-sdd'))files.add('tools/sdd-data.js');
 if(params.dataFile){if(spec.mode!=='demo')throw new Error('dataFile только для demo');files.add(params.dataFile);}
 const snapshots={};for(const file of files){if(!/^(processes|actions|context|adapters|config|docs|tools|tests)\//.test(file)&&file!=='.gigacode/settings.json')throw new Error('Недопустимый файл снимка');if(file.startsWith('tests/')&&!(spec.mode==='demo'&&file===params.dataFile))throw new Error('Тестовый эталон не является входом рабочего запуска');snapshots[file]=hash(fs.readFileSync(inside(cwd,file)));}
 fs.mkdirSync(dir,{recursive:true});
 if(spec.inputText!==undefined){if(typeof spec.inputText!=='string')throw new Error('inputText должен быть текстом');atomic(inside(dir,'inputs/input.md'),spec.inputText);params.input=path.relative(cwd,inside(dir,'inputs/input.md'));snapshots[params.input]=hash(spec.inputText);}
 const state={last_step:0,last_step_name:'',next_step:model.entry,status:'running',params,updated:now(),artifacts:{},artifactHashes:{},pending:null,title:String(spec.title||model.data.title||model.data.description||spec.process).replace(/[\r\n]/g,' '),identity:{process:spec.process,mode:spec.mode,params:structuredClone(params),hashAlgorithm:'sha256',files:snapshots}};
 atomic(inside(dir,'state.json'),state);atomic(inside(dir,'run.md'),'# Прогон '+spec.process+'\nGigaCode исполняет шаги; скрипт сохраняет состояние.\n');event(dir,'started',{process:spec.process,mode:spec.mode});summary(cwd,output,state);return {output,state,readFiles:Object.keys(snapshots),note:'Используйте state.params как единственные эффективные параметры. Следующий шаг выполняет агент.'};
}
function operation(cwd,command,spec){
 if(!validRunFolderName(spec.output))throw new Error('Неверный output');const dir=inside(cwd,`outputs/${spec.output}/.run`),lock=inside(dir,'.journal.lock');fs.mkdirSync(lock);
 try{
  const state=json(inside(dir,'state.json'));
  for(const [file,digest]of Object.entries(state.identity.files))if(hash(fs.readFileSync(inside(cwd,file)))!==digest)throw new Error('Изменён вход: '+file);
  if(JSON.stringify(state.params)!==JSON.stringify(state.identity.params))throw new Error('Изменены параметры');
  for(const [name,file]of Object.entries(state.artifacts))if(hash(fs.readFileSync(inside(dir,file)))!==state.artifactHashes[name])throw new Error('Изменён результат: '+name);
  if(command==='begin'){
   if(state.status!=='running'||state.pending)throw new Error('Сначала завершите сохранение текущего шага');
   const process=spec.process||state.identity.process;if(!Object.hasOwn(state.identity.files,`processes/${process}.md`))throw new Error('Процесс не включён в снимок');
   const model=processModel(fs.readFileSync(inside(cwd,`processes/${process}.md`),'utf8')),step=model.steps.find(s=>s.name===spec.step);
   if(!step||step.kind!=='action')throw new Error('Нужен объявленный шаг действия');
   if(process===state.identity.process&&spec.step!==state.next_step){const branch=model.steps.find(s=>s.name===state.next_step);if(branch?.kind!=='branch'||!branch.targets.includes(spec.step)||!spec.decision)throw new Error('Шаг не соответствует сохранённой позиции');event(dir,'branch_decision',{step:branch.name,next:spec.step,reason:spec.decision});}
   state.pending={id:crypto.randomUUID(),step:spec.step,process,index:state.last_step+1};event(dir,'step_started',{...state.pending});
  }else if(command==='save'){
   if(state.status!=='running'||!state.pending||state.pending.step!==spec.step)throw new Error('Сначала begin этого шага');
   if(!NAME.test(spec.artifact||'')||!['json','md','txt'].includes(spec.extension))throw new Error('Нужны artifact и extension');
   const model=processModel(fs.readFileSync(inside(cwd,`processes/${state.pending.process}.md`),'utf8')),step=model.steps.find(s=>s.name===spec.step);
   if(step.artifact!==spec.artifact)throw new Error('Артефакт не соответствует шагу');
   let value=spec.content;
   if(spec.artifact==='task-records'&&spec.extension==='json'){value=typeof value==='string'?JSON.parse(value):structuredClone(value);value.selectionId=require('./sdd-data').selectionId(value);}
   const content=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';if(typeof content!=='string')throw new Error('Нет content');
   if(spec.extension==='json'){const data=JSON.parse(content);if(data.meta?.window&&state.params.startDate&&state.params.endDate){const match=data.meta.window.match(/^(.*?)\s*[—–]\s*(.*?)$/);if(!match||dateValue(match[1])!==dateValue(state.params.startDate)||dateValue(match[2])!==dateValue(state.params.endDate))throw new Error('Период артефакта не совпадает с состоянием');}}
   if(spec.next!==step.next)throw new Error('Следующий узел не соответствует процессу');
   if(spec.next!=='end'&&!model.steps.some(s=>s.name===spec.next))throw new Error('Неверный следующий узел');
   const file=String(state.pending.index).padStart(2,'0')+'-'+spec.step+'.'+spec.extension,full=inside(dir,file);
   if(fs.existsSync(full)){if(hash(fs.readFileSync(full))!==hash(content))throw new Error('Незавершённая фиксация содержит другой результат');}else fs.writeFileSync(full,content,{flag:'wx',mode:0o600});
   if(!rows(dir).some(e=>e.type==='step_completed'&&e.id===state.pending.id))event(dir,'step_completed',{...state.pending,artifact:spec.artifact,file,hash:hash(content)});
   state.artifacts[spec.artifact]=file;state.artifactHashes[spec.artifact]=hash(content);state.last_step=state.pending.index;state.last_step_name=spec.step;state.last_artifact=spec.artifact;state.next_step=spec.next;state.pending=null;
  }else if(command==='finish'||command==='fail'){
   if(command==='finish'){
    if(!['running','completed'].includes(state.status)||state.pending||!state.last_step)throw new Error('Шаг не завершён или прогон остановлен');
    if(state.next_step!=='end'){const model=processModel(fs.readFileSync(inside(cwd,`processes/${state.identity.process}.md`),'utf8')),branch=model.steps.find(s=>s.name===state.next_step);if(branch?.kind!=='branch'||!branch.targets.includes('end')||typeof spec.decision!=='string'||!spec.decision.trim())throw new Error('Нужен явный выбор завершить маршрут');if(state.status!=='completed')event(dir,'branch_decision',{step:branch.name,next:'end',reason:spec.decision});}
    if(spec.resultName==='итог.md'||/^\d{2}-/.test(spec.resultName||''))throw new Error('Зарезервированное имя результата');
    if(!/^[^./\\][^/\\]*\.(md|txt|json)$/.test(spec.resultName||''))throw new Error('Нужно имя файла для человека');
    const last=state.artifacts[state.last_artifact],bytes=fs.readFileSync(inside(dir,last)),human=inside(cwd,`outputs/${spec.output}/${spec.resultName}`);
    if(fs.existsSync(human)&&!fs.readFileSync(human).equals(bytes))throw new Error('Другой результат уже существует');if(!fs.existsSync(human))fs.writeFileSync(human,bytes,{flag:'wx',mode:0o600});state.result=spec.resultName;state.next_step='end';state.status='completed';
   }else{if(state.status==='completed')throw new Error('Завершённый прогон нельзя объявить неудачным');state.status='failed';}
   if(!rows(dir).some(e=>e.type==='finished'&&e.status===state.status))event(dir,'finished',{status:state.status});
  }else throw new Error('Неизвестная операция');
  state.updated=now();atomic(inside(dir,'state.json'),state);summary(cwd,spec.output,state,spec);
  if(['completed','failed'].includes(state.status))updateHistory(cwd,{ts:state.updated,process:state.identity.process,режим:state.identity.mode,output:spec.output,итог:(state.identity.mode==='demo'?'Пробный прогон, ничего не отправлено. ':'')+(state.status==='completed'?'готово':'не получилось: '+(spec.reason||'шаг остановлен')),outcome:state.status==='completed'?(state.last_artifact==='mail-draft'?'draft':'success'):'failed'});
  return state;
 }finally{fs.rmdirSync(lock);}
}
module.exports={start,operation,effectiveParams};
if(require.main===module){try{const [cmd,file,...rest]=process.argv.slice(2);if(rest.length||!file||!['start','begin','save','finish','fail'].includes(cmd))throw new Error('run-journal.js start/begin/save/finish/fail <spec.json>');const spec=json(file);console.log(JSON.stringify(cmd==='start'?start(root(),spec):operation(root(),cmd,spec),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}

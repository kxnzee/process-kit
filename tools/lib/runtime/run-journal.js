#!/usr/bin/env node
'use strict';
// Journal and declared local execution. The agent handles model work, MCP and branch decisions; no tests or automatic act.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {root,runFolderUnique,validRunFolderName}=require('../core/paths');
const {processModel,NAME}=require('../entities/process-model');
const {inside}=require('../core/safe-path');
const {dependencies,action,stepParams,childParams}=require('../entities/process-dependencies');
const {validateArtifact}=require('../contracts/artifact-contract');
const {updateHistory}=require('./history');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
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
  const fixture=json(inside(cwd,params.dataFile)),window=fixture.result?.meta?.window;
  const match=typeof window==='string'&&window.match(/^(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})\s*[—–]\s*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})$/);
  if(window&&!match)throw new Error('Неверный период demo-фикстуры');
  if(match){for(const [key,value]of [['startDate',match[1]],['endDate',match[2]]]){if(!dateValue(value))throw new Error('Неверная дата demo');if(Object.hasOwn({...spec.params,...spec.explicitParams},key)&&dateValue(params[key])!==dateValue(value))throw new Error('Явный период не совпадает с demo-фикстурой');params[key]=value;}if(dateValue(match[1])>dateValue(match[2]))throw new Error('Обратный период demo');}
 }
 return params;
}
function humanDate(value){const date=new Date(value);if(Number.isNaN(+date))return String(value);return date.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});}
// Файлы для человека вне .run/: имя артефакта → имя файла, заданное при finish.
function humanFiles(state){const result=state.result?{[state.stepResult||'result']:state.result}:{};return {...result,...(state.published||{})};}
// Факты для выбора на развилке: только счётчики из уже сохранённых артефактов, без чтения служебных файлов агентом.
function facts(artifacts){
 const result=[];
 for(const file of Object.values(artifacts)){
  if(!file.endsWith('.json'))continue;
  let data;try{data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{continue;}
  const c=data?.counters;if(!c||typeof c!=='object')continue;
  if(Number.isInteger(c.plainCount))result.push(`историй без SDD: ${c.plainCount}`);
  if(typeof c.sddShare==='string')result.push(`доля SDD: ${c.sddShare} %`);
 }
 return result;
}
function summary(cwd,output,state,spec={}){
 const folder=inside(cwd,'outputs/'+output),demo=state.identity.mode==='demo',status=state.status==='completed'?'готово':state.status==='failed'?'не получилось: '+(spec.reason||'шаг остановлен'):'выполняется',files=humanFiles(state);
 const listed=[...new Set(Object.values(files))];
 atomic(inside(folder,'итог.md'),`# ${state.title}\nДата: ${humanDate(state.identity.date||state.updated)}\nЧем закончилось: ${demo&&status==='готово'?'пробный прогон на вымышленных данных, ничего не отправлялось':demo?'пробный прогон, ничего не отправлялось; '+status:status}\nЧто сделано: ${spec.summary||'Завершено шагов: '+state.last_step+'.'}\nОткуда данные: ${demo?'тестовые данные выбранной фикстуры':state.identity.mode==='local'?(state.sourceDescription||'локальные файлы и артефакты процесса'):'внешние источники процесса'}\nЧто отправлено и кому: ${state.identity.mode==='live'?'см. подтверждённые результаты шагов':'ничего не отправлено'}\n${listed.length?'Файлы в этой папке:\n'+listed.map(name=>'- '+name).join('\n')+'\n':''}`);}
function start(cwd,spec){
 const current=new Date();spec={...spec,date:spec.date??`${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`};
 if(spec.inputText!==undefined&&typeof spec.inputText!=='string')throw new Error('inputText должен быть текстом');
 if(!NAME.test(spec.process||'')||!['local','live','demo'].includes(spec.mode))throw new Error('Нужны process и mode');
 const model=processModel(fs.readFileSync(inside(cwd,`processes/${spec.process}/PROCESS.md`),'utf8'));if(model.errors.length)throw new Error(model.errors.join('; '));
 const params=effectiveParams(cwd,spec,model.data.params||{}),slug=(spec.mode==='demo'?'проба-':'')+(spec.slug||spec.process);
 const proposed=runFolderUnique(cwd,`${spec.date}_${slug}`);if(!proposed)throw new Error('Неверное/занятое имя output');const output=path.basename(proposed),dir=inside(cwd,`outputs/${output}/.run`);
 const overrides=Object.fromEntries(Object.keys({...spec.params,...spec.explicitParams}).map(key=>[key,params[key]]));
 const files=new Set(dependencies(cwd,spec.process,params,spec.mode,spec.files||[],overrides));
 const resolved=require('../entities/entities').manifest(cwd,spec.process,params,spec.mode,overrides),connections=resolved.connections;
 if(connections&&!connections.ready)throw new Error(connections.missing.map(item=>item.reason).join('; '));
 const snapshots={};for(const file of files){if(!/^(processes|actions|context|adapters|config|docs|tools)\//.test(file)&&file!=='.gigacode/settings.json')throw new Error('Недопустимый файл снимка');snapshots[file]=hash(fs.readFileSync(inside(cwd,file)));}
 fs.mkdirSync(dir,{recursive:true});
 if(spec.inputText!==undefined){if(typeof spec.inputText!=='string')throw new Error('inputText должен быть текстом');atomic(inside(dir,'inputs/input.md'),spec.inputText);params.input=path.relative(cwd,inside(dir,'inputs/input.md'));snapshots[params.input]=hash(spec.inputText);}
 const state={sourceDescription:spec.inputText!==undefined?'переданный текст пользователя':'локальные файлы и артефакты процесса',last_step:0,last_step_name:'',next_step:model.entry,status:'running',params,updated:now(),artifacts:{},artifactHashes:{},recordedArtifacts:{},published:{},pending:null,cursorProcess:spec.process,stack:[],scopeParams:structuredClone(params),title:String(spec.title||model.data.title||model.data.description||spec.process).replace(/[\r\n]/g,' '),identity:{process:spec.process,mode:spec.mode,date:spec.date,extraFiles:spec.files||[],overrides,params:structuredClone(params),hashAlgorithm:'sha256',files:snapshots}};
 atomic(inside(dir,'state.json'),state);atomic(inside(dir,'run.md'),'# Прогон '+spec.process+'\nGigaCode исполняет шаги; скрипт сохраняет состояние.\n');event(dir,'started',{process:spec.process,mode:spec.mode});summary(cwd,output,state);return {output,outputDir:path.dirname(dir),summaryFile:path.join(path.dirname(dir),'итог.md'),state,connections,entities:resolved.entities,readFiles:resolved.readFiles,files:Object.keys(snapshots),note:'Используйте state.params как единственные эффективные параметры. Вы — исполнитель. Продолжайте через run next/execute до finish либо зафиксированного fail; preflight не завершает задачу.'};
}
function operation(cwd,command,spec){
 if(!validRunFolderName(spec.output))throw new Error('Неверный output');const dir=inside(cwd,`outputs/${spec.output}/.run`),lock=inside(dir,'.journal.lock');fs.mkdirSync(lock);
 try{
  const state=json(inside(dir,'state.json'));
  for(const [file,digest]of Object.entries(state.identity.files))if(hash(fs.readFileSync(inside(cwd,file)))!==digest)throw new Error('Изменён вход: '+file);
  const inventory=dependencies(cwd,state.identity.process,state.identity.params,state.identity.mode,state.identity.extraFiles||[],state.identity.overrides);
  const expected=Object.keys(state.identity.files).filter(file=>file!==state.identity.params.input).sort();
  if(JSON.stringify(inventory.sort())!==JSON.stringify(expected))throw new Error('Изменён состав зависимостей; нужен новый запуск');
  state.stack ||= [];state.cursorProcess ||= state.identity.process;
  for(const [file,digest]of Object.entries(state.recordedArtifacts||{}))if(hash(fs.readFileSync(inside(dir,file)))!==digest)throw new Error('Изменён сохранённый шаг: '+file);
  if(JSON.stringify(state.params)!==JSON.stringify(state.scopeParams||state.identity.params))throw new Error('Изменены параметры');
  for(const [name,file]of Object.entries(state.artifacts))if(hash(fs.readFileSync(inside(dir,file)))!==state.artifactHashes[name])throw new Error('Изменён результат: '+name);
  const model=processModel(fs.readFileSync(inside(cwd,`processes/${state.cursorProcess}/PROCESS.md`),'utf8'));
  const responsePaths={outputDir:path.dirname(dir),summaryFile:path.join(path.dirname(dir),'итог.md'),resultFile:state.result?path.join(path.dirname(dir),state.result):null};
  if(command==='next'){
   if(state.status!=='running')return {...responsePaths,status:state.status,operation:'done',output:spec.output,result:state.result||null,failure:state.failure||null};
   if(state.next_step==='end')return {...responsePaths,status:state.status,operation:state.stack.length?'leave':'finish',spec:{output:spec.output},lastArtifact:state.last_artifact};
   const step=model.steps.find(item=>item.name===state.next_step);
   if(step.kind==='branch'){const text=fs.readFileSync(inside(cwd,`processes/${state.cursorProcess}/PROCESS.md`),'utf8');return {...responsePaths,status:state.status,operation:'choose',targets:step.targets,step:step.name,branch:text.split('### '+step.name)[1].split('### ')[0].trim(),facts:facts(Object.fromEntries(Object.entries(state.artifacts).map(([name,file])=>[name,inside(dir,file)]))),instruction:'Выберите переход по просьбе пользователя и данным; передайте decision в execute/begin/finish/enter/leave.'};}
   if(step.kind==='process')return {...responsePaths,status:state.status,operation:'enter',spec:{output:spec.output,step:step.name},process:step.ref};
   const meta=action(cwd,step.ref),params=state.pending?.params||stepParams(state.params,step,state.identity.overrides,Object.fromEntries(Object.entries(state.artifacts).map(([name,file])=>[name,path.relative(cwd,inside(dir,file))]))),context={cwd,processName:state.cursorProcess,actionName:step.ref,meta,params,mode:state.identity.mode};
   const policy=require('../actions/action-runtime').runtime(cwd,step.ref,meta),automatic=meta.kind!=='act'&&typeof policy.execute==='function'&&(policy.canExecute?.(context)??true);
   return {...responsePaths,status:state.status,operation:automatic?'execute':state.pending?'model':'begin',spec:{output:spec.output,step:step.name},action:step.ref,readFiles:[`actions/${step.ref}/ACTION.md`],params,save:{artifact:step.artifact,extension:meta.contracts[Object.keys(meta.produces)[0]]==='text'?'md':'json',next:step.next},instruction:automatic?'Вызовите run execute с данным spec: штатная локальная функция рассчитает и сохранит результат.':'Вы исполняете рецепт ACTION.md. После begin подготовьте фактический content и вызовите save. При невозможности продолжить — fail с причиной, а не итог об успехе.'};
  }
  function selected(kind){
   if(state.status!=='running'||state.pending)throw new Error('Сначала завершите сохранение текущего шага');
   if(spec.process&&spec.process!==state.cursorProcess)throw new Error('Используйте enter для вызова подпроцесса');
   const step=model.steps.find(s=>s.name===spec.step);if(!step||step.kind!==kind)throw new Error('Неверный тип текущего шага');
   if(spec.step!==state.next_step){const branch=model.steps.find(s=>s.name===state.next_step);if(branch?.kind!=='branch'||!branch.targets.includes(spec.step)||!spec.decision)throw new Error('Шаг не соответствует сохранённой позиции');event(dir,'branch_decision',{process:state.cursorProcess,step:branch.name,next:spec.step,reason:spec.decision});}
   return step;
  }
  function chooseEnd(){
   if(state.next_step==='end')return;
   const branch=model.steps.find(s=>s.name===state.next_step);if(branch?.kind!=='branch'||!branch.targets.includes('end')||typeof spec.decision!=='string'||!spec.decision.trim())throw new Error('Нужен явный выбор завершить маршрут');
   event(dir,'branch_decision',{process:state.cursorProcess,step:branch.name,next:'end',reason:spec.decision});state.next_step='end';
  }
  if(command==='enter'){
   const step=selected('process');if(state.stack.length+1>=require('../config/config').loadMaster(cwd).execution.maxProcessDepth)throw new Error('Глубина подпроцессов превышена');
   const params=childParams(cwd,model,step,state.params,Object.fromEntries(Object.entries(state.artifacts).map(([k,f])=>[k,path.relative(cwd,inside(dir,f))])),state.identity.overrides);
   const childFile=`processes/${step.ref}/PROCESS.md`;if(!Object.hasOwn(state.identity.files,childFile))throw new Error('Подпроцесс отсутствует в снимке');
   const child=processModel(fs.readFileSync(inside(cwd,childFile),'utf8'));
   state.stack.push({process:state.cursorProcess,call:step.name,next:step.next,alias:step.artifact||null,params:state.params,artifacts:structuredClone(state.artifacts),artifactHashes:structuredClone(state.artifactHashes),last_artifact:state.last_artifact||null});
   state.cursorProcess=step.ref;state.params=params;state.scopeParams=structuredClone(params);state.next_step=child.entry;state.last_artifact=null;
   event(dir,'process_entered',{process:step.ref,step:step.name,depth:state.stack.length});
  }else if(command==='leave'){
   if(state.status!=='running'||state.pending||!state.stack.length)throw new Error('Нет завершённого вызова подпроцесса');chooseEnd();
   if(!state.last_artifact)throw new Error('Подпроцесс не создал результат');
   const port=state.last_artifact,file=state.artifacts[port],digest=state.artifactHashes[port],child=state.cursorProcess,frame=state.stack.pop(),alias=frame.alias||port;
   state.cursorProcess=frame.process;state.params=frame.params;state.scopeParams=structuredClone(frame.params);state.artifacts=frame.artifacts;state.artifactHashes=frame.artifactHashes;state.artifacts[alias]=file;state.artifactHashes[alias]=digest;state.last_artifact=alias;state.last_step_name=frame.call;state.next_step=frame.next;
   event(dir,'process_left',{process:child,parent:frame.process,step:frame.call,next:frame.next,artifact:alias});
  }else if(command==='begin'){
   const step=selected('action'),meta=action(cwd,step.ref);
   for(const input of meta.consumes.artifacts||[])if(!Object.hasOwn(state.artifacts,input))throw new Error('Нет входного артефакта '+input);
   if(state.status==='completed')throw new Error('Завершённый прогон нельзя продолжить: нужен новый запуск');
   const params=stepParams(state.params,step,state.identity.overrides,Object.fromEntries(Object.entries(state.artifacts).map(([name,f])=>[name,path.relative(cwd,inside(dir,f))])));
   const inputs=Object.fromEntries(meta.consumes.artifacts.map(name=>[name,state.artifacts[name].endsWith('.json')?json(inside(dir,state.artifacts[name])):fs.readFileSync(inside(dir,state.artifacts[name]),'utf8')]));
   const context={cwd,processName:state.cursorProcess,actionName:step.ref,meta,params,inputs,mode:state.identity.mode};
   const prepared=require('../actions/action-runtime').runtime(cwd,step.ref,meta).prepare?.(context);
   if(prepared)Object.assign(params,prepared);
   state.pending={id:crypto.randomUUID(),step:spec.step,process:state.cursorProcess,index:state.last_step+1,params};event(dir,'step_started',{id:state.pending.id,step:spec.step,process:state.cursorProcess,index:state.pending.index});
  }else if(command==='save'){
   if(state.status!=='running'||!state.pending||state.pending.step!==spec.step)throw new Error('Сначала begin этого шага');
   if(!NAME.test(spec.artifact||'')||!['json','md','txt'].includes(spec.extension))throw new Error('Нужны artifact и extension');
   const model=processModel(fs.readFileSync(inside(cwd,`processes/${state.pending.process}/PROCESS.md`),'utf8')),step=model.steps.find(s=>s.name===spec.step);
   if(step.artifact!==spec.artifact)throw new Error('Артефакт не соответствует шагу');
   let value=spec.content;
   if(spec.extension==='json')value=typeof value==='string'?JSON.parse(value):structuredClone(value);
   const meta=action(cwd,step.ref),inputs=Object.fromEntries(meta.consumes.artifacts.map(name=>[name,state.artifacts[name].endsWith('.json')?json(inside(dir,state.artifacts[name])):fs.readFileSync(inside(dir,state.artifacts[name]),'utf8')]));
   const context={cwd,processName:state.cursorProcess,actionName:step.ref,meta,params:state.pending.params,inputs,mode:state.identity.mode};
   const policy=require('../actions/action-runtime').runtime(cwd,step.ref,meta);
   if(policy.normalize)value=policy.normalize({...context,value});
   const port=Object.keys(meta.produces)[0];
   validateArtifact(cwd,step.ref,port,spec.extension,value,context);
   const content=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';if(typeof content!=='string')throw new Error('Нет content');
   if(spec.extension==='json'){const data=JSON.parse(content);if(data.meta?.window&&state.params.startDate&&state.params.endDate){const match=data.meta.window.match(/^(.*?)\s*[—–]\s*(.*?)$/);if(!match||dateValue(match[1])!==dateValue(state.params.startDate)||dateValue(match[2])!==dateValue(state.params.endDate))throw new Error('Период артефакта не совпадает с состоянием');}}
   if(spec.next!==step.next)throw new Error('Следующий узел не соответствует процессу');
   if(spec.next!=='end'&&!model.steps.some(s=>s.name===spec.next))throw new Error('Неверный следующий узел');
   const file=String(state.pending.index).padStart(2,'0')+'-'+spec.step+'.'+spec.extension,full=inside(dir,file);
   if(fs.existsSync(full)){if(hash(fs.readFileSync(full))!==hash(content))throw new Error('Незавершённая фиксация содержит другой результат');}else fs.writeFileSync(full,content,{flag:'wx',mode:0o600});
   if(!rows(dir).some(e=>e.type==='step_completed'&&e.id===state.pending.id))event(dir,'step_completed',{...state.pending,artifact:spec.artifact,file,hash:hash(content)});
   state.recordedArtifacts ||= {};state.recordedArtifacts[file]=hash(content);state.artifacts[spec.artifact]=file;state.artifactHashes[spec.artifact]=hash(content);state.last_step=state.pending.index;state.last_step_name=spec.step;state.last_artifact=spec.artifact;state.next_step=spec.next;state.pending=null;
  }else if(command==='finish'||command==='fail'){
   if(command==='finish'){
    if(!['running','completed'].includes(state.status)||state.pending||!state.last_step)throw new Error('Шаг не завершён или прогон остановлен');
    if(state.stack.length||state.cursorProcess!==state.identity.process)throw new Error('Сначала leave: родительский процесс ещё не завершён');
    chooseEnd();
    if(spec.resultName==='итог.md'||/^\d{2}-/.test(spec.resultName||''))throw new Error('Зарезервированное имя результата');
    if(!require('../core/paths').validResultName(spec.resultName))throw new Error('Нужно имя файла для человека');
    const last=state.artifacts[state.last_artifact],bytes=fs.readFileSync(inside(dir,last)),human=inside(cwd,`outputs/${spec.output}/${spec.resultName}`);
    if(fs.existsSync(human)&&!fs.readFileSync(human).equals(bytes))throw new Error('Другой результат уже существует');if(!fs.existsSync(human))fs.writeFileSync(human,bytes,{flag:'wx',mode:0o600});state.result=spec.resultName;state.stepResult='result:'+state.last_artifact;state.next_step='end';state.status='completed';
   }else{if(state.status==='completed')throw new Error('Завершённый прогон нельзя объявить неудачным');state.status='failed';state.failure={reason:spec.reason||'шаг остановлен'};}
   if(!rows(dir).some(e=>e.type==='finished'&&e.status===state.status))event(dir,'finished',{status:state.status});
  }else if(command==='publish'){
   if(state.status!=='completed')throw new Error('Публиковать файлы можно только в завершённом прогоне');
   if(!Object.hasOwn(state.artifacts,spec.artifact))throw new Error('Нет сохранённого артефакта '+spec.artifact);
   if(!require('../core/paths').validResultName(spec.name)||spec.name==='итог.md'||/^\d{2}-/.test(spec.name))throw new Error('Нужно незанятое имя файла для человека');
   const bytes=fs.readFileSync(inside(dir,state.artifacts[spec.artifact])),human=inside(cwd,`outputs/${spec.output}/${spec.name}`);
   if(fs.existsSync(human)&&!fs.readFileSync(human).equals(bytes))throw new Error('Другой файл уже существует');
   if(!fs.existsSync(human))fs.writeFileSync(human,bytes,{flag:'wx',mode:0o600});
   state.published={...(state.published||{}),[spec.artifact]:spec.name};
   state.updated=now();atomic(inside(dir,'state.json'),state);summary(cwd,spec.output,state,spec);
   return {...state,summaryFile:path.join(path.dirname(dir),'итог.md'),outputDir:path.dirname(dir),resultFile:state.result?path.join(path.dirname(dir),state.result):null};
  }else throw new Error('Неизвестная операция');
  state.updated=now();atomic(inside(dir,'state.json'),state);summary(cwd,spec.output,state,spec);
  if(['completed','failed'].includes(state.status))updateHistory(cwd,{ts:state.updated,process:state.identity.process,режим:state.identity.mode,output:spec.output,итог:(state.identity.mode==='demo'?'Пробный прогон, ничего не отправлено. ':'')+(state.status==='completed'?'готово':'не получилось: '+(spec.reason||'шаг остановлен')),outcome:state.status==='completed'?(state.last_artifact==='mail-draft'?'draft':'success'):'failed'});
  return {...state,summaryFile:path.join(path.dirname(dir),'итог.md'),outputDir:path.dirname(dir),resultFile:state.result?path.join(path.dirname(dir),state.result):null};
 }finally{fs.rmdirSync(lock);}
}
// Отказ шага при известной позиции завершает прогон: иначе он остаётся «выполняется» без записи в истории.
// Неизвестный output, чужой путь или нарушенная целостность отказом шага не считаются.
function failStep(cwd,output,reason){
 let dir;
 try{dir=inside(cwd,`outputs/${output}/.run`);const state=json(inside(dir,'state.json'));if(state.status!=='running')return;operation(cwd,'fail',{output,reason});}
 catch(error){
  const integrity=['Изменён вход: ','Изменён сохранённый шаг: ','Изменены параметры','Изменён результат: ','Изменён состав зависимостей'];
  if(!dir||integrity.some(part=>error.message.startsWith(part)))throw error;
 }
}
function execute(cwd,spec){
 const dir=inside(cwd,`outputs/${spec.output}/.run`),card=operation(cwd,'next',{output:spec.output});
 if(card.operation==='choose'){
  if(!spec.step)throw new Error('Сейчас развилка '+card.step+': укажите выбранный step из '+card.targets.join(', ')+' и decision');
  if(!card.targets.includes(spec.step))throw new Error('Шаг '+spec.step+' не относится к развилке. Выберите один из: '+card.targets.join(', '));
  if(!spec.decision)throw new Error('Нужны выбранный step и decision из ветвления');
  if(spec.step==='end')throw new Error('Завершение маршрута на развилке: используйте finish или leave');
  const target=processModel(fs.readFileSync(inside(cwd,`processes/${json(inside(dir,'state.json')).cursorProcess}/PROCESS.md`),'utf8')).steps.find(item=>item.name===spec.step);
  if(target?.kind!=='action')throw new Error('Выбранный шаг не относится к развилке');
 }else if(card.operation==='done')throw new Error('Прогон завершён: новый шаг не выполняется, нужен новый запуск');
 else if(spec.step!==card.spec?.step)throw new Error('Текущий шаг карточки — '+card.spec?.step+': передайте его spec без изменений');
 else if(card.operation!=='execute'){
  const instruction=card.operation==='begin'?'Вызовите run begin с spec карточки next, выполните ACTION.md и сохраните результат через run save.':card.operation==='model'?'Шаг уже начат: выполните ACTION.md и сохраните результат через run save.':`Вызовите run next и выполните указанную операцию ${card.operation}.`;
  throw Object.assign(new Error('Этот шаг не имеет штатного локального вычисления. '+instruction),{summaryFile:card.summaryFile});
 }
 try{
  let state=json(inside(dir,'state.json'));
  if(state.status!=='running')throw new Error('Прогон уже завершён: '+state.status);
  if(!state.pending&&state.next_step!==spec.step)throw new Error('Текущий шаг карточки — '+state.next_step+': передайте его spec без изменений');
  if(!state.pending)operation(cwd,'begin',spec);
  state=json(inside(dir,'state.json'));
  const model=processModel(fs.readFileSync(inside(cwd,`processes/${state.cursorProcess}/PROCESS.md`),'utf8')),step=model.steps.find(item=>item.name===state.pending.step),meta=action(cwd,step.ref),inputs=Object.fromEntries(meta.consumes.artifacts.map(name=>[name,state.artifacts[name].endsWith('.json')?json(inside(dir,state.artifacts[name])):fs.readFileSync(inside(dir,state.artifacts[name]),'utf8')]));
  const context={cwd,processName:state.cursorProcess,actionName:step.ref,meta,params:state.pending.params,inputs,mode:state.identity.mode},policy=require('../actions/action-runtime').runtime(cwd,step.ref,meta);
  if(meta.kind==='act'||typeof policy.execute!=='function'||!(policy.canExecute?.(context)??true))throw new Error('Этот шаг не имеет штатного локального вычисления: используйте next и ACTION.md');
  const value=policy.execute(context),extension=meta.contracts[Object.keys(meta.produces)[0]]==='text'?'md':'json';
  return operation(cwd,'save',{output:spec.output,step:step.name,artifact:step.artifact,extension,content:value,next:step.next});
 }catch(error){failStep(cwd,spec.output,error.message);error.summaryFile=path.join(path.dirname(dir),'итог.md');throw error;}
}
module.exports={start,operation,execute,failStep,effectiveParams};
if(require.main===module){try{const [cmd,file,...rest]=process.argv.slice(2);if(rest.length||!file||!['start','next','execute','enter','leave','begin','save','finish','fail','publish','diagnose'].includes(cmd))throw new Error('node tools/kit.js run <start|next|execute|begin|save|enter|leave|finish|publish|fail|diagnose> <spec.json>');const spec=json(file);console.log(JSON.stringify(cmd==='start'?start(root(),spec):cmd==='execute'?execute(root(),spec):cmd==='diagnose'?require('./diagnostics').report(root(),spec.output):operation(root(),cmd,spec),null,2));}catch(error){console.error(error.message);if(error.summaryFile)console.error('Итог: '+error.summaryFile);process.exitCode=1;}}

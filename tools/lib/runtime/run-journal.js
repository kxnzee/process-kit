#!/usr/bin/env node
'use strict';
// Process controller: validates operations and persists transitions. Model/MCP execution stays in the harness.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runFolderUnique,validRunFolderName}=require('../core/paths');
const {processModel,NAME}=require('../entities/process-model');
const {inside}=require('../core/safe-path');
const {dependencies,action,stepParams,childParams}=require('../entities/process-dependencies');
const {validateArtifact}=require('../contracts/artifact-contract');
const {updateHistory}=require('./history');
const storage=require('./run-storage'),trust=require('./trust');
const {validateDefinition,branchChoice,validateRunInput}=require('../entities/process-definition');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});storage.atomic(file,value);}
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const now=()=>new Date().toISOString();
function rows(dir){const file=inside(dir,'trace.jsonl');return fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];}

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
 const folder=inside(cwd,'outputs/'+output),demo=state.identity.mode==='demo',testing=state.identity.definitionTest,status=state.status==='completed'?'готово':state.status==='failed'?'не получилось: '+(spec.reason||state.failure?.reason||'шаг остановлен'):'выполняется',files=humanFiles(state);
 const listed=[...new Set(Object.values(files))];
 atomic(inside(folder,'итог.md'),`# ${state.title}\nДата: ${humanDate(state.identity.date||state.updated)}\nЧем закончилось: ${demo&&status==='готово'?'пробный прогон на вымышленных данных, ничего не отправлялось':demo?'пробный прогон, ничего не отправлялось; '+status:status}\nЧто сделано: ${testing?'Проверочный прогон определения. ':''}${spec.summary||state.summary||'Завершено шагов: '+state.last_step+'.'}\nОткуда данные: ${demo?'тестовые данные выбранной фикстуры':state.identity.mode==='local'?(state.sourceDescription||'локальные файлы и артефакты процесса'):'внешние источники процесса'}\nЧто отправлено и кому: ${state.identity.mode==='live'?'см. подтверждённые результаты шагов':'ничего не отправлено'}\n${listed.length?'Файлы в этой папке:\n'+listed.map(name=>'- '+name).join('\n')+'\n':''}`);}
function start(cwd,spec,environment={}){
 const fingerprint=environment.fingerprint||((file,body)=>hash(body));
 if(spec.definitionTest!==undefined&&typeof spec.definitionTest!=='boolean')throw new Error('definitionTest должен быть boolean');
 for(const key of ['params','explicitParams'])if(spec[key]!==undefined&&(!spec[key]||typeof spec[key]!=='object'||Array.isArray(spec[key])))throw new Error(key+': нужен объект');
 const current=new Date();spec={...spec,date:spec.date??`${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`};
 if(spec.inputText!==undefined&&typeof spec.inputText!=='string')throw new Error('inputText должен быть текстом');
 if(!NAME.test(spec.process||'')||!['local','live','demo'].includes(spec.mode))throw new Error('Нужны process и mode');
 const model=validateDefinition(cwd,spec.process);if(model.data.status!=='действует')throw new Error('Процесс устарел');
 const params=effectiveParams(cwd,spec,model.data.params||{}),slug=(spec.mode==='demo'?'проба-':'')+(spec.slug||spec.process);
 validateRunInput(cwd,spec.process,model,params);
 const proposed=runFolderUnique(cwd,`${spec.date}_${slug}`);if(!proposed)throw new Error('Неверное/занятое имя output');const output=path.basename(proposed),dir=inside(cwd,`outputs/${output}/.run`);
 const overrides=Object.fromEntries(Object.keys({...spec.params,...spec.explicitParams}).map(key=>[key,params[key]]));
 const files=new Set([...dependencies(cwd,spec.process,params,spec.mode,spec.files||[],overrides),...(environment.files||[])]);
 if(spec.definitionTest&&spec.mode==='live')throw new Error('definitionTest допускает только local/demo без внешних изменений');
 if(!spec.definitionTest)require('../entities/process-release').assertPublishedTree(cwd,spec.process,params,spec.mode,overrides,[...files]);
 const resolved=require('../entities/entities').manifest(cwd,spec.process,params,spec.mode,overrides),connections=resolved.connections;
 if(connections&&!connections.ready)throw new Error(connections.missing.map(item=>item.reason).join('; '));
 const snapshots={};for(const file of files){if(!/^(processes|actions|context|adapters|config|docs|tools)\//.test(file)&&!(environment.files||[]).includes(file))throw new Error('Недопустимый файл снимка');snapshots[file]=fingerprint(file,fs.readFileSync(inside(cwd,file)));}
 fs.mkdirSync(inside(cwd,'outputs'),{recursive:true});fs.mkdirSync(path.dirname(dir));fs.mkdirSync(dir);
 if(spec.inputText!==undefined){if(typeof spec.inputText!=='string')throw new Error('inputText должен быть текстом');atomic(inside(dir,'inputs/input.md'),spec.inputText);params.input=path.relative(cwd,inside(dir,'inputs/input.md'));snapshots[params.input]=hash(spec.inputText);}
 const state={schemaVersion:2,revision:0,sourceDescription:spec.inputText!==undefined?'переданный текст пользователя':'локальные файлы и артефакты процесса',last_step:0,last_step_name:'',next_step:model.entry,status:'running',params,updated:now(),artifacts:{},artifactHashes:{},recordedArtifacts:{},published:{},pending:null,cursorProcess:spec.process,stack:[],scopeParams:structuredClone(params),title:String(spec.title||model.data.title||model.data.description||spec.process).replace(/[\r\n]/g,' '),identity:{runId:crypto.randomUUID(),environmentFiles:environment.files||[],definitionTest:spec.definitionTest===true,process:spec.process,mode:spec.mode,date:spec.date,extraFiles:spec.files||[],overrides,params:structuredClone(params),hashAlgorithm:'sha256',files:snapshots}};
 storage.stage(dir,state,[{ts:now(),type:'started',process:spec.process,mode:spec.mode}]);storage.restore(dir);project(cwd,output,state);storage.finish(dir);return {output,outputDir:path.dirname(dir),summaryFile:path.join(path.dirname(dir),'итог.md'),state,connections,entities:resolved.entities,readFiles:resolved.readFiles,files:Object.keys(snapshots),note:'Используйте state.params как единственные эффективные параметры. Вы — исполнитель. Продолжайте через run next/execute до finish либо зафиксированного fail; preflight не завершает задачу.'};
}
function project(cwd,output,state,spec={},recover=false){
 summary(cwd,output,state,spec);
 if(['completed','failed'].includes(state.status))updateHistory(cwd,{ts:state.updated,process:state.identity.process,режим:state.identity.mode,output,итог:(state.identity.definitionTest?'Проверочный прогон определения. ':'')+(state.identity.mode==='demo'?'Пробный прогон, ничего не отправлено. ':'')+(state.status==='completed'?'готово':'не получилось: '+(state.failure?.reason||'шаг остановлен')),outcome:state.status==='completed'?(state.last_artifact==='mail-draft'?'draft':'success'):'failed'},{recover});
}
function saveRequest(cwd,state,output){
 if(!state.pending)return null;
 const model=processModel(fs.readFileSync(inside(cwd,`processes/${state.pending.process}/PROCESS.md`),'utf8')),step=model.steps.find(s=>s.name===state.pending.step),meta=action(cwd,step.ref);
 return {output,step:step.name,attemptId:state.pending.id,artifact:step.artifact,extension:meta.contracts[Object.keys(meta.produces)[0]]==='text'?'md':'json',next:step.next};
}
function operation(cwd,command,spec,environment={}){
 const fingerprint=environment.fingerprint||((file,body)=>hash(body));
 if(Object.hasOwn(spec,'confirmed'))throw new Error('confirmed больше не принимается: это непроверяемый флаг, используйте approval receipt');
 if(!validRunFolderName(spec.output))throw new Error('Неверный output');
 const dir=inside(cwd,`outputs/${spec.output}/.run`),release=storage.lock(dir,command==='recover');
 try{
  if(command==='recover'){
   const recovered=storage.restore(dir);
   if(recovered){project(cwd,spec.output,recovered.state,recovered.spec,true);storage.finish(dir);}
  }else if(fs.existsSync(inside(dir,'transaction.json')))throw new Error('Незавершённая запись: используйте run recover');
  const verified=storage.verify(dir),state=json(inside(dir,'state.json'));
  if(state.schemaVersion===2&&!verified)throw new Error('Нарушена согласованность: отсутствует checkpoint');
  if(!['running','completed','failed'].includes(state.status))throw new Error('Недопустимый статус процесса');
  const events=[];
  function event(unused,type,data={}){const row={ts:now(),type,...data};events.push(row);return row;}
  for(const [file,digest]of Object.entries(state.identity.files))if(fingerprint(file,fs.readFileSync(inside(cwd,file)))!==digest)throw new Error('Изменён вход: '+file);
  const inventory=dependencies(cwd,state.identity.process,state.identity.params,state.identity.mode,state.identity.extraFiles||[],state.identity.overrides);
  const expected=Object.keys(state.identity.files).filter(file=>file!==state.identity.params.input&&!(state.identity.environmentFiles||[]).includes(file)).sort();
  if(JSON.stringify(inventory.sort())!==JSON.stringify(expected))throw new Error('Изменён состав зависимостей; нужен новый запуск');
  state.stack ||= [];state.cursorProcess ||= state.identity.process;
  for(const [file,digest]of Object.entries(state.recordedArtifacts||{}))if(hash(fs.readFileSync(inside(dir,file)))!==digest)throw new Error('Изменён сохранённый шаг: '+file);
  if(JSON.stringify(state.params)!==JSON.stringify(state.scopeParams||state.identity.params))throw new Error('Изменены параметры');
  for(const [name,file]of Object.entries(state.artifacts))if(hash(fs.readFileSync(inside(dir,file)))!==state.artifactHashes[name])throw new Error('Изменён результат: '+name);
  if(state.status==='completed'){
   const files={...(state.result?{[state.last_artifact]:state.result}:{}),...(state.published||{})};
   for(const [artifact,name]of Object.entries(files))if(!fs.readFileSync(inside(cwd,`outputs/${spec.output}/${name}`)).equals(fs.readFileSync(inside(dir,state.artifacts[artifact]))))throw new Error('Изменён опубликованный результат: '+name);
  }
  const model=validateDefinition(cwd,state.cursorProcess);
  function decision(step){return branchChoice(cwd,state.cursorProcess,model,step,state.params,Object.fromEntries(Object.entries(state.artifacts).map(([name,file])=>[name,file.endsWith('.json')?json(inside(dir,file)):fs.readFileSync(inside(dir,file),'utf8')])));}
  function approvalFor(branch,target){return trust.request(state,spec.output,'user-decision',{step:branch.name,target,params:state.params});}
  function needsApproval(target){return target!=='end'||state.stack.length>0;}
  function prepareAction(step,meta){
   const params=stepParams(state.params,step,state.identity.overrides,Object.fromEntries(Object.entries(state.artifacts).map(([name,file])=>[name,path.relative(cwd,inside(dir,file))])));
   const inputs=Object.fromEntries(meta.consumes.artifacts.map(name=>[name,state.artifacts[name]?.endsWith('.json')?json(inside(dir,state.artifacts[name])):fs.readFileSync(inside(dir,state.artifacts[name]),'utf8')]));
   const context={cwd,processName:state.cursorProcess,actionName:step.ref,meta,params,inputs,mode:state.identity.mode};
   const prepared=require('../actions/action-runtime').runtime(cwd,step.ref,meta).prepare?.(context);if(prepared)Object.assign(params,prepared);
   return params;
  }
  function actionRequest(step,params){
   const meta=action(cwd,step.ref),config=require('../config/config'),connections=[];
   for(const slot of ['taskStore','codeStore'].filter(slot=>meta.consumes.params.includes(slot))){
    if(state.identity.mode==='demo'){connections.push({slot,id:params[slot]||'demo',mode:'demo'});continue;}
    const selected=config.resolveStore(cwd,config.loadConfig(cwd,model.data.requires.config||[]),slot,params[slot],config.requiredFields(cwd,state.cursorProcess,params));
    connections.push({slot,id:selected.id,adapterFile:selected.adapterFile,mcpServer:selected.mcpServer,settings:selected.settings});
   }
   return trust.request(state,spec.output,'external-action',{step:step.name,action:step.ref,adapter:{declaration:meta.adapter,connections},params});
  }
  function effectRequest(){return trust.request(state,spec.output,'external-effect',{step:state.pending.step,action:model.steps.find(s=>s.name===state.pending.step).ref,attemptId:state.pending.id,approvalRequestId:state.pending.approval?.requestId||null,params:state.pending.params});}
  const stepStatus=state.status==='failed'?'failed':state.status==='completed'?'completed':state.pending?(action(cwd,model.steps.find(s=>s.name===state.pending.step).ref).kind==='act'?'blocked':'running'):model.steps.find(s=>s.name===state.next_step)?.decision==='user'?'blocked':'pending';
  const responsePaths={stepStatus,outputDir:path.dirname(dir),summaryFile:path.join(path.dirname(dir),'итог.md'),resultFile:state.result?path.join(path.dirname(dir),state.result):null};
  if(command==='next'||command==='recover'){
   if(command==='recover')project(cwd,spec.output,state,{},true);
   if(state.status!=='running')return {...responsePaths,status:state.status,operation:'done',output:spec.output,result:state.result||null,failure:state.failure||null};
   if(state.next_step==='end')return {...responsePaths,status:state.status,operation:state.stack.length?'leave':'finish',spec:{output:spec.output},lastArtifact:state.last_artifact};
   const step=model.steps.find(item=>item.name===state.next_step);
   if(!step)throw new Error('Текущий шаг отсутствует в процессе');
   if(step.kind==='branch'){
    const resolved=decision(step);
    return {...responsePaths,status:state.status,operation:'choose',spec:{output:spec.output,step:step.name,...(resolved?{target:resolved.target}:{})},targets:resolved?[resolved.target]:step.targets,decision:resolved?.reason,decisionMode:resolved?'code':step.decision||'model',requiresApproval:step.decision==='user',verificationAvailable:typeof environment.verifyApproval==='function',approvalRequests:step.decision==='user'?step.targets.filter(needsApproval).map(target=>approvalFor(step,target)):[],step:step.name,branch:step.body.join('\n').trim(),facts:facts(Object.fromEntries(Object.entries(state.artifacts).map(([name,file])=>[name,inside(dir,file)]))),instruction:'Вызовите run choose с данным spec и target. Для model нужен decision; user требует проверенный approval receipt доверенной интеграции, кроме end корневого процесса. После выбора снова вызовите next.'};
   }
   if(step.kind==='process')return {...responsePaths,status:state.status,operation:'enter',spec:{output:spec.output,step:step.name},process:step.ref};
   const meta=action(cwd,step.ref),params=state.pending?.params||stepParams(state.params,step,state.identity.overrides,Object.fromEntries(Object.entries(state.artifacts).map(([name,file])=>[name,path.relative(cwd,inside(dir,file))]))),context={cwd,processName:state.cursorProcess,actionName:step.ref,meta,params,mode:state.identity.mode};
   if(state.pending&&meta.kind==='act')return {...responsePaths,status:state.status,operation:'reconcile',action:step.ref,params:state.pending.params,readFiles:[`actions/${step.ref}/ACTION.md`],save:saveRequest(cwd,state,spec.output),effectRequest:effectRequest(),verificationAvailable:typeof environment.verifyEffect==='function',attemptId:state.pending.id,spec:{output:spec.output,step:step.name,attemptId:state.pending.id},instruction:'Исход внешнего действия неизвестен. Проверьте результат в системе; не повторяйте действие. Save требует adapter receipt, проверенный verifyEffect с outcome=applied. Retry разрешён только с проверенным outcome=not-applied. Заявления агента не разрешают повтор.'};
   if(meta.kind==='act'){const prepared=prepareAction(step,meta);return {...responsePaths,stepStatus:'blocked',status:state.status,operation:'approval-required',action:step.ref,params:prepared,approvalRequest:actionRequest(step,prepared),verificationAvailable:typeof environment.verifyApproval==='function',spec:{output:spec.output,step:step.name},instruction:'До begin требуется approval receipt доверенной интеграции, привязанный к этому запросу. Без verifyApproval внешнее действие заблокировано.'};}
   const policy=require('../actions/action-runtime').runtime(cwd,step.ref,meta),automatic=meta.kind!=='act'&&typeof policy.execute==='function'&&(policy.canExecute?.(context)??true);
   return {...responsePaths,status:state.status,operation:automatic?'execute':state.pending?'model':'begin',spec:{output:spec.output,step:step.name,...(state.pending?{attemptId:state.pending.id}:{})},action:step.ref,readFiles:[`actions/${step.ref}/ACTION.md`],params,save:{output:spec.output,step:step.name,...(state.pending?{attemptId:state.pending.id}:{}),artifact:step.artifact,extension:meta.contracts[Object.keys(meta.produces)[0]]==='text'?'md':'json',next:step.next},instruction:automatic?'Вызовите run execute с данным spec: штатная локальная функция рассчитает и сохранит результат.':'Вы исполняете рецепт ACTION.md. После begin подготовьте фактический content и вызовите save. При невозможности продолжить — fail с причиной, а не итог об успехе.'};
  }
  function chooseBranch(branch,target){
   if(branch?.kind!=='branch'||!branch.targets.includes(target))throw new Error('Шаг не соответствует сохранённой позиции или цель не объявлена');
   const approval=branch.decision==='user'&&needsApproval(target)?trust.verify(environment,'approval',approvalFor(branch,target),spec.approval,'approved'):null;
   const resolved=decision(branch);
   if(resolved?resolved.target!==target:typeof spec.decision!=='string'||!spec.decision.trim())throw new Error('Выбор ветки не соответствует условию или нет decision');
   event(dir,'branch_decision',{process:state.cursorProcess,step:branch.name,next:target,reason:resolved?.reason||spec.decision,decisionMode:resolved?'code':branch.decision||'model',...(branch.decision==='user'?{approval:approval||{verification:'not-requested',reason:'terminal-exit'}}:{})});
   return target;
  }
  function selected(kind){
   if(state.status!=='running'||state.pending)throw new Error('Сначала завершите сохранение текущего шага');
   if(spec.process&&spec.process!==state.cursorProcess)throw new Error('Используйте enter для вызова подпроцесса');
   const step=model.steps.find(s=>s.name===spec.step);if(!step||step.kind!==kind)throw new Error('Неверный тип текущего шага');
   if(spec.step!==state.next_step)throw new Error('Шаг не соответствует сохранённой позиции: сначала отдельный run choose');
   if(spec.action&&spec.action!==step.ref)throw new Error('Действие не соответствует текущему шагу');
   return step;
  }
  function requireEnd(){if(state.next_step!=='end')throw new Error('Маршрут не завершён: сначала отдельный run choose');}
  if(state.status==='completed'&&!['finish','publish'].includes(command))throw new Error('Завершённый прогон нельзя изменить');
  if(state.status==='failed')throw new Error('Неудачный прогон нельзя продолжить: нужен новый запуск');
  if(command==='choose'){
   if(state.status!=='running'||state.pending||spec.step!==state.next_step)throw new Error('Choose требует текущую развилку без pending');
   state.next_step=chooseBranch(model.steps.find(s=>s.name===state.next_step),spec.target);
  }else if(command==='enter'){
   const step=selected('process');if(state.stack.length+1>=require('../config/config').loadMaster(cwd).execution.maxProcessDepth)throw new Error('Глубина подпроцессов превышена');
   const params=childParams(cwd,model,step,state.params,Object.fromEntries(Object.entries(state.artifacts).map(([k,f])=>[k,path.relative(cwd,inside(dir,f))])),state.identity.overrides);
   const childFile=`processes/${step.ref}/PROCESS.md`;if(!Object.hasOwn(state.identity.files,childFile))throw new Error('Подпроцесс отсутствует в снимке');
   const child=processModel(fs.readFileSync(inside(cwd,childFile),'utf8'));validateRunInput(cwd,step.ref,child,params);
   state.stack.push({process:state.cursorProcess,call:step.name,next:step.next,alias:step.artifact||null,params:state.params,artifacts:structuredClone(state.artifacts),artifactHashes:structuredClone(state.artifactHashes),last_artifact:state.last_artifact||null});
   state.cursorProcess=step.ref;state.params=params;state.scopeParams=structuredClone(params);state.next_step=child.entry;state.last_artifact=null;
   event(dir,'process_entered',{process:step.ref,step:step.name,depth:state.stack.length});
  }else if(command==='leave'){
   if(state.status!=='running'||state.pending||!state.stack.length)throw new Error('Нет завершённого вызова подпроцесса');requireEnd();
   if(!state.last_artifact)throw new Error('Подпроцесс не создал результат');
   const port=state.last_artifact,file=state.artifacts[port],digest=state.artifactHashes[port],child=state.cursorProcess,frame=state.stack.pop(),alias=frame.alias||port;
   state.cursorProcess=frame.process;state.params=frame.params;state.scopeParams=structuredClone(frame.params);state.artifacts=frame.artifacts;state.artifactHashes=frame.artifactHashes;state.artifacts[alias]=file;state.artifactHashes[alias]=digest;state.last_artifact=alias;state.last_step_name=frame.call;state.next_step=frame.next;
   event(dir,'process_left',{process:child,parent:frame.process,step:frame.call,next:frame.next,artifact:alias});
  }else if(command==='begin'){
   const step=selected('action'),meta=action(cwd,step.ref);
   for(const input of meta.consumes.artifacts||[])if(!Object.hasOwn(state.artifacts,input))throw new Error('Нет входного артефакта '+input);
   if(state.status==='completed')throw new Error('Завершённый прогон нельзя продолжить: нужен новый запуск');
   if(meta.kind==='act'&&state.identity.mode!=='live'&&!state.identity.definitionTest)throw new Error('Внешнее изменение допускается только в live; проверка — через definitionTest');
   const params=prepareAction(step,meta);
   const approval=meta.kind==='act'?trust.verify(environment,'approval',actionRequest(step,params),spec.approval,'approved'):null;
   state.next_step=step.name;state.pending={id:crypto.randomUUID(),step:spec.step,process:state.cursorProcess,index:state.last_step+1,params,...(approval?{approval}:{})};event(dir,'step_started',{id:state.pending.id,step:spec.step,process:state.cursorProcess,index:state.pending.index});
  }else if(command==='retry'){
   if(state.status!=='running'||!state.pending||spec.attemptId!==state.pending.id)throw new Error('Retry требует текущий attemptId');
   if(action(cwd,model.steps.find(s=>s.name===state.pending.step).ref).kind!=='act')throw new Error('Retry предназначен только для внешнего действия');
   const effect=trust.verify(environment,'effect',effectRequest(),spec.effect,'not-applied');
   const prefix=String(state.pending.index).padStart(2,'0')+'-'+state.pending.step+'.';if(fs.readdirSync(dir).some(file=>file.startsWith(prefix)))throw new Error('Есть результат незавершённого save: сначала восстановите его, не повторяйте действие');
   event(dir,'step_retry_authorized',{id:state.pending.id,step:state.pending.step,effect});state.pending=null;
  }else if(command==='save'){
   if(state.status!=='running'||!state.pending||state.pending.step!==spec.step)throw new Error('Сначала begin этого шага');
   if(state.schemaVersion===2&&spec.attemptId!==state.pending.id)throw new Error('Неверный attemptId: получите текущую попытку через run next');
   if(!NAME.test(spec.artifact||'')||!['json','md','txt'].includes(spec.extension))throw new Error('Нужны artifact и extension');
   const model=processModel(fs.readFileSync(inside(cwd,`processes/${state.pending.process}/PROCESS.md`),'utf8')),step=model.steps.find(s=>s.name===spec.step);
   if(spec.action&&spec.action!==step.ref)throw new Error('Действие не соответствует текущему шагу');
   if(step.artifact!==spec.artifact)throw new Error('Артефакт не соответствует шагу');
   let value=spec.content;
   if(spec.extension==='json')value=typeof value==='string'?JSON.parse(value):structuredClone(value);
   const meta=action(cwd,step.ref),inputs=Object.fromEntries(meta.consumes.artifacts.map(name=>[name,state.artifacts[name].endsWith('.json')?json(inside(dir,state.artifacts[name])):fs.readFileSync(inside(dir,state.artifacts[name]),'utf8')]));
   const context={cwd,processName:state.cursorProcess,actionName:step.ref,meta,params:state.pending.params,inputs,mode:state.identity.mode};
   const effect=meta.kind==='act'?trust.verify(environment,'effect',effectRequest(),spec.effect,'applied'):null;
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
   if(!rows(dir).some(e=>e.type==='step_completed'&&e.id===state.pending.id))event(dir,'step_completed',{...state.pending,...(effect?{effect}:{}),artifact:spec.artifact,file,hash:hash(content)});
   state.recordedArtifacts ||= {};state.recordedArtifacts[file]=hash(content);state.artifacts[spec.artifact]=file;state.artifactHashes[spec.artifact]=hash(content);state.last_step=state.pending.index;state.last_step_name=spec.step;state.last_artifact=spec.artifact;state.next_step=spec.next;state.pending=null;
  }else if(command==='finish'||command==='fail'){
   if(command==='finish'){
    if(state.status==='completed'&&spec.resultName!==state.result)throw new Error('Завершённый результат нельзя переименовать');
    if(!['running','completed'].includes(state.status)||state.pending||!state.last_step)throw new Error('Шаг не завершён или прогон остановлен');
    if(state.stack.length||state.cursorProcess!==state.identity.process)throw new Error('Сначала leave: родительский процесс ещё не завершён');
    requireEnd();
    if(spec.resultName==='итог.md'||/^\d{2}-/.test(spec.resultName||''))throw new Error('Зарезервированное имя результата');
    if(!require('../core/paths').validResultName(spec.resultName))throw new Error('Нужно имя файла для человека');
    const last=state.artifacts[state.last_artifact],bytes=fs.readFileSync(inside(dir,last)),human=inside(cwd,`outputs/${spec.output}/${spec.resultName}`);
    if(fs.existsSync(human)&&!fs.readFileSync(human).equals(bytes))throw new Error('Другой результат уже существует');if(!fs.existsSync(human))fs.writeFileSync(human,bytes,{flag:'wx',mode:0o600});state.result=spec.resultName;state.stepResult='result:'+state.last_artifact;state.next_step='end';state.status='completed';
   }else{if(state.pending&&action(cwd,model.steps.find(s=>s.name===state.pending.step).ref).kind==='act'){const effect=trust.verify(environment,'effect',effectRequest(),spec.effect,'not-applied');event(dir,'step_not_applied',{id:state.pending.id,step:state.pending.step,effect});state.pending=null;}if(state.status==='completed')throw new Error('Завершённый прогон нельзя объявить неудачным');state.status='failed';state.failure={reason:spec.reason||state.failure?.reason||'шаг остановлен'};}
   if(!rows(dir).some(e=>e.type==='finished'&&e.status===state.status))event(dir,'finished',{status:state.status});
  }else if(command==='publish'){
   if(state.status!=='completed')throw new Error('Публиковать файлы можно только в завершённом прогоне');
   if(!Object.hasOwn(state.artifacts,spec.artifact))throw new Error('Нет сохранённого артефакта '+spec.artifact);
   if(!require('../core/paths').validResultName(spec.name)||spec.name==='итог.md'||/^\d{2}-/.test(spec.name))throw new Error('Нужно незанятое имя файла для человека');
   const bytes=fs.readFileSync(inside(dir,state.artifacts[spec.artifact])),human=inside(cwd,`outputs/${spec.output}/${spec.name}`);
   if(fs.existsSync(human)&&!fs.readFileSync(human).equals(bytes))throw new Error('Другой файл уже существует');
   if(!fs.existsSync(human))fs.writeFileSync(human,bytes,{flag:'wx',mode:0o600});
   state.published={...(state.published||{}),[spec.artifact]:spec.name};
  }else throw new Error('Неизвестная операция');
  state.updated=now();if(spec.summary)state.summary=spec.summary;
  storage.stage(dir,state,events,spec);storage.restore(dir);project(cwd,spec.output,state,spec);storage.finish(dir);
  return {...state,save:saveRequest(cwd,state,spec.output),summaryFile:path.join(path.dirname(dir),'итог.md'),outputDir:path.dirname(dir),resultFile:state.result?path.join(path.dirname(dir),state.result):null};
 }finally{release();}
}
// Отказ шага при известной позиции завершает прогон: иначе он остаётся «выполняется» без записи в истории.
// Неизвестный output, чужой путь или нарушенная целостность отказом шага не считаются.
function failStep(cwd,output,reason,environment={}){
 let dir;
 try{dir=inside(cwd,`outputs/${output}/.run`);const state=json(inside(dir,'state.json'));if(state.status!=='running')return;operation(cwd,'fail',{output,reason},environment);}
 catch(error){
  const integrity=['Нарушена согласованность','Незавершённая запись','Журнал занят','Изменён вход: ','Изменён сохранённый шаг: ','Изменены параметры','Изменён результат: ','Изменён состав зависимостей'];
  if(!dir||integrity.some(part=>error.message.startsWith(part)))throw error;
 }
}
function execute(cwd,spec,environment={}){
 const dir=inside(cwd,`outputs/${spec.output}/.run`),card=operation(cwd,'next',{output:spec.output},environment);
 if(card.operation==='choose')throw new Error('Сначала отдельный run choose, затем next и execute');
 if(card.operation==='done')throw new Error('Прогон завершён: новый шаг не выполняется, нужен новый запуск');
 else if(spec.step!==card.spec?.step)throw new Error('Текущий шаг карточки — '+card.spec?.step+': передайте его spec без изменений');
 else if(card.operation!=='execute'){
  const instruction=card.operation==='begin'?'Вызовите run begin с spec карточки next, выполните ACTION.md и сохраните результат через run save.':card.operation==='model'?'Шаг уже начат: выполните ACTION.md и сохраните результат через run save.':card.operation==='approval-required'?'Внешнее действие заблокировано до проверенного approval receipt доверенного хоста.':card.operation==='reconcile'?'Сначала получите проверенное свидетельство исхода через доверенный хост; повтор действия запрещён.':'Вызовите run next для допустимой операции.';
  throw Object.assign(new Error('Этот шаг не имеет штатного локального вычисления. '+instruction),{summaryFile:card.summaryFile});
 }
 let attemptId;
 try{
  let state=json(inside(dir,'state.json'));
  if(spec.attemptId&&spec.attemptId!==state.pending?.id)throw new Error('Неверный attemptId: получите текущую попытку через run next');
  if(state.status!=='running')throw new Error('Прогон уже завершён: '+state.status);
  if(!state.pending&&state.next_step!==spec.step)throw new Error('Текущий шаг карточки — '+state.next_step+': передайте его spec без изменений');
  if(!state.pending)operation(cwd,'begin',spec,environment);
  state=json(inside(dir,'state.json'));
  const model=processModel(fs.readFileSync(inside(cwd,`processes/${state.cursorProcess}/PROCESS.md`),'utf8')),step=model.steps.find(item=>item.name===state.pending.step),meta=action(cwd,step.ref),inputs=Object.fromEntries(meta.consumes.artifacts.map(name=>[name,state.artifacts[name].endsWith('.json')?json(inside(dir,state.artifacts[name])):fs.readFileSync(inside(dir,state.artifacts[name]),'utf8')]));
  attemptId=state.pending.id;
  const context={cwd,processName:state.cursorProcess,actionName:step.ref,meta,params:state.pending.params,inputs,mode:state.identity.mode},policy=require('../actions/action-runtime').runtime(cwd,step.ref,meta);
  if(meta.kind==='act'||typeof policy.execute!=='function'||!(policy.canExecute?.(context)??true))throw new Error('Этот шаг не имеет штатного локального вычисления: используйте next и ACTION.md');
  const value=policy.execute(context),extension=meta.contracts[Object.keys(meta.produces)[0]]==='text'?'md':'json';
  return operation(cwd,'save',{output:spec.output,step:step.name,attemptId:state.pending.id,artifact:step.artifact,extension,content:value,next:step.next},environment);
 }catch(error){if(attemptId&&json(inside(dir,'state.json')).pending?.id===attemptId)failStep(cwd,spec.output,error.message,environment);error.summaryFile=path.join(path.dirname(dir),'итог.md');throw error;}
}
module.exports={start,operation,execute,failStep,effectiveParams};

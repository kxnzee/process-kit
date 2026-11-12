'use strict';
// Development acceptance only: synthetic model outputs, never provider evidence or a runtime dependency.
const fs=require('node:fs'),path=require('node:path');
const journal=require('../../tools/lib/runtime/run-journal'),{lifecycle}=require('../../tools/lib/entities/process-release');
function readState(cwd,output){return JSON.parse(fs.readFileSync(path.join(cwd,'outputs',output,'.run/state.json'),'utf8'));}
function artifact(cwd,output,port){const s=readState(cwd,output),file=path.join(cwd,'outputs',output,'.run',s.artifacts[port]);return file.endsWith('.json')?JSON.parse(fs.readFileSync(file,'utf8')):fs.readFileSync(file,'utf8');}
function modelResult(cwd,output,card){
 if(card.action==='edit-text')return 'Завершили 12 задач DEMO-42.';
 if(card.action==='prepare-mail-draft')return `Кому: test@example.invalid\nТема: Статус\nСтатус: черновик\n\n${artifact(cwd,output,'report-text')}`;
 if(card.action==='check-methodology'){
  const p=card.params,map=p.parameters.methodologyMap,sections=Object.entries(map).map(([section,values])=>({section,target:values[0],status:'unverified',process:'Проверочный вход',method:'Внешняя методика не читалась',action:'clarify',reason:'ДАННЫЕ ДЕМО: проверка формы результата'}));
  return {source:{pageUrl:p.methodologyUrl,pageTitle:'ДАННЫЕ ДЕМО',readAt:'2026-11-12T00:00:00Z',readToEnd:false,connection:''},mode:'demo',total:sections.length,matched:0,mismatched:0,unverified:sections.length,sections,unverifiedSections:sections.map(s=>({section:s.section,reason:s.reason})),notInProcess:[],methodologyNews:[],notes:['ДАННЫЕ ДЕМО: синтетический результат контракта, внешнего чтения не было']};
 }
 if(card.action==='classify-issuance'){
  const p=card.params,selection=JSON.parse(fs.readFileSync(path.join(cwd,p.records),'utf8'));
  const items=selection.records.flatMap(release=>(release.members||[]).map(member=>({key:member.key,release:release.key,classification:'unknown',subtype:null,basis:null,understanding:'Проверочный результат: смысловая классификация не выполнялась',rulesMatched:[],ruleId:null,agreement:'question',noDescription:!member.description,question:'ДАННЫЕ ДЕМО: требуется смысловая классификация',material:{read:['Заголовок и описание из выбранной fixture.json'],unread:[]}})));
  const keys=[...new Set(items.map(row=>row.key))];
  return {policyFile:'actions/classify-issuance/POLICY.md',rulesFile:'actions/classify-issuance/rules/classify-issuance.md',mode:'demo',store:p.taskStore||'demo',relatedDepth:p.relatedDepth,commentsLimit:p.commentsLimit,releaseCount:selection.records.length,byClass:{total:items.length,contained:0,technical:0,unknown:items.length},byAgreement:{confirmed:0,reasoned:0,conflict:0,weak:0,question:items.length},conflicts:[],weak:[],questions:keys,compositionUnread:selection.meta?.linksUnread||[],rulesGaps:[],understandingInsufficient:true,understandingInsufficientReason:'ДАННЫЕ ДЕМО: синтетический результат контракта',items};
 }
 throw new Error('Для приёмки не задан model-выход '+card.action);
}
function executeRoute(cwd,spec,{continueReview=false}={}){
 const started=journal.start(cwd,spec),output=started.output;
 for(let i=0;i<80;i++){
  const card=journal.operation(cwd,'next',{output});
  if(card.operation==='done'){if(card.status!=='completed')throw new Error('Приёмочный прогон завершился неуспешно');const s=readState(cwd,output);if(spec.process==='sdd-stories-report'&&s.last_artifact==='mail-draft'&&!s.published['sdd-report'])journal.operation(cwd,'publish',{output,artifact:'sdd-report',name:'отчёт.md'});return {output,resultFile:card.resultFile};}
  if(card.operation==='choose'){
   const target=card.decisionMode==='code'?card.targets[0]:continueReview?'fetch-sigma':'end';
   journal.operation(cwd,'choose',{...card.spec,target,confirmed:continueReview,decision:'Проверочный фактический ответ человека: '+(continueReview?'продолжить':'остановиться после сводки')});
  }else if(card.operation==='execute')journal.execute(cwd,card.spec);
  else if(card.operation==='begin')journal.operation(cwd,'begin',card.spec);
  else if(card.operation==='model')journal.operation(cwd,'save',{...card.save,content:modelResult(cwd,output,card)});
  else if(card.operation==='finish')journal.operation(cwd,'finish',{output,resultName:card.lastArtifact==='report-page-html'?'отчёт-инфо-поводы.html':card.lastArtifact==='methodology-check'?'сверка-с-методикой.json':card.lastArtifact==='mail-draft'?'письмо.md':'отчёт.md'});
  else throw new Error('Неожиданная операция приёмки '+card.operation);
 }
 throw new Error('Приёмочный маршрут превысил предел');
}
function publishDefinition(cwd,process){
 const label={example:'письмо','sdd-stories-report':'сдд','info-povod':'поводы'}[process];
 const demo=process!=='example',params=demo?{dataFile:`processes/${process}/fixture.json`}: {to:'test@example.invalid',subject:'Статус'};
 if(process==='info-povod')Object.assign(params,JSON.parse(fs.readFileSync(path.join(cwd,params.dataFile),'utf8')).parameters,{methodologyCheck:'no',methodologyUrl:'https://example.invalid/methodology'});
 const base={process,mode:demo?'demo':'local',params,...(!demo?{inputText:'Завершили 12 задач DEMO-42.'}:{})};
 lifecycle(cwd,'validate',base);
 const variants=process==='info-povod'?[{methodologyCheck:'no'},{methodologyCheck:'yes'},{methodologyCheck:'yes',continueReview:true}]:process==='sdd-stories-report'?[{wantsMail:false},{wantsMail:true,recipients:'test@example.invalid'}]:[{}];
 const runs=variants.map(({continueReview,...overrides})=>executeRoute(cwd,{...base,definitionTest:true,slug:`проверка-${label}`,params:{...params,...overrides}},{continueReview}));
 lifecycle(cwd,'test',{process,outputs:runs.map(run=>run.output)});
 const receipt=lifecycle(cwd,'publish',{process});
 // The normal entry must also accept the resulting published definition.
 const normal=executeRoute(cwd,{...base,slug:`приёмка-${label}`});
 return {process,receipt,runs,normal};
}
module.exports={executeRoute,publishDefinition,modelResult,artifact};

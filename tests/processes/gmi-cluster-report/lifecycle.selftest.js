'use strict';
const ctx=require('../../fixture')(),{tmp,write,fs,path,assert,check}=ctx;
const journal=require('../../../tools/lib/runtime/run-journal');
const release=require('../../../tools/lib/entities/process-release');
const {runtimeInputFiles}=require('../../../tools/lib/entities/process-dependencies');
const {modelResult}=require('../publication-helpers');
const host=require('../../trusted-integration')();
const processName='gmi-cluster-report',params={runDate:'17.11.2026',demo:true,methodologyCheck:'no'};
function route({methodologyCheck='no',review=true,html=false,definitionTest=true,extra={}}={}){
 const spec={process:processName,mode:'demo',definitionTest,params:{...params,methodologyCheck,...extra}};
 const started=journal.start(tmp,spec,host.environment),output=started.output;
 for(let i=0;i<40;i++){
  const card=journal.operation(tmp,'next',{output},host.environment);
  if(card.operation==='done'){assert.equal(card.status,'completed');return output;}
  if(card.operation==='choose'){
   const target=card.decisionMode==='code'?card.targets[0]:card.step==='methodology-review'?(review?'read':'end'):(html?'render-html':'end');
   const request=card.approvalRequests.find(item=>item.target===target);
   if(request)assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target,decision:'agent cannot approve'}),/доверенного канала/);
   journal.operation(tmp,'choose',{...card.spec,target,decision:'Синтетическая приёмка без сети',...(request?{approval:host.receipt(request)}:{})},host.environment);
  }else if(card.operation==='execute')journal.execute(tmp,card.spec,host.environment);
  else if(card.operation==='begin')journal.operation(tmp,'begin',card.spec,host.environment);
  else if(card.operation==='model')journal.operation(tmp,'save',{...card.save,content:modelResult(tmp,output,card)},host.environment);
  else if(card.operation==='finish')journal.operation(tmp,'finish',{output,resultName:'result.'+(card.lastArtifact==='report-page-html'?'html':card.lastArtifact==='methodology-index'?'json':'md')},host.environment);
  else throw new Error('Unexpected operation: '+card.operation);
 }
 throw new Error('Run did not finish');
}
try{
 check('GMI gates enforce explicit input, computed choice and trusted human continuation',()=>{
  assert.throws(()=>journal.start(tmp,{process:processName,mode:'demo',definitionTest:true,params:{...params,methodologyCheck:'ask'}}),/до start/);
  assert.throws(()=>journal.start(tmp,{process:processName,mode:'demo',definitionTest:true,params:{...params,demo:false}}),/В режиме demo/);
  const {output}=journal.start(tmp,{process:processName,mode:'demo',definitionTest:true,params});
  let card=journal.operation(tmp,'next',{output});assert.equal(card.decisionMode,'code');assert.deepEqual(card.targets,['read']);
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'check-scales',decision:'agent override'}),/не соответствует/);
  journal.operation(tmp,'choose',{...card.spec,target:'read'});
  for(const step of ['read','assess','compose'])journal.execute(tmp,{output,step});
  card=journal.operation(tmp,'next',{output});assert.equal(card.decisionMode,'user');assert.equal(card.requiresApproval,true);
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'render-html',decision:'agent says yes'}),/доверенного канала/);
  journal.operation(tmp,'choose',{...card.spec,target:'end',decision:'Отказ'});
  journal.operation(tmp,'finish',{output,resultName:'declined.md'});
 });
 let outputs;
 check('GMI covers every branch through real validate/test/publish in an isolated fixture',()=>{
  assert.equal(release.lifecycle(tmp,'validate',{process:processName,mode:'demo',params}).status,'validated');
  const first=route();assert.throws(()=>release.lifecycle(tmp,'test',{process:processName,outputs:[first]}),/Не проверена ветка/);
  outputs=[first,route({html:true}),route({methodologyCheck:'yes',review:false}),route({methodologyCheck:'yes',review:true})];
  assert.equal(release.lifecycle(tmp,'test',{process:processName,outputs}).status,'tested');
  assert.equal(release.lifecycle(tmp,'publish',{process:processName}).status,'published');
  assert.equal(release.lifecycle(tmp,'status',{process:processName}).status,'published');
  route({definitionTest:false});
 });
 check('new runtime tables need no republication and remain pinned to their individual Run',()=>{
  const scoreFile=`processes/${processName}/data/actual-table.json`,peopleFile=`processes/${processName}/data/actual-people.json`;
  write(scoreFile,fs.readFileSync(path.join(tmp,`processes/${processName}/data/score-table.example.json`)));
  write(peopleFile,'{}');
  const receipt=JSON.parse(fs.readFileSync(path.join(tmp,`processes/${processName}/publication.json`),'utf8'));
  for(const file of runtimeInputFiles(tmp,processName,params))assert.ok(!Object.hasOwn(receipt.files,file));
  route({definitionTest:false,extra:{scoreFile,peopleFile}});
  const nameFile=`processes/${processName}/data/actual-names.json`;write(nameFile,'{}');
  route({definitionTest:false,extra:{scoreFile,peopleFile,nameFile}});
  const started=journal.start(tmp,{process:processName,mode:'demo',params:{...params,scoreFile,peopleFile}});
  for(const file of [scoreFile,peopleFile])assert.ok(Object.hasOwn(started.state.identity.files,file));
  fs.appendFileSync(path.join(tmp,scoreFile),'\n');
  assert.throws(()=>journal.operation(tmp,'next',{output:started.output}),/Изменён вход/);
  assert.equal(release.lifecycle(tmp,'status',{process:processName}).status,'published');
  route({definitionTest:false,extra:{scoreFile,peopleFile}});
 });
 check('runtime input declarations cannot exempt executable code or definition contracts',()=>{
  assert.throws(()=>runtimeInputFiles(tmp,processName,{...params,scoreFile:`processes/${processName}/rules/gmi.js`}),/runtimeInputs/);
  assert.throws(()=>runtimeInputFiles(tmp,processName,{...params,resultContract:`processes/${processName}/data/score-table.example.json`}),/ресурс определения/);
  fs.appendFileSync(path.join(tmp,`processes/${processName}/rules/gmi.js`),'\n// changed definition\n');
  assert.equal(release.lifecycle(tmp,'status',{process:processName}).status,'draft');
  assert.throws(()=>journal.start(tmp,{process:processName,mode:'demo',params}),/не опубликовано|изменилось/);
 });
}finally{ctx.close();}

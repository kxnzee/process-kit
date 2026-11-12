'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,write,check}=ctx;
const journal=require('../../tools/lib/runtime/run-journal'),trusted=require('../trusted-integration');
const state=output=>JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'.run/state.json'),'utf8'));
const trace=output=>fs.readFileSync(path.join(tmp,'outputs',output,'.run/trace.jsonl'),'utf8');
function gate(name,mode,defaultTarget='end'){
 const original=fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8');
 const text=original.replace('name: example','name: '+name).replace('processes: []','processes: [example]').replace('следующий: draft','следующий: gate').replace('### draft',`### gate\n- decision: ${mode}\n- branch:\n  - когда: продолжить → goto: draft\n  - когда: подпроцесс → goto: nested\n  - иначе (default): goto: ${defaultTarget}\n\n### nested\n- процесс: example\n- артефакт: child\n- следующий: end\n\n### draft`);
 write(`processes/${name}/PROCESS.md`,text);
 const {output}=journal.start(tmp,{process:name,mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'User',subject:'Status'}});
 const begun=journal.operation(tmp,'begin',{output,step:'edit'});journal.operation(tmp,'save',{...begun.save,content:'12 задач.'});return output;
}
function setupAct(){
 fs.cpSync(path.join(tmp,'actions/example'),path.join(tmp,'actions/my-write'),{recursive:true});
 const file=path.join(tmp,'actions/my-write/ACTION.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: example','name: my-write').replace('kind: transform','kind: act'));
 write('processes/my-write/PROCESS.md','---\nname: my-write\nversion: 1.0.0\narea: test\nstatus: действует\npublication: required\ndescription: External operation test\nexample: test\nentry: write\nparams:\n  text: receipt\n  rule: default\n---\n## Шаги\n### write\n- действие: my-write\n- артефакт: receipt\n- следующий: end\n');
 require('../fixture').seedPublication(tmp,'my-write');
 return ()=>journal.start(tmp,{process:'my-write',mode:'live'}).output;
}
try{
 check('begin, enter, execute and finish cannot implicitly select a branch',()=>{
  const output=gate('my-gate','model'),before=state(output),log=trace(output);
  for(const [command,spec]of [['begin',{step:'draft'}],['enter',{step:'nested'}],['finish',{resultName:'result.md'}]])assert.throws(()=>journal.operation(tmp,command,{output,...spec,decision:'Пропустить choose'}),/run choose/);
  assert.throws(()=>journal.execute(tmp,{output,step:'draft',decision:'Пропустить choose'}),/run choose/);
  assert.deepEqual(state(output),before);assert.equal(trace(output),log);
  journal.operation(tmp,'choose',{output,step:'gate',target:'draft',decision:'Явный выбор'});
  assert.equal(state(output).pending,null);assert.equal(state(output).next_step,'draft');
  const begun=journal.operation(tmp,'begin',{output,step:'draft'});assert.equal(begun.pending.step,'draft');
 });
 check('agent confirmation cannot open a user checkpoint; verified receipts bind the current decision',()=>{
  const output=gate('my-user','user'),host=trusted(),card=journal.operation(tmp,'next',{output}),request=card.approvalRequests.find(r=>r.target==='draft'),before=state(output),log=trace(output);
  assert.equal(card.requiresApproval,true);assert.equal(card.verificationAvailable,false);
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'draft',decision:'Да',confirmed:true}),/confirmed/);
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'draft',decision:'Да',approval:host.receipt(request)}),/Нет доверенного канала/);
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'draft',decision:'Да',approval:{source:'agent-reported',requestId:request.id,proof:'yes'}},host.environment),/Заявление агента/);
  const forged=host.receipt(request);forged.proof.signature='00'.repeat(32);
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'draft',decision:'Да',approval:forged},host.environment),/не подтвердила/);
  const wrong=host.receipt(card.approvalRequests.find(r=>r.target==='nested'));
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'draft',decision:'Да',approval:wrong},host.environment),/requestId/);
  assert.deepEqual(state(output),before);assert.equal(trace(output),log);
  const receipt=host.receipt(request);journal.operation(tmp,'choose',{...card.spec,target:'draft',decision:'Подтверждено внешним тестовым хостом',approval:receipt},host.environment);
  const event=trace(output).trim().split('\n').map(JSON.parse).find(e=>e.type==='branch_decision');assert.equal(event.approval.verification,'adapter-verified');assert.equal(event.approval.requestId,request.id);
  assert.ok(!trace(output).includes(receipt.proof.signature));assert.equal(state(output).pending,null);
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'draft',decision:'Повтор',approval:receipt},host.environment),/текущую развилку/);
 });
 check('an active user default is not an approval bypass',()=>{
  const output=gate('my-active-default','user','draft'),card=journal.operation(tmp,'next',{output}),before=state(output);
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'draft',decision:'Default'}),/Нет доверенного канала/);
  assert.deepEqual(state(output),before);
 });
 check('a safe user default is recorded without claiming verified consent',()=>{
  const output=gate('my-stop','user');journal.operation(tmp,'choose',{output,step:'gate',target:'end',decision:'Нет проверенного разрешения на продолжение'});
  const event=trace(output).trim().split('\n').map(JSON.parse).find(e=>e.type==='branch_decision');assert.equal(event.approval.verification,'not-requested');
  assert.equal(journal.operation(tmp,'finish',{output,resultName:'summary.md'}).status,'completed');
 });
 check('independent workspaces cannot reuse a receipt even with identical output and inputs',()=>{
  const output=gate('my-isolated','user'),host=trusted(),first=journal.operation(tmp,'next',{output}),other=require('../fixture')({copy:false});
  try{
   require('../fixture').copyProject(tmp,other.tmp);
   const original=state(output),second=journal.start(other.tmp,{process:'my-isolated',mode:'local',date:original.identity.date,definitionTest:true,inputText:'12 задач.',params:{to:'User',subject:'Status'}});
   assert.equal(second.output,output);
   const begun=journal.operation(other.tmp,'begin',{output,step:'edit'});journal.operation(other.tmp,'save',{...begun.save,content:'12 задач.'});
   const card=journal.operation(other.tmp,'next',{output}),a=first.approvalRequests.find(r=>r.target==='draft'),b=card.approvalRequests.find(r=>r.target==='draft');
   assert.notEqual(a.runId,b.runId);assert.notEqual(a.id,b.id);assert.deepEqual(a.params,b.params);
   const before=fs.readFileSync(path.join(other.tmp,'outputs',output,'.run/state.json'),'utf8');
   assert.throws(()=>journal.operation(other.tmp,'choose',{...card.spec,target:'draft',decision:'Чужое согласие',approval:host.receipt(a)},host.environment),/requestId/);
   assert.equal(fs.readFileSync(path.join(other.tmp,'outputs',output,'.run/state.json'),'utf8'),before);
  }finally{other.close();}
 });
 check('a child user end cannot resume its parent without verified approval',()=>{
  gate('my-child','user');
  const original=fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8');
  write('processes/my-parent/PROCESS.md',original.replace('name: example','name: my-parent').replace('processes: []','processes: [my-child]').replace('entry: edit','entry: child').replace('### edit','### child\n- процесс: my-child\n- артефакт: child-result\n- следующий: edit\n\n### edit'));
  const {output}=journal.start(tmp,{process:'my-parent',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'User',subject:'Status'}});
  journal.operation(tmp,'enter',{output,step:'child'});
  const begun=journal.operation(tmp,'begin',{output,step:'edit'});journal.operation(tmp,'save',{...begun.save,content:'12 задач.'});
  const host=trusted(),card=journal.operation(tmp,'next',{output}),request=card.approvalRequests.find(r=>r.target==='end'),before=state(output),log=trace(output);
  assert.ok(request);assert.equal(request.rootProcess,'my-parent');assert.equal(request.callStack.length,1);
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'end',decision:'Выход'}),/Нет доверенного канала/);
  assert.throws(()=>journal.operation(tmp,'leave',{output}),/run choose/);
  assert.deepEqual(state(output),before);assert.equal(trace(output),log);
  journal.operation(tmp,'choose',{...card.spec,target:'end',decision:'Подтверждено хостом',approval:host.receipt(request)},host.environment);
  journal.operation(tmp,'leave',{output});assert.equal(journal.operation(tmp,'next',{output}).spec.step,'edit');
 });
 check('verifier errors do not disclose proof or change the checkpoint',()=>{
  const output=gate('my-host-error','user'),card=journal.operation(tmp,'next',{output}),host=trusted(),request=card.approvalRequests[0],before=state(output),log=trace(output);
  assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:request.target,decision:'Проверить',approval:host.receipt(request)},{verifyApproval(){throw new Error('private-proof');}}),error=>!error.message.includes('private-proof')&&/не подтвердила/.test(error.message));
  assert.deepEqual(state(output),before);assert.equal(trace(output),log);
 });
 const create=setupAct();
 check('external begin needs trusted approval bound to this run and exact payload',()=>{
  const output=create(),host=trusted(),card=journal.operation(tmp,'next',{output}),before=state(output);
  assert.equal(card.operation,'approval-required');assert.equal(card.verificationAvailable,false);
  assert.throws(()=>journal.operation(tmp,'begin',card.spec),/Нет доверенного канала/);
  assert.throws(()=>journal.operation(tmp,'begin',{...card.spec,approval:{source:'agent',reference:'approved'}},host.environment),/Заявление агента/);
  const other=create(),otherCard=journal.operation(tmp,'next',{output:other});
  assert.throws(()=>journal.operation(tmp,'begin',{...card.spec,approval:host.receipt(otherCard.approvalRequest)},host.environment),/requestId/);
  const altered=require('../../tools/lib/runtime/trust').request(state(output),output,'external-action',{step:card.spec.step,action:card.action,adapter:card.approvalRequest.adapter,params:{...card.params,text:'Другой payload'}});
  assert.throws(()=>journal.operation(tmp,'begin',{...card.spec,approval:host.receipt(altered)},host.environment),/requestId/);
  assert.deepEqual(state(output),before);
  const begun=journal.operation(tmp,'begin',{...card.spec,approval:host.receipt(card.approvalRequest)},host.environment);assert.equal(begun.pending.approval.verification,'adapter-verified');
 });
 check('agent effect reports cannot save, retry or hide an unknown external outcome',()=>{
  const output=create(),host=trusted(),card=journal.operation(tmp,'next',{output});
  const begun=journal.operation(tmp,'begin',{...card.spec,approval:host.receipt(card.approvalRequest)},host.environment);
  const current=journal.operation(tmp,'recover',{output},host.environment),before=state(output),log=trace(output);assert.equal(current.operation,'reconcile');
  assert.throws(()=>journal.execute(tmp,current.spec,host.environment),/повтор действия запрещён/);
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'write'},host.environment),/текущего шага/);
  for(const command of ['save','retry','fail']){
   const spec={...begun.save,content:{text:'receipt'},reason:'Невозможно проверить',effect:{status:'not-applied',reference:'agent says so'}};
   assert.throws(()=>journal.operation(tmp,command,spec,host.environment),/Заявление агента/);
  }
  const unknown=host.receipt(current.effectRequest,'unknown');assert.throws(()=>journal.operation(tmp,'retry',{output,attemptId:begun.pending.id,effect:unknown},host.environment),/не подтвердила/);
  assert.deepEqual(state(output),before);assert.equal(trace(output),log);
  journal.operation(tmp,'save',{...begun.save,content:{text:'receipt'},effect:host.receipt(current.effectRequest,'applied')},host.environment);
  assert.equal(journal.operation(tmp,'finish',{output,resultName:'receipt.json'}).status,'completed');
 });
 check('verified not-applied allows a new attempt but old approval and effect receipts cannot be replayed',()=>{
  const output=create(),host=trusted(),card=journal.operation(tmp,'next',{output});
  const oldApproval=host.receipt(card.approvalRequest),first=journal.operation(tmp,'begin',{...card.spec,approval:oldApproval},host.environment);
  const reconcile=journal.operation(tmp,'next',{output},host.environment),notApplied=host.receipt(reconcile.effectRequest,'not-applied');
  journal.operation(tmp,'retry',{output,attemptId:first.pending.id,effect:notApplied},host.environment);
  const next=journal.operation(tmp,'next',{output},host.environment);
  assert.throws(()=>journal.operation(tmp,'begin',{...next.spec,approval:oldApproval},host.environment),/requestId/);
  const second=journal.operation(tmp,'begin',{...next.spec,approval:host.receipt(next.approvalRequest)},host.environment);assert.notEqual(second.pending.id,first.pending.id);
  assert.throws(()=>journal.operation(tmp,'retry',{output,attemptId:second.pending.id,effect:notApplied},host.environment),/requestId/);
  assert.equal(journal.operation(tmp,'next',{output}).operation,'reconcile');
 });
}finally{ctx.close();}

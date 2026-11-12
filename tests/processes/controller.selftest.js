'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,write,check,validate}=ctx;
const journal=require('../../tools/lib/runtime/run-journal'),{lifecycle}=require('../../tools/lib/entities/process-release');
const read=f=>JSON.parse(fs.readFileSync(path.join(tmp,f),'utf8'));
const state=output=>read(`outputs/${output}/.run/state.json`);
const start=(extra={})=>journal.start(tmp,{process:'example',mode:'local',inputText:'12 задач.',params:{to:'User',subject:'Status'},...extra}).output;
const save=(output,step='edit',extra={})=>journal.operation(tmp,'save',{output,step,attemptId:state(output).pending?.id,artifact:step==='edit'?'report-text':'mail-draft',extension:'md',content:'12 задач.',next:step==='edit'?'draft':'end',...extra});
try{
 check('controller rejects skipped steps, wrong actions, missing results and stale attempts without a transition',()=>{
  const output=start(),before=state(output);
  for(const [cmd,spec]of [['begin',{step:'draft'}],['begin',{step:'edit',action:'prepare-mail-draft'}],['finish',{resultName:'result.md'}],['save',{step:'edit'}],['leave',{}]])assert.throws(()=>journal.operation(tmp,cmd,{output,...spec}));
  assert.deepEqual(state(output),before);
  const begun=journal.operation(tmp,'begin',{output,step:'edit'});
  assert.equal(begun.save.attemptId,begun.pending.id);
  assert.throws(()=>save(output,'edit',{attemptId:'stale'}),/attemptId/);
  assert.throws(()=>save(output,'edit',{content:''}),/непустой/);
  assert.throws(()=>save(output,'edit',{next:'end'}),/Следующий узел/);
  save(output);assert.throws(()=>save(output),/begin/);
  assert.throws(()=>journal.operation(tmp,'finish',{output,resultName:'result.md'}));
  journal.operation(tmp,'begin',{output,step:'draft'});save(output,'draft');
  journal.operation(tmp,'finish',{output,resultName:'result.md'});
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'edit'}),/Завершённый/);
  assert.throws(()=>journal.operation(tmp,'finish',{output,resultName:'another.md'}),/переименовать/);
 });
 check('start shares structural and artifact-flow validation with check, before writing outputs',()=>{
  const original=fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8');
  const variants=[original.replace('version: 1.0.0','version: broken'),original.replace('entry: edit','entry: draft').replace(/### edit[\s\S]*?(?=### draft)/,''),original.replace('действие: edit-text','действие: missing'),original.replace('следующий: draft','следующий: edit')];
  for(const text of variants){
   write('processes/my-invalid/PROCESS.md',text.replace('name: example','name: my-invalid'));
   assert.throws(()=>journal.start(tmp,{process:'my-invalid',mode:'local'}));
   validate(['--process','my-invalid'],false);
  }
  fs.rmSync(path.join(tmp,'processes/my-invalid'),{recursive:true});
 });
 check('execute rejects model and act branch targets without starting or failing the run',()=>{
  for(const [name,action,params,artifact]of [['my-edit-gate','edit-text','  styleFile: context/master/writing-style/CONTEXT.md','report-text'],['my-act-gate','my-act','  styleFile: context/master/writing-style/CONTEXT.md','receipt']]){
   if(action==='my-act'){
    fs.cpSync(path.join(tmp,'actions/edit-text'),path.join(tmp,'actions/my-act'),{recursive:true});
    const file=path.join(tmp,'actions/my-act/ACTION.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: edit-text','name: my-act').replace('kind: transform','kind: act'));
   }
   write(`processes/${name}/PROCESS.md`,`---\nname: ${name}\nversion: 1.0.0\narea: test\nstatus: действует\npublication: legacy\ndescription: Branch operation test\nexample: test\nentry: gate\nparams:\n${params}\n---\n## Шаги\n### gate\n- branch:\n  - иначе (default): goto: work\n### work\n- действие: ${action}\n- параметры: \`text: {params.input}\`\n- артефакт: ${artifact}\n- следующий: end\n`);
   const output=start({process:name}),before=state(output),trace=path.join(tmp,'outputs',output,'.run/trace.jsonl'),events=fs.readFileSync(trace,'utf8');
   assert.throws(()=>journal.execute(tmp,{output,step:'work',decision:'Выбран шаг'}),/run begin/);
   assert.deepEqual(state(output),before);assert.equal(fs.readFileSync(trace,'utf8'),events);
   assert.equal(journal.operation(tmp,'next',{output}).operation,'choose');
  }
 });
 check('declared branch chains can be selected without inventing actions',()=>{
  const original=fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8');
  const text=original.replace('name: example','name: my-chain').replace('entry: edit','entry: first').replace('## Шаги','## Шаги\n\n### first\n- branch:\n  - иначе (default): goto: second\n\n### second\n- branch:\n  - иначе (default): goto: edit');
  write('processes/my-chain/PROCESS.md',text);
  const output=start({process:'my-chain',definitionTest:true});
  for(const [step,target]of [['first','second'],['second','edit']]){
   const card=journal.operation(tmp,'next',{output});assert.equal(card.spec.step,step);
   const before=state(output);assert.throws(()=>journal.operation(tmp,'choose',{...card.spec,target:'missing',decision:'нет'}));assert.deepEqual(state(output),before);
   journal.operation(tmp,'choose',{...card.spec,target,decision:'Проверенный default'});
  }
  assert.equal(journal.operation(tmp,'next',{output}).spec.step,'edit');
  for(const step of ['edit','draft']){journal.operation(tmp,'begin',{output,step});save(output,step);}
  assert.equal(journal.operation(tmp,'finish',{output,resultName:'chain.md'}).status,'completed');
 });
 check('branch cards use exact section names rather than a matching heading prefix',()=>{
  const original=fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8');
  const text=original.replace('name: example','name: my-prefix').replace('entry: edit','entry: gate-prep').replace('### edit','### gate-prep').replace('следующий: draft','следующий: gate').replace('### draft','### gate\n- branch:\n  - иначе (default): goto: draft\n\n### draft');
  write('processes/my-prefix/PROCESS.md',text);
  const output=start({process:'my-prefix',definitionTest:true}),begun=journal.operation(tmp,'begin',{output,step:'gate-prep'});
  journal.operation(tmp,'save',{...begun.save,content:'12 задач.'});
  const card=journal.operation(tmp,'next',{output});assert.equal(card.step,'gate');assert.ok(card.branch.includes('goto: draft'));assert.ok(!card.branch.includes('действие: edit-text'));
 });
 check('corrupt publication receipts are regenerated by validate without manual deletion',()=>{
  const original=fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8');
  write('processes/my-receipt/PROCESS.md',original.replace('name: example','name: my-receipt').replace('publication: legacy','publication: required'));
  write('processes/my-receipt/publication.json','{');
  assert.throws(()=>start({process:'my-receipt'}));
  assert.equal(lifecycle(tmp,'validate',{process:'my-receipt'}).status,'validated');
  assert.equal(read('processes/my-receipt/publication.json').status,'validated');
  assert.throws(()=>lifecycle(tmp,'publish',{process:'my-receipt'}),/definition test/);
 });
 check('computed branches reject the other declared target and recover the chosen pending step',()=>{
  const output=journal.start(tmp,{process:'sdd-stories-report',mode:'demo',params:{wantsMail:true,dataFile:'processes/sdd-stories-report/fixture.json'}}).output;
  for(const step of ['fetch','read-code','assess','compose'])journal.execute(tmp,{output,step});
  const card=journal.operation(tmp,'next',{output});assert.equal(card.decisionMode,'code');assert.deepEqual(card.targets,['prepare-mail-data']);
  const before=state(output);
  assert.throws(()=>journal.operation(tmp,'finish',{output,resultName:'result.md',decision:'Хочу пропустить'}),/допустимый выбор/);
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'missing',decision:'нет'}));assert.deepEqual(state(output),before);
  journal.operation(tmp,'begin',{output,step:'prepare-mail-data'});
  assert.equal(journal.operation(tmp,'recover',{output}).spec.step,'prepare-mail-data');
  journal.execute(tmp,{output,step:'prepare-mail-data'});assert.equal(state(output).next_step,'compose-mail');
 });
 check('definition lifecycle gates publication and invalidates changed definitions and actions',()=>{
  const original=fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8');
  write('processes/my-published/PROCESS.md',original.replace('name: example','name: my-published').replace('publication: legacy','publication: required'));
  const spec={process:'my-published'};
  assert.equal(lifecycle(tmp,'status',spec).status,'draft');
  assert.throws(()=>start(spec),/не опубликовано/);
  assert.equal(lifecycle(tmp,'validate',spec).status,'validated');
  assert.throws(()=>lifecycle(tmp,'publish',spec),/definition test/);
  assert.throws(()=>start({...spec,mode:'live',definitionTest:true}),/local\/demo/);
  const output=start({...spec,definitionTest:true});
  assert.throws(()=>lifecycle(tmp,'test',{...spec,outputs:[output]}),/завершённый/);
  for(const step of ['edit','draft']){journal.operation(tmp,'begin',{output,step});save(output,step);}
  journal.operation(tmp,'finish',{output,resultName:'result.md'});
  assert.equal(lifecycle(tmp,'test',{...spec,outputs:[output]}).status,'tested');
  assert.equal(lifecycle(tmp,'publish',spec).status,'published');
  assert.equal(state(start(spec)).status,'running');
  const actionFile='actions/edit-text/rules/before-after.md',old=fs.readFileSync(path.join(tmp,actionFile),'utf8');
  write(actionFile,old+'\nИзменение правила.');assert.equal(lifecycle(tmp,'status',spec).status,'draft');assert.throws(()=>start(spec),/не опубликовано/);
  write(actionFile,old);
  write('processes/my-published/PROCESS.md',fs.readFileSync(path.join(tmp,'processes/my-published/PROCESS.md'),'utf8').replace('version: 1.0.0','version: 1.0.1'));
  assert.throws(()=>lifecycle(tmp,'publish',spec),/definition validate/);
 });
 check('unmarked definitions require publication and legacy parents cannot bypass a required child',()=>{
  const original=fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8');
  write('processes/my-unmarked/PROCESS.md',original.replace('name: example','name: my-unmarked').replace('publication: required\n',''));
  assert.throws(()=>start({process:'my-unmarked'}),/не опубликовано/);
  assert.throws(()=>start({process:'my-unmarked',definitionTest:'false'}),/boolean/);
  write('processes/my-parent/PROCESS.md','---\nname: my-parent\nversion: 1.0.0\narea: test\nstatus: действует\npublication: legacy\ndescription: Legacy caller\nexample: test\nentry: call\n---\n## Шаги\n### call\n- процесс: my-unmarked\n- следующий: end\n');
  assert.throws(()=>start({process:'my-parent'}),/не опубликовано/);
 });
 check('rejected branch preparation writes neither a transition nor an event',()=>{
  write('processes/my-page-gate/PROCESS.md','---\nname: my-page-gate\nversion: 1.0.0\narea: test\nstatus: действует\npublication: legacy\ndescription: Page gate\nexample: test\nentry: gate\nparams:\n  url: https://example.org/\n---\n## Шаги\n### gate\n- branch:\n  - иначе (default): goto: read\n### read\n- действие: read-page\n- артефакт: page\n- следующий: end\n');
  const output=journal.start(tmp,{process:'my-page-gate',mode:'local'}).output;
  const trace=path.join(tmp,'outputs',output,'.run/trace.jsonl'),before=fs.readFileSync(trace,'utf8'),saved=state(output);
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'read',decision:'Проверить страницу'}),/только в live или demo/);
  assert.equal(fs.readFileSync(trace,'utf8'),before);assert.deepEqual(state(output),saved);
 });
 check('publication requires all branch outcomes from completed tests, not one successful run',()=>{
  const source=fs.readFileSync(path.join(tmp,'processes/sdd-stories-report/PROCESS.md'),'utf8');
  write('processes/sdd-stories-report/PROCESS.md',source.replace('publication: legacy','publication: required'));
  const spec={process:'sdd-stories-report',mode:'demo',params:{dataFile:'processes/sdd-stories-report/fixture.json'}};
  lifecycle(tmp,'validate',spec);
  const output=journal.start(tmp,{...spec,definitionTest:true}).output;
  for(const step of ['fetch','read-code','assess','compose'])journal.execute(tmp,{output,step});
  journal.operation(tmp,'finish',{output,resultName:'report.md'});
  assert.throws(()=>lifecycle(tmp,'test',{process:spec.process,outputs:[output]}),/Не проверена ветка/);
  const mail=journal.start(tmp,{...spec,params:{...spec.params,wantsMail:true,recipients:'User'},definitionTest:true}).output;
  for(const step of ['fetch','read-code','assess','compose','prepare-mail-data','compose-mail'])journal.execute(tmp,{output:mail,step});
  const begun=journal.operation(tmp,'begin',{output:mail,step:'notify'}),saved=state(mail);
  const content=fs.readFileSync(path.join(tmp,'outputs',mail,'.run',saved.artifacts['report-text']),'utf8');
  journal.operation(tmp,'save',{...begun.save,artifact:'mail-draft',extension:'md',content,next:'end'});
  journal.operation(tmp,'finish',{output:mail,resultName:'mail.md'});
  assert.equal(lifecycle(tmp,'test',{process:spec.process,outputs:[output,mail]}).status,'tested');
  assert.equal(lifecycle(tmp,'publish',{process:spec.process}).status,'published');
  assert.equal(journal.start(tmp,spec).state.status,'running');
 });
}finally{ctx.close();}

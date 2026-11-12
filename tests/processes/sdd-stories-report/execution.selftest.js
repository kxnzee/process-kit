'use strict';
const ctx=require('../../fixture')(),{fs,path,assert,tmp,source,write,check}=ctx;
const journal=require('../../../tools/lib/runtime/run-journal');
try {
 const attempt=output=>JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'.run/state.json'))).pending.id;

  check('SDD consumes generic saved records and preserves the calculated result', () => {
    const sdd=require('../../../processes/sdd-stories-report/rules/sdd'),{queryFixture}=require('../../../tools/lib/actions/query-data');
    const fx=JSON.parse(fs.readFileSync(path.join(tmp,'processes/sdd-stories-report/fixture.json')));
    const request='processes/sdd-stories-report/queries/stories.md';
    for(const wantsMail of [false,true]){
    const run=journal.start(tmp,{process:'sdd-stories-report',mode:'demo',date:'2026-11-04',params:{wantsMail,dataFile:'processes/sdd-stories-report/fixture.json'}});
    const statePath=path.join(tmp,'outputs',run.output,'.run/state.json');
    const readPort=port=>{const state=JSON.parse(fs.readFileSync(statePath));return JSON.parse(fs.readFileSync(path.join(tmp,'outputs',run.output,'.run',state.artifacts[port])));};
    journal.operation(tmp,'begin',{output:run.output,step:'fetch'});
    journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'fetch',artifact:'task-records',extension:'json',content:queryFixture(fx,request),next:'read-code'});
    const tasks=readPort('task-records'),code=require('../../../tools/lib/actions/code-data').evidenceFromFixture(fx,tasks,'processes/sdd-stories-report/queries/code-evidence.md');
    journal.operation(tmp,'begin',{output:run.output,step:'read-code'});
    journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'read-code',artifact:'code-evidence',extension:'json',content:code,next:'assess'});
    const report=sdd.assessSdd(tasks,readPort('code-evidence'),{label:'SDD',watchPath:'openspec/changes',statusesAccepted:run.state.params.statusesAccepted});
    journal.operation(tmp,'begin',{output:run.output,step:'assess'});
    journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'assess',artifact:'report-data',extension:'json',content:report,next:'compose'});
    assert.equal(readPort('report-data').counters.sddShare,'75,0');
    journal.operation(tmp,'begin',{output:run.output,step:'compose'});
    assert.throws(()=>journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'compose',artifact:'sdd-report',extension:'md',content:'# —\nДоля: — %\nПроверить не удалось: нет записей',next:'gate'}),/Отчёт не соответствует/);
    journal.execute(tmp,{output:run.output,step:'compose'});
    const composedState=JSON.parse(fs.readFileSync(statePath));
    const reportBody=fs.readFileSync(path.join(tmp,'outputs',run.output,'.run',composedState.artifacts['sdd-report']),'utf8');
    for(const fact of ['75,0','DEMO-401','DEMO-402','ДАННЫЕ ДЕМО',report.meta.window])assert.ok(reportBody.includes(fact),fact);
    if(!wantsMail){
      journal.operation(tmp,'choose',{output:run.output,step:'gate',target:'end'});
      journal.operation(tmp,'finish',{output:run.output,resultName:'отчёт.md',decision:'Письмо не запрошено'});
      const finished=JSON.parse(fs.readFileSync(statePath));
      assert.equal(finished.status,'completed');assert.ok(!finished.artifacts['mail-draft']);
      assert.equal(fs.readFileSync(path.join(tmp,'outputs',run.output,'отчёт.md'),'utf8'),reportBody);
      continue;
    }
    journal.operation(tmp,'choose',{output:run.output,step:'gate',target:'prepare-mail-data'});
    journal.operation(tmp,'begin',{output:run.output,step:'prepare-mail-data',decision:'Запрошен черновик; есть истории без SDD'});
    const pending=JSON.parse(fs.readFileSync(statePath)).pending;
    const mail=require('../../../processes/sdd-stories-report/rules/mail').evaluate({report},pending.params.parameters);
    assert.deepEqual(mail.stories.map(row=>row.key),report.plainStories.map(row=>row.key));
    assert.ok(mail.to);
    journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'prepare-mail-data',artifact:'mail-data',extension:'json',content:mail,next:'compose-mail'});
    journal.operation(tmp,'begin',{output:run.output,step:'compose-mail'});
    const body=require('../../../processes/sdd-stories-report/renderers/mail').render(mail);
    journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'compose-mail',artifact:'report-text',extension:'md',content:body,next:'notify'});
    journal.operation(tmp,'begin',{output:run.output,step:'notify'});
    journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'notify',artifact:'mail-draft',extension:'md',content:body,next:'end'});
    journal.operation(tmp,'finish',{output:run.output,resultName:'письмо.md'});
    const finished=JSON.parse(fs.readFileSync(statePath));
    assert.equal(finished.status,'completed');
    assert.equal(fs.readFileSync(path.join(tmp,'outputs',run.output,'письмо.md'),'utf8'),body);
    assert.ok(finished.artifacts['sdd-report']);

    assert.equal(sdd.assessSdd(tasks,readPort('code-evidence'),{label:'other',watchPath:'elsewhere',statusesAccepted:run.state.params.statusesAccepted}).counters.sddShare,'0,0');
    assert.equal(readPort('report-data').meta.statusesAccepted,run.state.params.statusesAccepted);
    assert.throws(()=>sdd.assessSdd(tasks,readPort('code-evidence'),{label:'SDD',watchPath:'openspec/changes'}),/statusesAccepted/);
    assert.throws(()=>sdd.assessSdd(tasks,readPort('code-evidence'),{label:'SDD',watchPath:'openspec/changes',statusesAccepted:' '}),/statusesAccepted/);
    assert.throws(()=>queryFixture(fx,'processes/my-other/queries/select.md'));
    }
  });
  check('mail preparation rejects empty selection and unknown recipients; JSON arguments preserve user text', () => {
    const {evaluate}=require('../../../processes/sdd-stories-report/rules/mail');
    const report={meta:{window:'2026',demo:true},plainStories:[{key:'A-1',summary:'Story',url:'https://example.test/A-1'}]};
    assert.throws(()=>evaluate({report},{}),/получателей/);
    assert.throws(()=>evaluate({report:{...report,plainStories:[]}},{recipients:'User'}),/Нет историй/);
    const recipients='Команда "А"\nowner@example.test';
    const {stepParams}=require('../../../tools/lib/entities/process-dependencies');
    const params=stepParams({recipients},{params:{parameters:'{"recipients":"{params.recipients}"}'}}).parameters;
    assert.equal(evaluate({report},params).to,recipients);
  });
} finally {ctx.close();}

'use strict';
const fixture=require('../fixture');
const ctx=fixture(),{fs,path,assert,tmp,source,write,check}=ctx;
const journal=require('../../tools/lib/runtime/run-journal'),{dependencies}=require('../../tools/lib/entities/process-dependencies');
const {selectionId}=require('../../tools/lib/actions/query-data'),{evidenceFromFixture}=require('../../tools/lib/actions/code-data');
try {
  check('two callers reuse code reading with different parameters and no SDD dependency',()=>{
    const original=fs.readFileSync(path.join(tmp,'actions/read-code-evidence/ACTION.md'),'utf8');
    for(const [name,parameters,pr] of [
      ['my-pr-review',{states:['OPEN'],paths:['src/']},{id:17,state:'OPEN',changedPaths:['src/main.js']}],
      ['my-release-audit',{states:['MERGED'],branches:['release']},{id:23,state:'MERGED',changedPaths:['docs/release.md']}]
    ]) {
      const taskQuery=`processes/${name}/queries/tasks.md`,codeQuery=`processes/${name}/queries/code.md`;
      write(taskQuery,'# Задачи\nЧитать выбранные ключи.\n');write(codeQuery,'# Код\nЧитать PR по явным parameters.\n');
      write(`processes/${name}/PROCESS.md`,`---\nname: ${name}\nentry: tasks\n---\n## Шаги\n### tasks\n- действие: run-query\n- параметры:\n  - \`queryFile: ${taskQuery}\`\n  - \`parameters: {}\`\n- артефакт: task-records\n- следующий: code\n### code\n- действие: read-code-evidence\n- параметры:\n  - \`queryFile: ${codeQuery}\`\n  - \`parameters: ${JSON.stringify(parameters)}\`\n- артефакт: code-evidence\n- следующий: end\n`);
      const files=dependencies(tmp,name,{},'demo');
      assert.ok(files.includes(codeQuery));assert.ok(files.includes('tools/lib/actions/code-data.js'));
      assert.ok(!files.some(f=>f.includes('sdd-data')||f.includes('sdd-stories-report')));
      const run=journal.start(tmp,{process:name,mode:'demo',date:'2026-11-04'});
      const statePath=path.join(tmp,'outputs',run.output,'.run/state.json');
      const state=()=>JSON.parse(fs.readFileSync(statePath));
      const readPort=port=>JSON.parse(fs.readFileSync(path.join(tmp,'outputs',run.output,'.run',state().artifacts[port])));
      journal.operation(tmp,'begin',{output:run.output,step:'tasks'});
      journal.operation(tmp,'save',{output:run.output,step:'tasks',artifact:'task-records',extension:'json',content:{meta:{},records:[{key:'TASK-1'}],excluded:[],unverified:[]},next:'code'});
      const tasks=readPort('task-records');
      journal.operation(tmp,'begin',{output:run.output,step:'code'});
      assert.deepEqual(state().pending.params.parameters,parameters);
      const code=evidenceFromFixture({codeEvidence:{queryFile:codeQuery,records:[{key:'TASK-1',prs:[pr],prsComplete:true}]}},tasks,codeQuery);
      journal.operation(tmp,'save',{output:run.output,step:'code',artifact:'code-evidence',extension:'json',content:code,next:'end'});
      assert.deepEqual(readPort('code-evidence'),{selectionId:tasks.selectionId,queryFile:codeQuery,records:[{key:'TASK-1',prs:[pr],prsComplete:true}]});
      const changed=journal.start(tmp,{process:name,mode:'demo',date:'2026-11-04',slug:'changed'});
      write(codeQuery,'# Changed request\n');
      assert.throws(()=>journal.operation(tmp,'begin',{output:changed.output,step:'tasks'}),/Изменён вход/);
    }
    assert.equal(fs.readFileSync(path.join(tmp,'actions/read-code-evidence/ACTION.md'),'utf8'),original);
  });
  check('missing code remains unverified and code reading preserves the saved input',()=>{
    const tasks={meta:{queryFile:'processes/my-check/queries/tasks.md'},records:[{key:'A-1'},{key:'A-2'}],excluded:[],unverified:[]};tasks.selectionId=selectionId(tasks);
    const before=JSON.stringify(tasks),request='processes/my-check/queries/code.md';
    const fx={codeEvidence:{queryFile:request,records:[{key:'A-1',prs:[],prsComplete:true}]}};
    const code=evidenceFromFixture(fx,tasks,request);
    assert.equal(code.records[0].prsComplete,true);assert.equal(code.records[1].prsComplete,false);
    assert.ok(code.records[1].reason);assert.ok(!Object.hasOwn(code.records[1],'prs'));
    assert.equal(JSON.stringify(tasks),before);code.records[0].prs.push({state:'OPEN'});assert.deepEqual(fx.codeEvidence.records[0].prs,[]);
    assert.throws(()=>evidenceFromFixture(fx,tasks,'processes/my-other/queries/code.md'));
    assert.throws(()=>evidenceFromFixture(fx,{...tasks,selectionId:'changed'},request));
    fx.codeEvidence.records.push({key:'A-1'});assert.throws(()=>evidenceFromFixture(fx,tasks,request),/уникальные/);
  });
}finally{ctx.close();}

'use strict';
const fixture = require('../fixture');
const ctx = fixture();
const {fs,path,assert,tmp,source,write,check} = ctx;
const journal = require('../../tools/lib/runtime/run-journal');
const {dependencies} = require('../../tools/lib/entities/process-dependencies');
const {queryFile} = require('../../tools/lib/actions/query-file');
try {
 const attempt=output=>JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'.run/state.json'))).pending.id;

  check('two callers reuse run-query with different arguments and records, without SDD', () => {
    const original=fs.readFileSync(path.join(tmp,'actions/run-query/ACTION.md'),'utf8');
    for (const [name,parameters,record] of [
      ['my-open-tickets',{status:'Open'},{key:'T-1',summary:'Ticket',status:'Open'}],
      ['my-release-check',{release:'2.0'},{key:'R-2',version:'2.0',approved:true}]
    ]) {
      const request=`processes/${name}/queries/select.md`;
      write(request,'# Выборка\nЧитай записи по переданным parameters; ошибки и неполноту возвращай явно.\n');
      write(`processes/${name}/PROCESS.md`,`---\nname: ${name}\nversion: 1.0.0\narea: тест\nstatus: действует\npublication: legacy\ndescription: Проверочный процесс\nexample: test\nentry: read\n---\n## Шаги\n### read\n- действие: run-query\n- параметры:\n  - \`queryFile: ${request}\`\n  - \`parameters: ${JSON.stringify(parameters)}\`\n- артефакт: task-records\n- следующий: end\n`);
      const files=dependencies(tmp,name,{},'demo');
      assert.ok(files.includes(request));
      assert.ok(!files.some(f=>f.includes('rules/sdd.js')||f.includes('sdd-stories-report')));
      const run=journal.start(tmp,{process:name,mode:'demo',date:'2026-11-04'});
      journal.operation(tmp,'begin',{output:run.output,step:'read'});
      const statePath=path.join(tmp,'outputs',run.output,'.run/state.json');
      assert.deepEqual(JSON.parse(fs.readFileSync(statePath)).pending.params.parameters,parameters);
      journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'read',artifact:'task-records',extension:'json',content:{meta:{},records:[record],excluded:[],unverified:[]},next:'end'});
      const state=JSON.parse(fs.readFileSync(statePath));
      const saved=JSON.parse(fs.readFileSync(path.join(tmp,'outputs',run.output,'.run',state.artifacts['task-records'])));
      assert.deepEqual(saved.records,[record]);assert.equal(saved.meta.queryFile,request);assert.ok(saved.selectionId);
    }
    assert.equal(fs.readFileSync(path.join(tmp,'actions/run-query/ACTION.md'),'utf8'),original);
  });
  check('query paths fail closed on traversal and references to another team', () => {
    assert.throws(()=>queryFile(tmp,'my-report','processes/my-report/queries/../../escape.md'));
    assert.throws(()=>queryFile(tmp,'team-a-report','processes/team-b-report/queries/select.md'));
  });
} finally { ctx.close(); }

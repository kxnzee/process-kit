'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,write,check}=ctx;
const {dependencies}=require('../../tools/lib/entities/process-dependencies'),journal=require('../fixture').runtimeJournal();
const {validateArtifact}=require('../../tools/lib/contracts/artifact-contract');
try{
 const attempt=output=>JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'.run/state.json'))).pending.id;

 check('evaluation and document functions work with another domain and caller-owned resources',()=>{
  const base='processes/my-release';
  write(`${base}/data/items.json`,JSON.stringify({reviews:3}));
  write(`${base}/rules/check.js`,"exports.evaluate=(inputs,params)=>({accepted:inputs.release.reviews>=params.required});\n");
  write(`${base}/contracts/check.json`,'{"type":"object","required":["accepted"],"properties":{"accepted":{"type":"boolean"}},"additionalProperties":false}');
  write(`${base}/templates/verdict.md`,'# Release\nShow accepted from the passed data.\n');
  const params={inputs:{release:`${base}/data/items.json`},rulesFile:`${base}/rules/check.js`,parameters:{required:2},resultContract:`${base}/contracts/check.json`};
  const runtime=require(path.join(tmp,'actions/evaluate-data/runtime.js'));
  const context={cwd:tmp,processName:'my-release',actionName:'evaluate-data',params};
  assert.deepEqual(runtime.evaluate(context),{accepted:true});
  assert.deepEqual(runtime.evaluate({...context,params:{...params,parameters:{required:4}}}),{accepted:false});
  write(`${base}/PROCESS.md`,`---\nname: my-release\nversion: 1.0.0\narea: тест\nstatus: действует\npublication: required\ndescription: Проверочный процесс\nexample: test\nentry: evaluate\n---\n## Шаги\n### evaluate\n- действие: evaluate-data\n- параметры:\n  - \`inputs: ${JSON.stringify(params.inputs)}\`\n  - \`rulesFile: ${params.rulesFile}\`\n  - \`parameters: ${JSON.stringify(params.parameters)}\`\n  - \`resultContract: ${params.resultContract}\`\n- артефакт: verdict\n- следующий: compose\n### compose\n- действие: compose-report\n- параметры:\n  - \`data: {verdict}\`\n  - \`templateFile: ${base}/templates/verdict.md\`\n- артефакт: report-text\n- следующий: end\n`);
  const deps=dependencies(tmp,'my-release',{},'local');
  for(const file of [params.rulesFile,params.resultContract,params.inputs.release,`${base}/templates/verdict.md`])assert.ok(deps.includes(file),file);
  assert.ok(!deps.some(file=>file.includes('sdd-stories-report')));
  const run=journal.start(tmp,{process:'my-release',mode:'local',date:'2026-11-04'});
  journal.operation(tmp,'begin',{output:run.output,step:'evaluate'});
  assert.throws(()=>journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'evaluate',artifact:'verdict',extension:'json',content:{accepted:false},next:'compose'}),/не соответствует/);
  journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'evaluate',artifact:'verdict',extension:'json',content:{accepted:true},next:'compose'});
  journal.operation(tmp,'begin',{output:run.output,step:'compose'});
  journal.operation(tmp,'save',{attemptId:attempt(run.output),output:run.output,step:'compose',artifact:'report-text',extension:'md',content:'# Release\nAccepted: yes.\n',next:'end'});
  journal.operation(tmp,'finish',{output:run.output,resultName:'release.md'});
  const changed=journal.start(tmp,{process:'my-release',mode:'local',date:'2026-11-04',slug:'changed'});
  write(params.inputs.release,'{"reviews":0}');
  assert.throws(()=>journal.operation(tmp,'begin',{output:changed.output,step:'evaluate'}),/Изменён вход/);
 });
 check('copied actions keep their local semantic validation after renaming',()=>{
  fs.cpSync(path.join(tmp,'actions/compose-report'),path.join(tmp,'actions/my-compose'),{recursive:true});
  const file=path.join(tmp,'actions/my-compose/ACTION.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: compose-report','name: my-compose'));
  assert.throws(()=>validateArtifact(tmp,'my-compose','report-text','md','{{unfilled}}'),/переменные/);
  write('processes/my-release/data/cited.json',JSON.stringify({accepted:true}));
  write('processes/my-release/templates/scoped.md','# Release\naccepted: {{accepted}}\n');
  const scoped={processName:'my-release',params:{data:'processes/my-release/data/cited.json',templateFile:'processes/my-release/templates/scoped.md'}};
  assert.doesNotThrow(()=>validateArtifact(tmp,'my-compose','report-text','md','# Release\naccepted: true\nПравило источника {{other.System.field}} цитируется дословно.\n',scoped));
  assert.throws(()=>validateArtifact(tmp,'my-compose','report-text','md','# Release\n{{accepted}}\n',scoped),/переменные шаблона: \{\{accepted\}\}/);
  assert.throws(()=>validateArtifact(tmp,'my-compose','report-text','md','# Release\naccepted: true\n{{#each items}}x{{/each}}\n',scoped),/переменные шаблона/);
  fs.cpSync(path.join(tmp,'actions/run-query'),path.join(tmp,'actions/my-query'),{recursive:true});
  const query=path.join(tmp,'actions/my-query/ACTION.md');fs.writeFileSync(query,fs.readFileSync(query,'utf8').replace('name: run-query','name: my-query'));
  assert.throws(()=>validateArtifact(tmp,'my-query','task-records','json',{meta:{queryFile:'processes/my-release/queries/tasks.md'},records:[{key:'A-1'}],excluded:[{key:'A-1',reason:'duplicate'}],unverified:[],selectionId:'id'}),/повторяющийся/);
 });
 check('edit-text requires its style context level to be declared',()=>{
  write('processes/my-short/PROCESS.md','---\nname: my-short\nversion: 1.0.0\narea: тест\nstatus: действует\npublication: required\ndescription: Проверочный процесс\nexample: test\nentry: edit\nparams:\n  styleFile: context/master/writing-style/CONTEXT.md\n---\n## Шаги\n### edit\n- действие: edit-text\n- артефакт: report-text\n- следующий: end\n');
  assert.ok(dependencies(tmp,'my-short',{},'local').includes('context/master/writing-style/CONTEXT.md'));
  const file=path.join(tmp,'processes/my-short/PROCESS.md');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('context: [master]','context: []'));
  assert.throws(()=>dependencies(tmp,'my-short',{},'local'),/не объявлен/);
 });
}finally{ctx.close();}

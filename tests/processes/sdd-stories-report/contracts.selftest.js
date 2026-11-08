'use strict';
const {fs,path,assert,cwd,source,read,check,close} = (() => { const ctx=require('../../fixture')(); return {...ctx,cwd:ctx.tmp,read:f=>ctx.fs.readFileSync(ctx.path.join(ctx.tmp,f),'utf8')}; })();
const sdd=require('../../../processes/sdd-stories-report/rules/sdd'),{validateArtifact}=require('../../../tools/lib/contracts/artifact-contract');
try {
 const fx=JSON.parse(fs.readFileSync(path.join(source,'processes/sdd-stories-report/fixture.json'),'utf8')),pair=sdd.splitFixture(fx),report=sdd.assessSdd(pair.tasks,pair.code);
 check('current source and assessment examples satisfy full schemas',()=>{validateArtifact(cwd,'run-query','task-records','json',pair.tasks);validateArtifact(cwd,'read-code-evidence','code-evidence','json',pair.code);require('../../../tools/lib/contracts/value-contract').validateValue(require('../../../tools/lib/contracts/value-contract').loadContract(cwd,'processes/sdd-stories-report/contracts/report-data.json'),report);});
 check('missing fields and invalid nested field types are rejected',()=>{const data=structuredClone(pair.tasks);delete data.records[0].key;assert.throws(()=>validateArtifact(cwd,'run-query','task-records','json',data));data.records[0].key=12;assert.throws(()=>validateArtifact(cwd,'run-query','task-records','json',data));});
 const params={inputs:{tasks:'tasks.json',code:'code.json'},parameters:{label:'SDD',watchPath:'openspec/changes',statusesAccepted:'IFT, Ready for UAT, Done, Resolved'},rulesFile:'processes/sdd-stories-report/rules/sdd.js',resultContract:'processes/sdd-stories-report/contracts/report-data.json'};
 fs.writeFileSync(path.join(cwd,'tasks.json'),JSON.stringify(pair.tasks));fs.writeFileSync(path.join(cwd,'code.json'),JSON.stringify(pair.code));
 const context={params,processName:'sdd-stories-report'};
 check('contradictory calculated counters are rejected',()=>{const data=structuredClone(report);data.counters.storyCount++;assert.throws(()=>validateArtifact(cwd,'evaluate-data','data','json',data,context),/не соответствует/);});
 check('code output cannot refer to a different selected input',()=>{assert.throws(()=>validateArtifact(cwd,'read-code-evidence','code-evidence','json',{...pair.code,selectionId:'wrong'},{inputs:{'task-records':pair.tasks}}),/другому отбору/);});
 check('assessment output cannot silently drop selected stories',()=>{const data=structuredClone(report);data.sddStories.pop();assert.throws(()=>validateArtifact(cwd,'evaluate-data','data','json',data,context),/не соответствует/);});
  check('положительный PR достаточен при неизвестной метке', () => {
    const input = structuredClone(fx); delete input.result.records[1].labels;
    assert.ok(sdd.normalizeFixture(input).sddStories.some(s => s.key === 'DEMO-202'));
  });
} finally { close(); }

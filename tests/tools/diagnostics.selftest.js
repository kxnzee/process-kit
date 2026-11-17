'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,write,check,validate}=ctx;
const journal=require('../../tools/lib/runtime/run-journal'),{report,category}=require('../../tools/lib/runtime/diagnostics');
try{
 const output=journal.start(tmp,{process:'example',mode:'local',date:'2026-11-08',inputText:'PRIVATE_INPUT_847',params:{to:'PRIVATE_RECIPIENT',subject:'PRIVATE_SUBJECT'}}).output;
 journal.operation(tmp,'begin',{output,step:'edit'});
 journal.operation(tmp,'fail',{output,reason:'ETIMEDOUT https://private.example/?token=PRIVATE_TOKEN'});
 check('diagnostics contains run facts but excludes inputs, parameters and raw errors',()=>{
  const result=report(tmp,output),text=fs.readFileSync(result.reportFile,'utf8');
  for(const expected of ['example','edit','failed','step_started',category('ETIMEDOUT')])assert.ok(text.includes(expected),expected);
  for(const secret of ['PRIVATE_INPUT_847','PRIVATE_RECIPIENT','PRIVATE_SUBJECT','PRIVATE_TOKEN','private.example','ETIMEDOUT'])assert.ok(!text.includes(secret),secret);
  assert.equal(result.status,'failed');
  const second=report(tmp,output);assert.notEqual(second.reportFile,result.reportFile);
  assert.equal(fs.readFileSync(result.reportFile,'utf8'),text);
 });
 check('diagnostics survives damaged state and trace without leaking their contents',()=>{
  const state=path.join(tmp,'outputs',output,'.run/state.json'),trace=path.join(tmp,'outputs',output,'.run/trace.jsonl');
  fs.writeFileSync(state,'PRIVATE_BROKEN_STATE');fs.appendFileSync(trace,'PRIVATE_BROKEN_TRACE\n');
  const result=report(tmp,output),text=fs.readFileSync(result.reportFile,'utf8');
  assert.ok(result.events>0);assert.ok(fs.statSync(result.reportFile).size>0);
  assert.ok(!text.includes('PRIVATE_BROKEN'));
 });
 check('diagnostics rejects traversal and absent runs',()=>{
  for(const value of ['../escape','2026-11-08_отсутствует'])assert.throws(()=>report(tmp,value));
  assert.equal(category('секрет PRIVATE_TOKEN'),category('UNCLASSIFIED_ERROR'));
  assert.ok(!category('секрет PRIVATE_TOKEN').includes('PRIVATE_TOKEN'));
 });
 check('diagnostics distinguishes start and current revisions, dirty state and legacy runs',()=>{
  const {execFileSync}=require('node:child_process');
  const git=(...args)=>execFileSync('git',['-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:tmp,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');write('.gitignore','*\n!revision-test.txt\n');write('revision-test.txt','before');git('add','revision-test.txt');git('commit','-m','before');
  const before=git('rev-parse','HEAD'),clean=journal.start(tmp,{process:'example',mode:'local',definitionTest:true,inputText:'PRIVATE_REVISION_INPUT',params:{to:'Test',subject:'Revision'}});
  assert.deepEqual(clean.state.identity.sourceRevision,{commit:before,dirty:false});
  write('revision-test.txt','dirty');const dirty=journal.start(tmp,{process:'example',mode:'local',definitionTest:true,inputText:'private',params:{to:'Test',subject:'Revision'}});
  assert.deepEqual(dirty.state.identity.sourceRevision,{commit:before,dirty:true});
  git('add','revision-test.txt');git('commit','-m','after');const after=git('rev-parse','HEAD');assert.notEqual(after,before);
  const text=fs.readFileSync(report(tmp,clean.output).reportFile,'utf8');
  assert.ok(text.includes('Коммит при старте: '+before));assert.ok(text.includes('Коммит текущей рабочей копии: '+after));assert.ok(text.includes('Локальные изменения при старте: нет'));assert.ok(!text.includes('PRIVATE_REVISION_INPUT'));
  assert.ok(fs.readFileSync(report(tmp,dirty.output).reportFile,'utf8').includes('Локальные изменения при старте: есть'));
  const stateFile=path.join(tmp,'outputs',clean.output,'.run/state.json'),state=JSON.parse(fs.readFileSync(stateFile));delete state.identity.sourceRevision;fs.writeFileSync(stateFile,JSON.stringify(state));
  const legacy=fs.readFileSync(report(tmp,clean.output).reportFile,'utf8');assert.ok(legacy.includes('Коммит при старте: не определён'));assert.ok(legacy.includes('Коммит текущей рабочей копии: '+after));
  state.identity.sourceRevision={commit:'PRIVATE_FAKE_COMMIT',dirty:'PRIVATE_FAKE_STATUS'};fs.writeFileSync(stateFile,JSON.stringify(state));
  const malformed=fs.readFileSync(report(tmp,clean.output).reportFile,'utf8');assert.ok(!malformed.includes('PRIVATE_FAKE'));
 });
}finally{ctx.close();}

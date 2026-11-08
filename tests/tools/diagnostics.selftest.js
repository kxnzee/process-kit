'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,write,check,validate}=ctx;
const journal=require('../../tools/lib/runtime/run-journal'),{report,category}=require('../../tools/lib/runtime/diagnostics');
try{
 const output=journal.start(tmp,{process:'example',mode:'local',date:'2026-11-08',inputText:'PRIVATE_INPUT_847',params:{to:'PRIVATE_RECIPIENT',subject:'PRIVATE_SUBJECT'}}).output;
 journal.operation(tmp,'begin',{output,step:'edit'});
 journal.operation(tmp,'fail',{output,reason:'ETIMEDOUT https://private.example/?token=PRIVATE_TOKEN'});
 check('diagnostics contains run facts but excludes inputs, parameters and raw errors',()=>{
  const result=report(tmp,output),text=fs.readFileSync(result.reportFile,'utf8');
  for(const expected of ['example','edit','failed','step_started','подключение недоступны'])assert.ok(text.includes(expected),expected);
  for(const secret of ['PRIVATE_INPUT_847','PRIVATE_RECIPIENT','PRIVATE_SUBJECT','PRIVATE_TOKEN','private.example','ETIMEDOUT'])assert.ok(!text.includes(secret),secret);
  assert.equal(result.status,'failed');
  const second=report(tmp,output);assert.notEqual(second.reportFile,result.reportFile);
  assert.equal(fs.readFileSync(result.reportFile,'utf8'),text);
 });
 check('diagnostics survives damaged state and trace without leaking their contents',()=>{
  const state=path.join(tmp,'outputs',output,'.run/state.json'),trace=path.join(tmp,'outputs',output,'.run/trace.jsonl');
  fs.writeFileSync(state,'PRIVATE_BROKEN_STATE');fs.appendFileSync(trace,'PRIVATE_BROKEN_TRACE\n');
  const text=fs.readFileSync(report(tmp,output).reportFile,'utf8');
  assert.ok(text.includes('состояние отсутствует или повреждено'));assert.ok(text.includes('повреждённые записи'));
  assert.ok(!text.includes('PRIVATE_BROKEN'));
 });
 check('diagnostics rejects traversal and absent runs',()=>{
  for(const value of ['../escape','2026-11-08_отсутствует'])assert.throws(()=>report(tmp,value));
  assert.equal(category('секрет PRIVATE_TOKEN'),'не определена по сохранённым данным');
 });
}finally{ctx.close();}

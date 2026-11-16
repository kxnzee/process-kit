'use strict';
const c=require('../fixture')(),{tmp,fs,path,assert,check}=c;
const runtime=require('../../actions/prepare-mail-draft/runtime'),journal=require('../fixture').runtimeJournal();
try{
 const body='12 tasks DEMO-42.\nLiteral sequence: \\n';
 const context={params:{to:['a@example.invalid','a@example.invalid','','Display Name'],subject:'Subject'},inputs:{'report-text':body}};
 check('draft assembly preserves body bytes, recipient names and real header line breaks',()=>{
  const text=runtime.execute(context),[headers,payload]=[text.slice(0,text.indexOf('\n\n')),text.slice(text.indexOf('\n\n')+2)];
  assert.equal(payload,body);assert.equal(headers.split('\n').length,3);
  assert.equal(headers.split('a@example.invalid').length-1,1);assert.ok(headers.includes('Display Name'));assert.ok(headers.includes(context.params.subject));
  runtime.validate({...context,value:text});
  for(const value of [text.replace(/\n/g,'\\n'),text.replace('12 tasks','11 tasks'),text.replace('a@example.invalid','other@example.invalid')])assert.throws(()=>runtime.validate({...context,value}));
  for(const params of [{to:[],subject:'Subject'},{to:'a',subject:'bad\nheader'},{to:['a',123],subject:'Subject'}])assert.throws(()=>runtime.execute({...context,params}));
 });
 check('invalid draft save preserves the pending attempt and execute finishes that same attempt',()=>{
  const {output}=journal.start(tmp,{process:'example',mode:'local',inputText:body,params:{to:'a@example.invalid',subject:'Subject'}});
  let card=journal.operation(tmp,'begin',{output,step:'edit'});journal.operation(tmp,'save',{...card.save,content:body});
  assert.equal(journal.operation(tmp,'next',{output}).operation,'execute');
  card=journal.operation(tmp,'begin',{output,step:'draft'});const id=card.pending.id;
  const stateFile=path.join(tmp,'outputs',output,'.run/state.json'),before=fs.readFileSync(stateFile);
  const value=runtime.execute({params:{to:'a@example.invalid',subject:'Subject'},inputs:{'report-text':body}});
  assert.throws(()=>journal.operation(tmp,'save',{...card.save,content:value.replace(/\n/g,'\\n')}));
  assert.deepEqual(fs.readFileSync(stateFile),before);
  journal.execute(tmp,{output,step:'draft',attemptId:id});journal.operation(tmp,'finish',{output,resultName:'letter.md'});
  assert.equal(fs.readFileSync(path.join(tmp,'outputs',output,'letter.md'),'utf8'),value);
  const trace=fs.readFileSync(path.join(tmp,'outputs',output,'.run/trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(trace.filter(e=>e.type==='step_started'&&e.id===id).length,1);assert.equal(trace.filter(e=>e.type==='step_completed'&&e.id===id).length,1);
 });
}finally{c.close();}

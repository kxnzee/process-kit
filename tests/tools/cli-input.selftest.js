'use strict';
const c=require('../fixture')({prefix:"rk cli ввод ' "}),{tmp,source,fs,path,write,assert,check}=c;
const {spawnSync,execFileSync}=require('node:child_process'),crypto=require('node:crypto');
const call=(args,input='')=>spawnSync(process.execPath,[path.join(source,'tools/kit.js'),...args],{cwd:tmp,input,encoding:'utf8'});
const ok=(args,input)=>{const r=call(args,input);assert.equal(r.status,0,r.stderr||r.stdout);return JSON.parse(r.stdout);};
const stdin=(args,spec)=>ok([...args,'--stdin'],JSON.stringify(spec));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const text='O\'Reilly — 12 задач TEST-12.\nКавычки "да", слэш \\, $(literal) и `literal`.';
let output,begun,unkeyedOutput;
try{
 execFileSync('git',['init','-b','master'],{cwd:tmp,stdio:'pipe'});
 check('stdin and scalar flags run the existing lifecycle without temporary spec files',()=>{
  const started=stdin(['run','start'],{process:'example',mode:'local',inputText:text,params:{to:'test@example.invalid',subject:'Итоги "O\'Reilly"'},idempotencyKey:'cli-input'});output=started.output;
  for(const value of [output,'outputs/'+output+'/','outputs\\'+output+'\\'])assert.equal(ok(['run','next','--output',value]).operation,'begin');
  begun=ok(['run','begin','--output',output,'--step','edit']);assert.ok(begun.save.attemptId);
  const state=path.join(tmp,'outputs',output,'.run/state.json'),before=digest(state);
  const wrong=call(['run','save','--stdin'],JSON.stringify({...begun.save,attemptId:'wrong',content:text}));assert.equal(wrong.status,1);assert.equal(digest(state),before);
  stdin(['run','save'],{...begun.save,content:text});
  ok(['run','execute','--output',output,'--step','draft']);
  const result=ok(['run','finish','--output',output,'--result-name','письмо.md']);assert.equal(result.status,'completed');assert.ok(fs.readFileSync(result.resultFile,'utf8').endsWith(text));
  assert.ok(!fs.readdirSync(tmp).some(name=>name.endsWith('.json')));
 });
 check('legacy spec files remain readable and are never removed by the CLI',()=>{
  write('legacy.json',JSON.stringify({output}));const legacy=ok(['run','next','legacy.json','--full']);
  assert.equal(legacy.operation,'done');assert.ok(fs.existsSync(path.join(tmp,'legacy.json')));
  write('[legacy].json',JSON.stringify({output}));assert.equal(ok(['run','next','[legacy].json']).operation,'done');
 });
 check('malformed inputs fail safely and leave an existing run unchanged',()=>{
  const state=path.join(tmp,'outputs',output,'.run/state.json'),before=digest(state);
  for(const [args,input,code]of [
   [['run','next','missing.json'],'','SPEC_FILE_NOT_FOUND'],
   [['run','next','[missing].json'],'','SPEC_FILE_NOT_FOUND'],
   [['run','next','{missing}.json'],'','SPEC_FILE_NOT_FOUND'],
   [['run','next','{"private":"PRIVATE_SENTINEL"}'],'','SPEC_ARGUMENT'],
   [['run','next','--stdin'],'{"private":"PRIVATE_SENTINEL"','SPEC_JSON'],
   [['run','next','--stdin'],'null','SPEC_OBJECT'],
   [['run','next','--stdin'],'[]','SPEC_OBJECT'],
   [['run','next','--output',output,'--output',output],'','SPEC_DUPLICATE'],
   [['run','next','--output','outputs/../outside'],'','Неверный output'],
   [['run','next','--output',path.join(tmp,'outputs',output)],'','Неверный output'],
  ]){const r=call(args,input);assert.equal(r.status,1);assert.ok(r.stderr.includes(code),r.stderr);assert.ok(!r.stderr.includes('PRIVATE_SENTINEL'));assert.equal(digest(state),before);}
  for(const args of [['run','next','--output'],['run','next','legacy.json','--output',output],['run','next','--stdin','--output',output],['run','next','--unknown','value'],['run','next','legacy.json','--full','--full']])assert.equal(call(args).status,1);
 });
 check('definition scalar flags preserve validation, test coverage and publication admission',()=>{
  assert.equal(ok(['definition','inspect','--process','example','--level','master']).definition.status,'parsed');
  write('processes/cli-input-test/PROCESS.md',fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8').replace('name: example','name: cli-input-test'));
  const params={to:'test@example.invalid',subject:'CLI'};
  stdin(['definition','validate'],{process:'cli-input-test',mode:'local',params});
  assert.equal(call(['definition','publish','--process','cli-input-test']).status,1);
  const started=stdin(['run','start'],{process:'cli-input-test',mode:'local',definitionTest:true,inputText:text,params});
  const b=ok(['run','begin','--output',started.output,'--step','edit']);stdin(['run','save'],{...b.save,content:text});ok(['run','execute','--output',started.output,'--step','draft']);ok(['run','finish','--output',started.output,'--result-name','письмо.md']);
  assert.equal(ok(['definition','test','--process','cli-input-test','--output',started.output]).status,'tested');
  assert.equal(ok(['definition','publish','--process','cli-input-test']).status,'published');
  const normal=stdin(['run','start'],{process:'cli-input-test',mode:'local',inputText:text,params});assert.equal(normal.state.status,'running');unkeyedOutput=normal.output;
 });
 check('stdin preserves direct local action values and ownership checks',()=>{
  const spec={action:'edit-text',inputText:text,value:text};assert.equal(stdin(['action'],spec).value,text);
  write('action.json',JSON.stringify(spec));assert.equal(ok(['action','action.json']).value,text);
  for(const args of [['action'],['definition','validate'],['run','start']]){
   const denied=call([...args,'--stdin'],JSON.stringify({action:'my-hidden',process:'my-hidden',level:'my',mode:'local'}));
   assert.equal(denied.status,1);assert.match(denied.stderr,/владения/);
  }
  const r=stdin(['run','diagnose'],{output:'outputs/'+output+'/'});assert.ok(fs.existsSync(r.reportFile));
 });
 check('keyed start control files are accepted while corruption and unknown files stay visible',()=>{
  const validate=()=>ok(['check','--only','outputs','--json']);
  assert.ok(!validate().issues.some(row=>row.file.endsWith('/start-request.json')));
  const unbound=`outputs/${unkeyedOutput}/.run/start-request.json`;write(unbound,'{}');
  assert.ok(validate().issues.some(row=>row.file===unbound));fs.unlinkSync(path.join(tmp,unbound));
  const dir=path.join(tmp,'outputs',output,'.run');write(path.relative(tmp,path.join(dir,'unexpected.json')),'{}');
  assert.ok(validate().issues.some(row=>row.file.endsWith('/unexpected.json')));
  const summary=path.join(tmp,'outputs',output,'итог.md'),original=fs.readFileSync(summary,'utf8');
  fs.writeFileSync(summary,original.replace(/^Чем закончилось:.*$/m,'Чем закончилось: выполняется'));
  assert.equal(call(['check','--only','outputs','--json']).status,1);fs.writeFileSync(summary,original);
  const request=path.join(dir,'start-request.json');fs.appendFileSync(request,' ');
  const failed=call(['check','--only','outputs','--json']);assert.equal(failed.status,1);assert.ok(JSON.parse(failed.stdout).issues.some(row=>row.msg.includes('Изменён сохранённый запрос start')));
 });
}finally{c.close();}

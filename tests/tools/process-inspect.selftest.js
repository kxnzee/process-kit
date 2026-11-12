'use strict';
const ctx=require('../fixture')({prefix:'pk inspect пробелы '}),{fs,path,assert,tmp,write,check}=ctx;
const {execFileSync,spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {lifecycle}=require('../../tools/lib/entities/process-release');
const inspect=(process='inspect-test',options={})=>lifecycle(tmp,'inspect',{process,level:'master',...options});
const git=(...args)=>execFileSync('git',args,{cwd:tmp,stdio:'ignore'});
const proc=(name,extra='',steps='### edit\n- действие: edit-text\n- артефакт: text\n- следующий: end')=>write(`processes/${name}/PROCESS.md`,`---\nname: ${name}\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: Inspect fixture\nexample: Inspect it\nentry: edit\n${extra}---\n## Шаги\n${steps}\n`);
const issue=(result,code)=>result.issues.some(item=>item.code===code);
const digest=file=>createHash('sha256').update(fs.readFileSync(path.join(tmp,file))).digest('hex');
const receipt=(name,extra={})=>{const file=`processes/${name}/PROCESS.md`;write(`processes/${name}/publication.json`,JSON.stringify({schemaVersion:1,process:name,status:'validated',files:{[file]:digest(file)},...extra}));};
function snapshot(dir=tmp){
 return Object.fromEntries(fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(item=>{
  const full=path.join(dir,item.name);return item.isDirectory()?Object.entries(snapshot(full)): [[path.relative(tmp,full),createHash('sha256').update(fs.readFileSync(full)).digest('hex')]];
 }));
}
try{
 git('init');git('symbolic-ref','HEAD','refs/heads/master');
 check('shipped definitions keep current publication and config levels do not imply forbidden entity references',()=>{
  for(const name of ['example','info-povod','sdd-stories-report']){
   const facts=inspect(name);assert.equal(facts.definition.status,'parsed');assert.deepEqual(facts.publication,{status:'published',current:true});assert.ok(!issue(facts,'dependency-forbidden'));
  }
  const facts=inspect('info-povod');assert.ok(facts.dependencies.items.some(item=>item.kind==='config'&&item.name==='my'&&item.status==='missing'));
 });
 check('inspect handles missing, unclosed, malformed and metadata-only definitions without lifecycle validation',()=>{
  assert.equal(inspect('not-created').definition.status,'missing');
  for(const text of ['---\nname: inspect-test\n','---\nname: inspect-test\nname: duplicated\n---\n','---\nname: inspect-test\n---\n','unfinished body']){
   write('processes/inspect-test/PROCESS.md',text);const facts=inspect();assert.equal(facts.definition.status,'partial');assert.ok(facts.issues.length);assert.equal(facts.publication.status,'draft');
  }
  proc('inspect-test');const facts=inspect();assert.equal(facts.definition.status,'parsed');assert.deepEqual(facts.issues,[]);assert.equal(facts.dependencies.coverage,'static-only');assert.equal(facts.ready,undefined);assert.equal(facts.next,undefined);
  assert.throws(()=>lifecycle(tmp,'status',{process:'not-created'}));
 });
 check('inspect rejects invalid version/status values statically, including in subprocesses',()=>{
  for(const [field,value,code]of [['version','invalid','metadata-invalid-version'],['version','1.2','metadata-invalid-version'],['version','1.2.3-beta','metadata-invalid-version'],['status','неизвестно','metadata-invalid-status']]){
   proc('inspect-test');const file=path.join(tmp,'processes/inspect-test/PROCESS.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(field+': '+(field==='version'?'1.0.0':'действует'),field+': '+value));
   const facts=inspect();assert.equal(facts.definition.status,'partial');assert.ok(issue(facts,code));assert.throws(()=>lifecycle(tmp,'status',{process:'inspect-test'}));
  }
  proc('inspect-child');const child=path.join(tmp,'processes/inspect-child/PROCESS.md');fs.writeFileSync(child,fs.readFileSync(child,'utf8').replace('version: 1.0.0','version: invalid'));
  proc('inspect-test','','### edit\n- процесс: inspect-child\n- следующий: end');assert.ok(inspect().issues.some(item=>item.code==='metadata-invalid-version'&&item.file==='processes/inspect-child/PROCESS.md'));
  proc('inspect-test');const file=path.join(tmp,'processes/inspect-test/PROCESS.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('status: действует','status: устарел').replace('version: 1.0.0','version: 12.0.30'));
  assert.equal(inspect().definition.status,'parsed');assert.deepEqual(inspect().issues,[]);
 });
 check('inspect CLI executes no owner code and leaves all repository bytes unchanged',()=>{
  const poison=`require('node:fs').writeFileSync(${JSON.stringify(path.join(tmp,'SIDE_EFFECT'))},'executed');throw new Error('PRIVATE_EXECUTION_ERROR');`;
  proc('inspect-test','branchRule: rules/poison.js\nparams:\n  rendererFile: processes/inspect-test/renderer.js\n');
  write('processes/inspect-test/rules/poison.js',poison);write('processes/inspect-test/renderer.js',poison);
  write('processes/inspect-test/index.js',poison);write('processes/inspect-test/package.json','{"main":"index.js"}');
  write('actions/edit-text/runtime.js',poison);write('tools/inspect-sentinel.js',poison);
  const action=path.join(tmp,'actions/edit-text/ACTION.md');fs.writeFileSync(action,fs.readFileSync(action,'utf8').replace('requiresFiles: [tools/lib/actions/action-support.js]','requiresFiles: [tools/inspect-sentinel.js]'));
  write('adapters/inspect-sentinel.json','PRIVATE_ADAPTER_NOT_TO_READ');
  receipt('inspect-test');write('inspect-spec.json',JSON.stringify({process:'inspect-test',level:'master'}));
  const before=snapshot();
  const result=spawnSync(process.execPath,['tools/kit.js','definition','inspect','inspect-spec.json'],{cwd:tmp,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const facts=JSON.parse(result.stdout);assert.deepEqual(facts.issues,[]);assert.equal(facts.publication.status,'validated');assert.ok(!result.stdout.includes('PRIVATE_'));
  assert.deepEqual(snapshot(),before);assert.equal(fs.existsSync(path.join(tmp,'SIDE_EFFECT')),false);
  const original=fs.readFileSync,attempts=[],mutations=[],writes=['writeFileSync','appendFileSync','mkdirSync','renameSync','unlinkSync','rmSync'],saved=Object.fromEntries(writes.map(key=>[key,fs[key]]));
  try{
   fs.readFileSync=function(file,...args){if(/[/\\]adapters[/\\]/.test(String(file)))attempts.push(String(file));return original.call(this,file,...args);};
   for(const key of writes)fs[key]=()=>{mutations.push(key);throw new Error('Unexpected mutation');};
   assert.equal(inspect().definition.status,'parsed');assert.deepEqual(attempts,[]);assert.deepEqual(mutations,[]);
  }finally{fs.readFileSync=original;Object.assign(fs,saved);}
 });
 check('legacy status retains deep validation and branchRule code loading',()=>{
  // A compatible definition still loads its branchRule, unlike inspect. No external effects.
  const original=fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8');
  write('processes/status-compat/PROCESS.md',original.replace('name: example','name: status-compat').replace('publication: required','publication: required\nbranchRule: rules/compat.js'));
  write('processes/status-compat/rules/compat.js',`require('node:fs').writeFileSync(${JSON.stringify(path.join(tmp,'STATUS_LOADED'))},'loaded');exports.choose=()=>({target:'end',reason:'test'});`);
  // Restore the Action poisoned by the previous negative test.
  fs.copyFileSync(path.join(ctx.source,'actions/edit-text/runtime.js'),path.join(tmp,'actions/edit-text/runtime.js'));
  assert.equal(inspect('status-compat').definition.status,'parsed');assert.equal(fs.existsSync(path.join(tmp,'STATUS_LOADED')),false);
  const status=lifecycle(tmp,'status',{process:'status-compat'});assert.deepEqual(status,{process:'status-compat',status:'draft',policy:'required',scope:null});assert.equal(fs.readFileSync(path.join(tmp,'STATUS_LOADED'),'utf8'),'loaded');
 });
 check('static dependency facts cover missing declarations, resources, subprocesses and cycles',()=>{
  proc('inspect-child');proc('inspect-test','branchRule: rules/absent.js\n','### edit\n- процесс: inspect-child\n- следующий: end');
  let facts=inspect();assert.ok(facts.dependencies.items.some(item=>item.name==='inspect-child'&&item.status==='present'));assert.ok(issue(facts,'dependency-missing'));
  fs.rmSync(path.join(tmp,'processes/inspect-child/PROCESS.md'));facts=inspect();assert.ok(facts.dependencies.items.some(item=>item.name==='inspect-child'&&item.status==='missing'));
  proc('inspect-child','','### edit\n- процесс: inspect-test\n- следующий: end');assert.ok(issue(inspect(),'dependency-cycle'));
  proc('inspect-test');const file=path.join(tmp,'processes/inspect-test/PROCESS.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('actions: [edit-text]','actions: []'));
  assert.ok(issue(inspect(),'dependency-undeclared'));
  write('actions/edit-text/contracts/inspect.json','{}');const action=path.join(tmp,'actions/edit-text/ACTION.md');fs.writeFileSync(action,fs.readFileSync(action,'utf8').replace('report-text: text','report-text: contracts/missing.json'));
  assert.ok(inspect().dependencies.items.some(item=>item.file==='actions/edit-text/contracts/missing.json'&&item.status==='missing'));
 });
 check('ownership is checked before metadata, subprocess, action or receipt-file reads',()=>{
  const my={schemaVersion:2,teamId:'a',profile:{name:'PRIVATE',email:'private@example.invalid'},storage:{mode:'local'},taskStores:[],codeStores:[],defaults:{},preferences:{}};
  write('config/my/config.json',JSON.stringify(my));write('config/team/config.json',JSON.stringify({schemaVersion:2,team:{id:'a',name:'A',owners:[]},taskStores:[],codeStores:[],defaults:{}}));
  for(const name of ['my-private','team-a-private','team-b-private'])proc(name);
  proc('inspect-test','','### edit\n- процесс: my-private\n- следующий: other\n### other\n- действие: team-b-private\n- артефакт: text\n- следующий: end');
  write('actions/team-b-private/ACTION.md','PRIVATE_FOREIGN_ACTION');
  receipt('inspect-test',{files:{'processes/inspect-test/PROCESS.md':digest('processes/inspect-test/PROCESS.md'),'processes/my-private/PROCESS.md':digest('processes/my-private/PROCESS.md')}});
  const original=fs.readFileSync,attempts=[];
  try{
   fs.readFileSync=function(file,...args){if(/[/\\](?:my-private|team-b-private)[/\\]/.test(String(file)))attempts.push(String(file));return original.call(this,file,...args);};
   const facts=inspect();assert.ok(issue(facts,'dependency-forbidden'));assert.equal(facts.publication.status,'unknown');assert.equal(inspect('my-private').definition.status,'unavailable');
   assert.equal(inspect('team-b-private',{level:'team',team:'a'}).definition.status,'unavailable');assert.deepEqual(attempts,[]);
  }finally{fs.readFileSync=original;}
  assert.equal(inspect('my-private',{level:'my'}).definition.status,'parsed');
  assert.equal(inspect('team-a-private',{level:'my'}).definition.status,'parsed');
  assert.equal(inspect('my-private',{level:'team',team:'a'}).definition.status,'unavailable');
  assert.ok(issue(inspect('my-private',{level:'team',team:'b'}),'scope-unavailable'));
 });
 check('receipt facts distinguish absent, current, copied, stale and corrupt evidence without claiming readiness',()=>{
  proc('inspect-test');fs.rmSync(path.join(tmp,'processes/inspect-test/publication.json'));
  assert.deepEqual(inspect().publication,{status:'draft',current:false});
  for(const status of ['validated','tested','published']){
   receipt('inspect-test',{status,...(status==='validated'?{}:{scope:'local/demo',outputs:['synthetic-inspect-only']})});assert.deepEqual(inspect().publication,{status,current:true});
  }
  // Matching hashes say nothing about missing dependencies or completion of a new edit request.
  proc('inspect-test','','### edit\n- действие: absent-action\n- артефакт: result\n- следующий: end');receipt('inspect-test');
  let facts=inspect();assert.equal(facts.publication.status,'validated');assert.ok(issue(facts,'dependency-missing'));assert.equal(facts.ready,undefined);
  fs.appendFileSync(path.join(tmp,'processes/inspect-test/PROCESS.md'),'\nChanged');assert.equal(inspect().publication.status,'stale');
  receipt('inspect-test',{process:'example'});assert.equal(inspect().publication.status,'unknown');
  for(const patch of [{files:{}},{files:[]},{files:{'processes/inspect-test/PROCESS.md':[digest('processes/inspect-test/PROCESS.md')]}},{status:'published',scope:'local/demo',outputs:[{}]},{status:'published',scope:'live',outputs:['fixture']}]){
   receipt('inspect-test',patch);assert.equal(inspect().publication.status,'unknown');
  }
  receipt('inspect-test');fs.rmSync(path.join(tmp,'processes/inspect-test/PROCESS.md'));assert.equal(inspect().publication.status,'stale');proc('inspect-test');
  write('processes/inspect-test/publication.json','PRIVATE_INVALID_RECEIPT');facts=inspect();assert.equal(facts.publication.status,'unknown');assert.ok(!JSON.stringify(facts).includes('PRIVATE_INVALID_RECEIPT'));
  receipt('inspect-test',{files:{'processes/inspect-test/PROCESS.md':digest('processes/inspect-test/PROCESS.md'),'processes/../config/my/config.json':'0'.repeat(64)}});assert.equal(inspect().publication.status,'unknown');
 });
 check('symlinks and escaping paths are never followed, and invalid inspect options fail',()=>{
  for(const spec of [null,{},[],{process:'../example'},{process:42},{process:'example',params:{}},{process:'example',level:'bad'},{process:'example',team:'a'}])assert.throws(()=>lifecycle(tmp,'inspect',spec));
  write('PRIVATE_SPEC.json','{"process": PRIVATE_INVALID_SPEC}');
  for(const file of ['PRIVATE_SPEC.json','PRIVATE_MISSING_SPEC.json']){
   const failed=spawnSync(process.execPath,['tools/kit.js','definition','inspect',file],{cwd:tmp,encoding:'utf8'});
   assert.notEqual(failed.status,0);assert.equal(failed.stdout,'');assert.ok(!failed.stderr.includes('PRIVATE_'));assert.ok(!failed.stderr.includes(tmp));
  }
  proc('inspect-test','branchRule: ../outside.js\n');assert.ok(issue(inspect(),'dependency-invalid'));
  if(process.platform!=='win32'){
   fs.symlinkSync(path.join(tmp,'processes/example'),path.join(tmp,'processes/inspect-link'),'dir');assert.equal(inspect('inspect-link').definition.status,'unavailable');
   const target=path.join(tmp,'processes/inspect-test/rules/link.js');fs.symlinkSync(path.join(tmp,'processes/example/PROCESS.md'),target);
   proc('inspect-test','branchRule: rules/link.js\n');assert.ok(inspect().dependencies.items.some(item=>item.file.endsWith('/link.js')&&item.status==='unavailable'));
  }
 });
}finally{ctx.close();}

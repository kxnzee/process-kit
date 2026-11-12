'use strict';
const ctx=require('../fixture')({prefix:'pk process catalog пробелы '}),{fs,path,assert,tmp,write,check}=ctx;
const {execFileSync,spawnSync}=require('node:child_process'),{catalog}=require('../../tools/lib/entities/process-catalog');
const git=(...args)=>execFileSync('git',args,{cwd:tmp,stdio:['ignore','pipe','pipe'],encoding:'utf8'});
const processFile=(name,extra='')=>write(`processes/${name}/PROCESS.md`,`---\nname: ${name}\ntitle: Title ${name}\ndescription: Description ${name}\nstatus: действует\nexample: Request ${name}\n${extra}---\nPRIVATE_BODY\n`);
const my={schemaVersion:2,teamId:'a',profile:{name:'PRIVATE_PROFILE',email:'private@example.invalid'},storage:{mode:'local'},taskStores:[],codeStores:[],defaults:{},preferences:{}};
const team={schemaVersion:2,team:{id:'a',name:'PRIVATE_TEAM',owners:[]},taskStores:[],codeStores:[],defaults:{}};
const call=args=>spawnSync(process.execPath,['tools/kit.js','processes',...args],{cwd:tmp,encoding:'utf8'});
try{
 git('init');git('symbolic-ref','HEAD','refs/heads/master');
 check('catalog lists metadata without bodies, does not execute definitions, and changes with files',()=>{
  processFile('catalog-sentinel','branchRule: rules/throw.js\n');
  write('processes/catalog-sentinel/rules/throw.js','throw new Error("DEFINITION_EXECUTED");');
  const actionFile=path.join(tmp,'actions/edit-text/runtime.js');
  fs.appendFileSync(actionFile,'\nthrow new Error("ACTION_EXECUTED");\n');
  const before=fs.readFileSync(actionFile,'utf8');
  const result=catalog(tmp);assert.equal(result.complete,true);assert.equal(result.scope.level,'master');
  const row=result.processes.find(p=>p.name==='catalog-sentinel');assert.equal(row.title,'Title catalog-sentinel');assert.deepEqual(row.examples,['Request catalog-sentinel']);assert.equal(row.publication.status,'draft');
  assert.ok(result.processes.find(p=>p.name==='example').educational);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_BODY'));assert.equal(fs.readFileSync(actionFile,'utf8'),before);
  processFile('catalog-sentinel','examples: [One, Two]\n');assert.deepEqual(catalog(tmp).processes.find(p=>p.name==='catalog-sentinel').examples,['One','Two']);
  // Full discovery is not route validation or authority to start this metadata-only fixture.
  assert.throws(()=>require('../../tools/lib/entities/process-definition').validateDefinition(tmp,'catalog-sentinel'));
 });
 check('CRLF, safe partial metadata errors and fatal root failure have distinct results',()=>{
  const before=catalog(tmp),file=path.join(tmp,'processes/catalog-sentinel/PROCESS.md');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/\r?\n/g,'\r\n'));assert.deepEqual(catalog(tmp),before);
  write('processes/broken/PROCESS.md','---\nname: another\ndescription: PRIVATE_ERROR_DATA\n---\nPRIVATE_BODY');
  const result=call([]);assert.equal(result.status,0,result.stderr);const rows=JSON.parse(result.stdout);
  assert.equal(rows.complete,false);assert.ok(rows.processes.some(p=>p.name==='example'));assert.ok(rows.issues.some(p=>p.code==='metadata-unavailable'));assert.ok(!result.stdout.includes('PRIVATE_ERROR_DATA'));
  fs.rmSync(path.join(tmp,'processes/broken'),{recursive:true});
  fs.renameSync(path.join(tmp,'processes'),path.join(tmp,'hidden-processes'));
  try{const failed=call([]);assert.notEqual(failed.status,0);assert.equal(failed.stdout,'');assert.ok(!failed.stderr.includes(tmp));}finally{fs.renameSync(path.join(tmp,'hidden-processes'),path.join(tmp,'processes'));}
 });
 check('scope filters before reading foreign metadata and requires confirmed personal/team configuration',()=>{
  for(const name of ['my-private','team-a-private','team-b-private'])processFile(name);
  write('config/my/config.json',JSON.stringify(my));write('config/team/config.json',JSON.stringify(team));
  let rows=catalog(tmp);assert.ok(!rows.processes.some(p=>p.level!=='master'));assert.ok(!JSON.stringify(rows).includes('PRIVATE_PROFILE'));
  git('symbolic-ref','HEAD','refs/heads/my');rows=catalog(tmp);assert.equal(rows.complete,true);assert.ok(rows.processes.some(p=>p.name==='my-private'));assert.ok(rows.processes.some(p=>p.name==='team-a-private'));assert.ok(!rows.processes.some(p=>p.name==='team-b-private'));
  write('processes/team-b-private/PROCESS.md','PRIVATE_FOREIGN_CORRUPTION');assert.equal(catalog(tmp).complete,true);
  write('config/my/config.json',JSON.stringify({...my,teamId:null}));rows=catalog(tmp);assert.ok(rows.processes.some(p=>p.name==='my-private'));assert.ok(!rows.processes.some(p=>p.level==='team'));
  write('config/my/config.json',JSON.stringify({...my,teamId:'b'}));rows=catalog(tmp);assert.equal(rows.complete,false);assert.ok(rows.processes.every(p=>p.level==='master'));assert.deepEqual(rows.issues,[{code:'scope-unavailable'}]);
  write('config/my/config.json',JSON.stringify(my));git('symbolic-ref','HEAD','refs/heads/team-a');rows=catalog(tmp);assert.ok(rows.processes.some(p=>p.name==='team-a-private'));assert.ok(!rows.processes.some(p=>p.level==='my'));
  git('symbolic-ref','HEAD','refs/heads/promote/team-a/review');assert.equal(catalog(tmp).scope.teamId,'a');
  git('symbolic-ref','HEAD','refs/heads/feature');rows=catalog(tmp);assert.equal(rows.complete,false);assert.ok(rows.processes.every(p=>p.level==='master'));
  rows=catalog(tmp,{level:'team',team:'a'});assert.equal(rows.complete,true);assert.ok(rows.processes.some(p=>p.name==='team-a-private'));
  rows=catalog(tmp,{level:'team',team:'b'});assert.equal(rows.complete,false);assert.ok(rows.processes.every(p=>p.level==='master'));
  git('symbolic-ref','HEAD','refs/heads/master');
 });
 check('publication facts distinguish absent, validated, stale and broken receipts without running dependencies',()=>{
  const file=path.join(tmp,'processes/catalog-sentinel/PROCESS.md'),receipt='processes/catalog-sentinel/publication.json';
  const value={schemaVersion:1,process:'catalog-sentinel',status:'validated',files:{'processes/catalog-sentinel/PROCESS.md':require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')}};
  write(receipt,JSON.stringify(value));assert.deepEqual(catalog(tmp).processes.find(p=>p.name==='catalog-sentinel').publication,{status:'validated',current:true});
  value.status='published';value.scope='local/demo';value.outputs=['synthetic-catalog-only'];write(receipt,JSON.stringify(value));assert.equal(catalog(tmp).processes.find(p=>p.name==='catalog-sentinel').publication.status,'published');
  fs.appendFileSync(file,'\nChanged');assert.equal(catalog(tmp).processes.find(p=>p.name==='catalog-sentinel').publication.status,'stale');
  write(receipt,'PRIVATE_INVALID_JSON');const rows=catalog(tmp);assert.equal(rows.complete,false);assert.equal(rows.processes.find(p=>p.name==='catalog-sentinel').publication.status,'unknown');assert.ok(!JSON.stringify(rows).includes('PRIVATE_INVALID_JSON'));
  fs.rmSync(path.join(tmp,receipt));
 });
 check('malformed foreign names are filtered before they can make the visible catalog incomplete',()=>{
  for(const name of ['team-b-private_bad','my-private_bad'])fs.mkdirSync(path.join(tmp,'processes',name));
  try{
   assert.equal(catalog(tmp).complete,true);
   git('symbolic-ref','HEAD','refs/heads/team-a');assert.equal(catalog(tmp).complete,true);
   git('symbolic-ref','HEAD','refs/heads/my');const own=catalog(tmp);assert.equal(own.complete,false);assert.deepEqual(own.issues,[{code:'invalid-entry'}]);
   fs.rmdirSync(path.join(tmp,'processes/my-private_bad'));assert.equal(catalog(tmp).complete,true);
  }finally{
   for(const name of ['team-b-private_bad','my-private_bad'])fs.rmSync(path.join(tmp,'processes',name),{recursive:true,force:true});
   git('symbolic-ref','HEAD','refs/heads/master');
  }
 });
 check('structurally broken receipts are unknown, while changed bytes alone are stale',()=>{
  const file='processes/catalog-sentinel/PROCESS.md',receipt='processes/catalog-sentinel/publication.json';
  const value={schemaVersion:1,process:'catalog-sentinel',status:'published',scope:'local/demo',outputs:['catalog-only'],files:{[file]:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(tmp,file))).digest('hex')}};
  try{
   for(const patch of [{files:undefined},{files:{}},{files:[]},{files:{[file]:'invalid-digest'}},{outputs:undefined},{outputs:[]},{scope:'live'}]){
    write(receipt,JSON.stringify({...value,...patch}));const rows=catalog(tmp);
    assert.equal(rows.complete,false);assert.deepEqual(rows.processes.find(p=>p.name==='catalog-sentinel').publication,{status:'unknown',current:false});
    assert.deepEqual(rows.issues,[{code:'publication-unavailable',file:receipt}]);
   }
   write(receipt,JSON.stringify(value));assert.equal(catalog(tmp).complete,true);
   fs.appendFileSync(path.join(tmp,file),'\nChanged again');const rows=catalog(tmp);assert.equal(rows.complete,true);assert.equal(rows.processes.find(p=>p.name==='catalog-sentinel').publication.status,'stale');
  }finally{fs.rmSync(path.join(tmp,receipt));}
 });
 check('unsupported or incomplete promotion branch names do not imply personal or common scope',()=>{
  try{
   for(const branch of ['promote/my/review','promote/master','promote/team-a','promote/unknown/review']){
    git('symbolic-ref','HEAD','refs/heads/'+branch);const rows=catalog(tmp);
    assert.equal(rows.scope.level,null);assert.equal(rows.complete,false);assert.ok(rows.processes.every(p=>p.level==='master'));assert.deepEqual(rows.issues,[{code:'scope-unknown'}]);
   }
  }finally{git('symbolic-ref','HEAD','refs/heads/master');}
 });
 check('symlinks are not followed and CLI arguments cannot substitute a root or unconfirmed scope',()=>{
  if(process.platform!=='win32'){
   const folder=path.join(tmp,'processes/catalog-link');fs.symlinkSync(path.join(tmp,'processes/example'),folder,'dir');
   try{const rows=catalog(tmp);assert.equal(rows.complete,false);assert.ok(!rows.processes.some(p=>p.name==='catalog-link'));}finally{fs.unlinkSync(folder);}
  }
  for(const args of [['unexpected'],['--root',tmp],['--level'],['--level','bad'],['--team','a'],['--level','team','--team','../a'],['--level','master','--level','my']]){const result=call(args);assert.notEqual(result.status,0);assert.equal(result.stdout,'');}
  const result=call(['--level','master']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).scope.level,'master');
 });
}finally{ctx.close();}

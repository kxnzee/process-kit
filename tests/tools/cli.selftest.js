'use strict';
const ctx=require('../fixture')({prefix:'pk windows проверка '}),{fs,path,assert,tmp,source,write,check}=ctx;
const {spawnSync,execFileSync}=require('node:child_process'),{commands}=require('../../tools/kit');
const call=(args,cwd=tmp)=>spawnSync(process.execPath,[path.join(source,'tools/kit.js'),...args],{cwd,encoding:'utf8'});
try{
 check('public CLI has a machine-readable catalog and rejects unknown commands',()=>{
  const result=call(['--json']);assert.equal(result.status,0,result.stderr);
  const catalog=JSON.parse(result.stdout);assert.deepEqual(Object.keys(catalog),Object.keys(commands));
  assert.ok(catalog.definition.usage.includes('inspect'));assert.ok(catalog.definition.purpose.includes('status'));
  const help=call(['--help']);assert.equal(help.status,0,help.stderr);
  assert.ok(catalog.definition.scopeNote.includes('inspect: read-only'));assert.ok(help.stdout.includes(catalog.definition.scopeNote));assert.equal(catalog.definition.scope,'local-write');
  for(const flag of ['--process','--demo','--params','--json','--level','--team','--only','--root']){assert.ok(catalog.check.usage.includes(flag),flag+' missing from check metadata');assert.ok(help.stdout.includes(flag),flag+' missing from CLI help');}
  for(const item of Object.values(catalog)){assert.ok(item.purpose);assert.ok(item.scope);assert.equal(item.file,undefined);}
  for(const command of Object.values(commands))assert.ok(fs.existsSync(path.join(source,'tools',command.file)));
  assert.equal(call(['unknown']).status,2);assert.equal(call(['--help']).status,0);
  const processes=call(['processes','--level','master']);assert.equal(processes.status,0,processes.stderr);assert.ok(JSON.parse(processes.stdout).processes.some(p=>p.name==='example'));
 });
 check('public commands resolve entities, inspect config and complete a local process',()=>{
  execFileSync('git',['init'],{cwd:tmp,stdio:'ignore'});
  write('inspect.json',JSON.stringify({process:'example',level:'master'}));
  const inspected=call(['definition','inspect',path.join(tmp,'inspect.json')]);assert.equal(inspected.status,0,inspected.stderr);assert.equal(JSON.parse(inspected.stdout).definition.status,'parsed');
  assert.equal(call(['check','--root',tmp,'--only','actions']).status,0);
  const master=path.join(tmp,'config/master/config.json');
  assert.ok(fs.existsSync(master),JSON.stringify({tmp,source,entries:fs.readdirSync(tmp),config:fs.existsSync(path.join(tmp,'config'))?fs.readdirSync(path.join(tmp,'config')):null}));
  const config=call(['config','--json']);
  const diagnostics=config.status===0?null:spawnSync(process.execPath,['-e',"const fs=require('node:fs');console.log(JSON.stringify({cwd:process.cwd(),entries:fs.readdirSync('.'),exists:fs.existsSync('config/master/config.json')}))"],{cwd:tmp,encoding:'utf8'});
  assert.equal(config.status,0,JSON.stringify({error:config.error?.message,stderr:config.stderr,stdout:config.stdout,parentMasterExists:fs.existsSync(master),childDiagnostics:diagnostics?.stdout,childError:diagnostics?.stderr}));
  assert.equal(JSON.parse(config.stdout).schemaVersion,2);
  const manifest=call(['entities','example','local']);assert.equal(manifest.status,0,manifest.stderr);assert.equal(JSON.parse(manifest.stdout).ready,true);
  let number=0;
  const run=(command,spec)=>{const file=path.join(tmp,`spec-${number++}.json`);fs.writeFileSync(file,JSON.stringify(spec));const result=call(['run',command,file]);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
  const started=run('start',{process:'example',mode:'local',date:'2026-11-05',inputText:'12 задач.',params:{to:'User',subject:'Status'}}),output=started.output;
  for(const [step,artifact,next]of [['edit','report-text','draft'],['draft','mail-draft','end']]){const begun=run('begin',{output,step});run('save',{attemptId:begun.pending.id,output,step,artifact,next,extension:'md',content:'12 задач.'});}
  const state=run('finish',{output,resultName:'письмо.md'});assert.equal(state.status,'completed');assert.equal(fs.readFileSync(path.join(tmp,'outputs',output,'письмо.md'),'utf8'),'12 задач.');
  const diagnostic=run('diagnose',{output});
  const file=diagnostic.reportFile;assert.ok(fs.existsSync(file));assert.ok(!fs.readFileSync(file,'utf8').includes('12 задач.'));
 });
 check('hook installation points to private modules and the installed commit guard executes',()=>{
  write('.git/hooks/pre-commit','#!/bin/sh\nprintf previous-hook > previous-hook-called\n');
  fs.chmodSync(path.join(tmp,'.git/hooks/pre-commit'),0o755);
  const result=call(['hooks-install']);assert.equal(result.status,0,result.stderr);
  const hook=fs.readFileSync(path.join(tmp,'.git/hooks/pre-commit'),'utf8');assert.ok(hook.includes('tools/lib/git/commit-guard.js'));
  const git=args=>spawnSync('git',args,{cwd:tmp,encoding:'utf8'});
  assert.equal(git(['config','user.name','Test User']).status,0);assert.equal(git(['config','user.email','test@example.invalid']).status,0);
  write('README.md','# Hook test\n');assert.equal(git(['add','README.md']).status,0);
  const commit=git(['-c','commit.gpgsign=false','commit','-m','Test installed hook']);assert.equal(commit.status,0,commit.stderr);
  assert.equal(fs.readFileSync(path.join(tmp,'previous-hook-called'),'utf8'),'previous-hook');
 });
 check('public CLI accepts a literal subject resembling a foreign resource and preserves its value',()=>{
  execFileSync('git',['symbolic-ref','HEAD','refs/heads/master'],{cwd:tmp,stdio:'ignore'});
  const subject='processes/team-b-private/not-a-file.md';
  write('literal-start.json',JSON.stringify({process:'example',mode:'local',inputText:'12 задач.',params:{to:'Test',subject}}));
  const result=call(['run','start','literal-start.json']);assert.equal(result.status,0,result.stderr);
  const started=JSON.parse(result.stdout);assert.equal(started.state.params.subject,subject);
  write('literal-next.json',JSON.stringify({output:started.output}));
  const next=call(['run','next','literal-next.json']);assert.equal(next.status,0,next.stderr);assert.equal(JSON.parse(next.stdout).operation,'begin');
 });
 check('public CLI rejects foreign diagnosis without creating an export',()=>{
  // Only the definition is needed. Avoid native recursive copy in this Unicode fixture.
  write('processes/team-b-private/PROCESS.md',fs.readFileSync(path.join(tmp,'processes/example/PROCESS.md'),'utf8').replace('name: example','name: team-b-private'));
  const started=require('../../tools/lib/runtime/run-journal').start(tmp,{process:'team-b-private',mode:'local',definitionTest:true,inputText:'12 задач.',params:{to:'Test',subject:'Private'}});
  const dir=path.join(tmp,'outputs',started.output),before=fs.readdirSync(dir).sort();
  write('foreign-diagnose.json',JSON.stringify({output:started.output}));
  const result=call(['run','diagnose','foreign-diagnose.json']);assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.match(result.stderr,/владени|недоступ/i);
  assert.deepEqual(fs.readdirSync(dir).sort(),before);
 });
}finally{ctx.close();}

'use strict';
const ctx=require('../fixture')({prefix:'pk windows проверка '}),{fs,path,assert,tmp,source,write,check}=ctx;
const {spawnSync,execFileSync}=require('node:child_process'),{commands}=require('../../tools/kit');
const call=(args,cwd=tmp)=>spawnSync(process.execPath,[path.join(source,'tools/kit.js'),...args],{cwd,encoding:'utf8'});
try{
 check('public CLI has a machine-readable catalog and rejects unknown commands',()=>{
  const result=call(['--json']);assert.equal(result.status,0,result.stderr);
  const catalog=JSON.parse(result.stdout);assert.deepEqual(Object.keys(catalog),Object.keys(commands));
  for(const item of Object.values(catalog)){assert.ok(item.purpose);assert.ok(item.scope);assert.equal(item.file,undefined);}
  for(const command of Object.values(commands))assert.ok(fs.existsSync(path.join(source,'tools',command.file)));
  assert.equal(call(['unknown']).status,2);assert.equal(call(['--help']).status,0);
 });
 check('public commands resolve entities, inspect config and complete a local process',()=>{
  execFileSync('git',['init'],{cwd:tmp,stdio:'ignore'});
  assert.equal(call(['check','--root',tmp,'--only','actions']).status,0);
  assert.equal(JSON.parse(call(['config','--json']).stdout).schemaVersion,2);
  const manifest=call(['entities','example','local']);assert.equal(manifest.status,0,manifest.stderr);assert.equal(JSON.parse(manifest.stdout).ready,true);
  let number=0;
  const run=(command,spec)=>{const file=path.join(tmp,`spec-${number++}.json`);fs.writeFileSync(file,JSON.stringify(spec));const result=call(['run',command,file]);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
  const started=run('start',{process:'example',mode:'local',date:'2026-11-05',inputText:'12 задач.',params:{to:'User',subject:'Status'}}),output=started.output;
  for(const [step,artifact,next]of [['edit','report-text','draft'],['draft','mail-draft','end']]){run('begin',{output,step});run('save',{output,step,artifact,next,extension:'md',content:'12 задач.'});}
  const state=run('finish',{output,resultName:'письмо.md'});assert.equal(state.status,'completed');assert.equal(fs.readFileSync(path.join(tmp,'outputs',output,'письмо.md'),'utf8'),'12 задач.');
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
}finally{ctx.close();}

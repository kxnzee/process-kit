#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync,execFileSync}=require('node:child_process');
const source=path.join(__dirname,'..'),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pk-commit-guard-'));
let count=0;const check=(name,fn)=>{fn();count++;console.log(`✓ ${name}`);},write=(f,t)=>{fs.mkdirSync(path.dirname(path.join(cwd,f)),{recursive:true});fs.writeFileSync(path.join(cwd,f),t);};
const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),commit=()=>spawnSync('git',['commit','-qm','fixture change'],{cwd,encoding:'utf8'}),install=()=>spawnSync(process.execPath,['tools/install-hooks.js'],{cwd,encoding:'utf8'});
try{
 git('init','-q','-b','master');git('config','user.name','Fixture User');git('config','user.email','fixture@example.invalid');
 for(const f of ['tools/commit-guard.js','tools/install-hooks.js','tools/prepush.js','tools/paths.js','.gigacode/hooks/pre-push','.gigacode/hooks/pre-commit'])write(f,fs.readFileSync(path.join(source,f),'utf8'));
 write('plain.txt','clean');git('add','.');git('commit','-qm','base');
 check('installer sets both hooks and remains idempotent',()=>{assert.equal(install().status,0);assert.equal(install().status,0);for(const f of ['pre-push','pre-commit'])assert.ok(fs.statSync(path.join(cwd,'.git/hooks',f)).mode&0o111);});
 const fake='gh'+'p_'+'x'.repeat(30);write('plain.txt',fake);git('add','plain.txt');write('plain.txt','clean workspace');
 check('secret in index is blocked even when workspace is clean',()=>{const r=commit();assert.equal(r.status,1);assert.ok(r.stderr.includes('возможный секрет'));assert.ok(!r.stderr.includes(fake));});
 write('plain.txt','safe staged');git('add','plain.txt');write('plain.txt',fake);
 check('unstaged content is not accidentally included in the commit',()=>{assert.equal(commit().status,0);assert.equal(git('show','HEAD:plain.txt'),'safe staged');});write('plain.txt','safe staged');
 write('.gigacode/settings.json',JSON.stringify({headers:{Authorization:'Bearer $secret:demo/token'}}));git('add','.gigacode/settings.json');
 check('valid references to client secrets are allowed',()=>assert.equal(commit().status,0));
 write('.gigacode/settings.json',JSON.stringify({headers:{Authorization:'plain-value'}}));git('add','.gigacode/settings.json');
 check('literal settings credentials are blocked',()=>assert.equal(commit().status,1));git('restore','--staged','.gigacode/settings.json');git('restore','.gigacode/settings.json');
 write('.env','fake');git('add','.env');check('credential files are blocked',()=>assert.equal(commit().status,1));git('restore','--staged','.env');fs.unlinkSync(path.join(cwd,'.env'));
 write('outputs/2026-11-03_пример/input.txt','private');git('add','outputs');check('local run data cannot be committed',()=>assert.equal(commit().status,1));git('restore','--staged','outputs');fs.rmSync(path.join(cwd,'outputs'),{recursive:true});
 fs.unlinkSync(path.join(cwd,'.git/hooks/pre-commit'));write('.git/hooks/pre-commit','#!/bin/sh\nexit 1\n');fs.chmodSync(path.join(cwd,'.git/hooks/pre-commit'),0o755);
 check('existing user hook is preserved and still enforced',()=>{assert.equal(install().status,0);assert.ok(fs.existsSync(path.join(cwd,'.git/hooks/pre-commit.before-process-kit')));write('plain.txt','changed');git('add','plain.txt');const r=commit();assert.equal(r.status,1);assert.ok(r.stderr.includes('Прежняя'));});
 write('custom-hooks/sentinel','untouched');git('config','--local','core.hooksPath',path.join(cwd,'custom-hooks'));
 check('custom shared hook location is not overwritten',()=>{assert.equal(install().status,1);assert.equal(fs.readFileSync(path.join(cwd,'custom-hooks/sentinel'),'utf8'),'untouched');assert.ok(!fs.existsSync(path.join(cwd,'custom-hooks/pre-commit')));});
 console.log(`Commit guard: ${count} passed.`);
}finally{fs.rmSync(cwd,{recursive:true,force:true});}

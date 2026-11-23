'use strict';
const fixture = require('../fixture');
const ctx = fixture();
const { fs, path, assert, tmp, source, write, check, validate, model, allowedReference, validRunFolderName, parseFrontmatter } = ctx;
try {
  check('рабочие данные не выносятся в общие папки', () => {
    write('.gitignore', 'outputs/\n.history/\n');
    for (const dir of ['fixtures', 'config/fixtures']) {
      write(dir + '/sample.json', '{}');
      try { validate(['--only', 'layout'], false, 'данные должны лежать рядом'); }
      finally { fs.rmSync(path.join(tmp, dir), {recursive:true,force:true}); }
    }
  });
  check('demo never silently replaces an explicitly supplied period', () => {
    const {effectiveParams}=require('../../tools/lib/runtime/run-journal');
    write('processes/my-demo/fixture.json',JSON.stringify({result:{meta:{window:'01.01.2026 — 20.01.2026'}}}));
    const base={mode:'demo',date:'2026-11-05',params:{dataFile:'processes/my-demo/fixture.json'}};
    for(const key of ['params','explicitParams'])assert.throws(()=>effectiveParams(tmp,{...base,[key]:{...base.params,startDate:'01.10.2026'}},{}),/Явный период/);
    const result=effectiveParams(tmp,base,{});assert.equal(result.startDate,'01.01.2026');
    assert.equal(effectiveParams(tmp,{...base,params:{...base.params,startDate:'2026-01-01'}},{}).startDate,'01.01.2026');
  });
  check('human result names reject Windows device names and forbidden characters', () => {
    const {validResultName}=require('../../tools/lib/core/paths');
    for(const name of ['CON.md','nul.txt','COM1.json','LPT9.md','report:final.md','bad?.md','folder/report.md','report.md ','a\u0001.md'])assert.equal(validResultName(name),false,name);
    for(const name of ['отчёт.md','письмо.txt','report-2.json','отчёт.html'])assert.equal(validResultName(name),true,name);
    for(const name of ['CON.html'])assert.equal(validResultName(name),false,name);
  });
  check('previous hooks preserve arguments, stdin and failure status', () => {
    const {runHook,invocation}=require('../../tools/lib/git/git-hook');
    const result=runHook(process.execPath,['-e',"process.stdout.write(require('node:fs').readFileSync(0,'utf8')+'|'+process.argv[1]);process.exitCode=7",'argument with spaces'],{cwd:tmp,input:'hook input',encoding:'utf8'});
    assert.equal(result.status,7,JSON.stringify({error:result.error?.message,stderr:result.stderr,stdout:result.stdout}));assert.equal(result.stdout,'hook input|argument with spaces');
    const call=invocation('C:/Repo With Spaces/hook',['remote','address with spaces'],'win32',tmp);
    assert.deepEqual(call.args,['-c','exec "$@"','rockit-hook','C:/Repo With Spaces/hook','remote','address with spaces']);
  });
  check('commit guard permits output tests while rejecting local results and access files', () => {
    const {problems}=require('../../tools/lib/git/commit-guard');
    assert.deepEqual(problems('tests/outputs/structure.selftest.js',''),[]);
    for(const file of ['outputs/2026-11-05_test/result.md','.history/runs.jsonl','config/.env.local'])assert.ok(problems(file,'').length,file);
  });
  check('hook reinstall migrates previous metadata and preserves the user hook without recursion',()=>{
    const c=fixture({prefix:'rk-hooks-'}),{execFileSync,spawnSync}=require('node:child_process');
    const git=(...args)=>execFileSync('git',args,{cwd:c.tmp,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    const cli=(...args)=>spawnSync(process.execPath,args,{cwd:c.tmp,encoding:'utf8',timeout:10000});
    try{
      git('init','-b','master');
      const hook=path.join(c.tmp,'.git/hooks/pre-commit'),userHook='#!/bin/sh\nprintf x >> hook-calls.txt\nexit 7\n';
      fs.writeFileSync(hook,userHook,{mode:0o755});
      let result=cli('tools/kit.js','hooks-install');assert.equal(result.status,0,result.stderr);
      const backup=git('config','--local','--get','rockit.previousPreCommit');assert.equal(fs.readFileSync(backup,'utf8'),userHook);
      fs.writeFileSync(hook,fs.readFileSync(hook,'utf8').replace('# RocKit pre-commit v1. Index-only secret guard, no tests.','# Previous release bootstrap'));
      git('config','--local','--rename-section','rockit','prior');
      git('config','--local','--add','prior.previousPreCommit',backup);
      assert.equal(cli('tools/lib/git/commit-guard.js').status,1);
      for(let i=0;i<2;i++){result=cli('tools/kit.js','hooks-install');assert.equal(result.status,0,result.stderr);}
      assert.equal(git('config','--local','--get','rockit.previousPreCommit'),backup);
      assert.equal(spawnSync('git',['config','--local','--get','prior.previousPreCommit'],{cwd:c.tmp}).status,1);
      assert.equal(fs.readFileSync(backup,'utf8'),userHook);
      assert.equal(cli('tools/lib/git/commit-guard.js').status,1);
      assert.equal(fs.readFileSync(path.join(c.tmp,'hook-calls.txt'),'utf8'),'xx');
    }finally{c.close();}
  });
  check('conflicting previous hook namespaces stop rather than discard a user check',()=>{
    const c=fixture({copy:false}),{execFileSync}=require('node:child_process');
    const git=(...args)=>execFileSync('git',args,{cwd:c.tmp,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    try{
      git('init','-b','master');git('config','--local','prior.previousPrePush','first-hook');git('config','--local','other.previousPrePush','second-hook');
      assert.throws(()=>require('../../tools/lib/git/git-hook').previousHook(c.tmp,'pre-push'),/Конфликт/);
      assert.equal(git('config','--local','--get','prior.previousPrePush'),'first-hook');
      assert.equal(git('config','--local','--get','other.previousPrePush'),'second-hook');
    }finally{c.close();}
  });
  check('empty user hooks keep an empty backup through installation and reinstall',()=>{
    const c=fixture(),{execFileSync,spawnSync}=require('node:child_process');
    try{
      execFileSync('git',['init','-b','master'],{cwd:c.tmp,stdio:'pipe'});
      const hook=path.join(c.tmp,'.git/hooks/pre-commit');fs.writeFileSync(hook,'');
      for(let i=0;i<2;i++){
        const result=spawnSync(process.execPath,['tools/kit.js','hooks-install'],{cwd:c.tmp,encoding:'utf8'});
        assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(hook+'.before-rockit','utf8'),'');
      }
    }finally{c.close();}
  });
  check('hook preflight leaves earlier hooks and link targets intact when a later hook is invalid',()=>{
    const {execFileSync,spawnSync}=require('node:child_process');
    for(const kind of ['conflict','hook-link','backup-link']){
      const c=fixture();
      try{
        execFileSync('git',['init','-b','master'],{cwd:c.tmp,stdio:'pipe'});
        const first=path.join(c.tmp,'.git/hooks/pre-push'),second=path.join(c.tmp,'.git/hooks/pre-commit'),target=path.join(c.tmp,'user-hook.sh');
        const original='#!/bin/sh\nexit 7\n';fs.writeFileSync(first,original);fs.writeFileSync(target,original);
        if(kind==='conflict'){
          for(const [scope,value]of [['prior','first'],['other','second']])execFileSync('git',['config','--local',scope+'.previousPreCommit',value],{cwd:c.tmp});
        }else{
          if(kind==='backup-link')fs.writeFileSync(second,original);
          try{fs.symlinkSync(target,kind==='hook-link'?second:second+'.before-rockit','file');}
          catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code))continue;throw error;}
        }
        const result=spawnSync(process.execPath,['tools/kit.js','hooks-install'],{cwd:c.tmp,encoding:'utf8'});
        assert.equal(result.status,1,result.stdout);assert.equal(fs.readFileSync(first,'utf8'),original);
        assert.equal(fs.readFileSync(target,'utf8'),original);assert.equal(fs.existsSync(first+'.before-rockit'),false);
      }finally{c.close();}
    }
  });
  check('an active or saved RocKit bootstrap cannot become its own previous hook',()=>{
    const {execFileSync,spawnSync}=require('node:child_process');
    for(const copied of [false,true]){
      const c=fixture();
      try{
        execFileSync('git',['init','-b','master'],{cwd:c.tmp,stdio:'pipe'});
        const hook=path.join(c.tmp,'.git/hooks/pre-commit'),previous=copied?path.join(c.tmp,'saved-hook.sh'):hook;
        fs.copyFileSync(path.join(c.tmp,'.gigacode/hooks/pre-commit'),hook);if(copied)fs.copyFileSync(hook,previous);
        execFileSync('git',['config','--local','prior.previousPreCommit',previous],{cwd:c.tmp});
        assert.throws(()=>require('../../tools/lib/git/git-hook').previousHook(c.tmp,'pre-commit'),/рекурсия/);
        const result=spawnSync(process.execPath,['tools/kit.js','hooks-install'],{cwd:c.tmp,encoding:'utf8'});
        assert.equal(result.status,1,result.stdout);assert.match(result.stderr,/рекурсия/);
        assert.equal(fs.existsSync(path.join(c.tmp,'.git/hooks/pre-push')),false);
      }finally{c.close();}
    }
  });
  check('modified managed forwarders are rejected without overwriting or wrapping user checks',()=>{
    const {execFileSync,spawnSync}=require('node:child_process');
    for(const oldHeader of [false,true]){
      const c=fixture();
      try{
        execFileSync('git',['init','-b','master'],{cwd:c.tmp,stdio:'pipe'});
        const hook=path.join(c.tmp,'.git/hooks/pre-commit'),first=path.join(c.tmp,'.git/hooks/pre-push');
        let modified=fs.readFileSync(path.join(c.tmp,'.gigacode/hooks/pre-commit'),'utf8').replace('exec node','printf x >> check-hit.txt\nexec node');
        if(oldHeader)modified=modified.replace('# RocKit pre-commit v1. Index-only secret guard, no tests.','# Previous release bootstrap');
        fs.writeFileSync(hook,modified);fs.writeFileSync(first,'#!/bin/sh\nexit 7\n');
        const result=spawnSync(process.execPath,['tools/kit.js','hooks-install'],{cwd:c.tmp,encoding:'utf8'});
        assert.equal(result.status,1,result.stdout);assert.match(result.stderr,/изменённая обёртка/);
        assert.equal(fs.readFileSync(hook,'utf8'),modified);assert.equal(fs.readFileSync(first,'utf8'),'#!/bin/sh\nexit 7\n');
        assert.equal(fs.existsSync(hook+'.before-rockit'),false);
        const saved=path.join(c.tmp,'saved-forwarder.sh');fs.writeFileSync(saved,modified);
        execFileSync('git',['config','--local','prior.previousPreCommit',saved],{cwd:c.tmp});
        assert.throws(()=>require('../../tools/lib/git/git-hook').previousHook(c.tmp,'pre-commit'),/рекурсия/);
        assert.equal(fs.existsSync(path.join(c.tmp,'check-hit.txt')),false);
      }finally{c.close();}
    }
  });
  check('unstructured local settings and result folders stay outside normal git add after renaming',()=>{
    const c=fixture({copy:false}),{execFileSync}=require('node:child_process');
    try{
      execFileSync('git',['init','-b','master'],{cwd:c.tmp,stdio:'pipe'});
      c.write('.gitignore',fs.readFileSync(path.join(source,'.gitignore'),'utf8'));
      c.write('legacy.local.json','PRIVATE');c.write('Legacy Reports/report.html','PRIVATE');c.write('README.md','Public');
      execFileSync('git',['add','.'],{cwd:c.tmp});
      const names=execFileSync('git',['ls-files','-z'],{cwd:c.tmp,encoding:'utf8'}).split('\0').filter(Boolean).sort();
      assert.deepEqual(names,['.gitignore','README.md']);
    }finally{c.close();}
  });
  check('повтор поля в шапке', () => assert.ok(parseFrontmatter('---\nname: one\nname: two\n---').error));
  check('неподдерживаемая шапка', () => assert.ok(parseFrontmatter('---\nname: one\nnot yaml\n---').error));
} finally { ctx.close(); }

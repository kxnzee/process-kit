'use strict';
const c=require('../fixture')(),{tmp,source,fs,path,assert,write}=c;
const {execFileSync,spawnSync}=require('node:child_process');
const git=(...args)=>execFileSync('git',args,{cwd:tmp,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
try{
 const guide=path.join(source,'docs/pilot-install.md');
 assert.ok(fs.existsSync(guide),'ARCH-008: missing pinned pilot installation procedure');
 const script=fs.readFileSync(guide,'utf8').match(/```javascript\n([\s\S]*?)\n```/)[1];
 write('pilot-install.cjs',script);fs.copyFileSync(path.join(source,'.gitattributes'),path.join(tmp,'.gitattributes'));
 git('init','-b','master');git('config','user.name','Seed');git('config','user.email','seed@example.invalid');git('add','--','actions','processes','context','config','tools','adapters','.gigacode','.gitattributes');git('-c','commit.gpgsign=false','commit','-m','pilot fixture');
 const sha=git('rev-parse','HEAD');assert.equal(git('tag','--list'),'');
 const run=(revision,destination)=>spawnSync(process.execPath,[path.join(tmp,'pilot-install.cjs'),tmp,revision,destination,'Pilot Test','pilot@example.invalid'],{cwd:tmp,encoding:'utf8'});
 const rejected=run('master',path.join(tmp,'invalid'));assert.notEqual(rejected.status,0);assert.equal(fs.existsSync(path.join(tmp,'invalid')),false);
 const mismatch=run('f'.repeat(40),path.join(tmp,'mismatch'));assert.notEqual(mismatch.status,0);assert.equal(fs.existsSync(path.join(tmp,'mismatch/config/my/config.json')),false);
 const destination=path.join(tmp,'pilot installation пробелы'),result=run(sha,destination);assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(require('../../tools/lib/config/setup-state').inspect(destination).personalReady,true);
 assert.equal(execFileSync('git',['rev-parse','HEAD^'],{cwd:destination,encoding:'utf8'}).trim(),sha);
 assert.equal(execFileSync('git',['tag','--list'],{cwd:destination,encoding:'utf8'}).trim(),'');
 const journal=require('../../tools/lib/runtime/run-journal'),started=journal.start(destination,{process:'example',mode:'local',inputText:'12 задач.',params:{to:'Test',subject:'Pilot'}});
 assert.equal(journal.operation(destination,'next',{output:started.output}).operation,'begin');
 const duplicate=run(sha,destination);assert.notEqual(duplicate.status,0);assert.equal(require('../../tools/lib/config/setup-state').inspect(destination).personalReady,true);
 console.log('✓ ARCH-008: documented SHA-pinned pilot installs without tags; invalid revision and overwrite are rejected');
}finally{c.close();}

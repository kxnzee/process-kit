'use strict';
const c=require('../fixture')(),{tmp,write,fs,path,assert,check}=c;
const {execFileSync,spawnSync}=require('node:child_process');
const git=(...args)=>execFileSync('git',args,{cwd:tmp,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
try{
 git('init','-b','my');git('config','user.name','Test');git('config','user.email','test@example.invalid');write('seed.md','seed');git('add','seed.md');git('-c','commit.gpgsign=false','commit','-m','seed');
 git('config','branch.my.pushRemote','mine');git('remote','add','origin','https://github.com/Org/Common.git');git('remote','add','mine','git@github.com:org/common');
 write('config/my/config.json',JSON.stringify({schemaVersion:2,teamId:null,profile:{name:'Test',email:'test@example.invalid'},storage:{mode:'repository',repositoryUrl:'git@github.com:org/common'},taskStores:[],codeStores:[],defaults:{},preferences:{}}));
 execFileSync(process.execPath,['tools/kit.js','hooks-install'],{cwd:tmp,stdio:'pipe'});
 const sha=git('rev-parse','HEAD'),input=`refs/heads/my ${sha} refs/heads/my ${'0'.repeat(40)}\n`;
 const rejected=address=>{const result=spawnSync(process.execPath,['tools/lib/git/prepush.js','mine',address],{cwd:tmp,input,encoding:'utf8'});assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/Личную копию/);};
 check('ARCH-006: equivalent SSH/HTTPS destinations cannot bypass common-repository protection',()=>rejected('git@github.com:org/common'));
 check('ARCH-006: setup rejects a personal remote aliasing the common repository',()=>assert.equal(require('../../tools/lib/config/setup-state').inspect(tmp).personalReady,false));
 check('ARCH-006: path and file URL aliases cannot bypass protection',()=>{
  const local=path.join(tmp,'.git');git('remote','set-url','origin',local);git('remote','set-url','mine',require('node:url').pathToFileURL(local).href);rejected(require('node:url').pathToFileURL(local).href);
 });
 check('ARCH-006: every personal push URL must be isolated, including common fetch URLs',()=>{
  git('remote','set-url','origin','https://github.com/org/common');git('remote','set-url','mine','https://github.com/org/personal');git('config','--add','remote.mine.pushurl','https://github.com/org/personal');git('config','--add','remote.mine.pushurl','ssh://git@github.com/org/common.git');rejected('https://github.com/org/personal');
 });
}finally{c.close();}

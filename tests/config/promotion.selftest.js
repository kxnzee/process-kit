'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {promotionPlan}=require('../../tools/lib/git/promotion-plan');
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pk-config-promotion-'));
const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}});
try{
 git('init','-b','master');git('config','user.name','Config fixture');git('config','user.email','fixture@example.invalid');git('config','commit.gpgsign','false');
 fs.writeFileSync(path.join(cwd,'README.md'),'Fixture\n');git('add','README.md');git('commit','-m','fixture');git('update-ref','refs/remotes/origin/team-a','HEAD');git('update-ref','refs/remotes/origin/master','HEAD');
 fs.mkdirSync(path.join(cwd,'config/team'),{recursive:true});fs.mkdirSync(path.join(cwd,'config/my'),{recursive:true});
 fs.writeFileSync(path.join(cwd,'config/team/config.json'),'{}');fs.writeFileSync(path.join(cwd,'config/my/config.json'),'{}');
 const team=promotionPlan(cwd,'origin/team-a'),master=promotionPlan(cwd,'origin/master');
 assert.ok(team.candidates.some(row=>row.path==='config/team/config.json'&&row.administrative));
 assert.ok(team.excluded.some(row=>row.path==='config/my/config.json'));
 for(const file of ['config/team/config.json','config/my/config.json'])assert.ok(master.excluded.some(row=>row.path===file));
 fs.mkdirSync(path.join(cwd,'config/master'),{recursive:true});fs.copyFileSync(path.join(__dirname,'../../config/master/config.json'),path.join(cwd,'config/master/config.json'));
 fs.writeFileSync(path.join(cwd,'config/team/config.json'),JSON.stringify({schemaVersion:2,team:{id:'a',name:'A',owners:[]}}));
 fs.writeFileSync(path.join(cwd,'config/my/config.json'),JSON.stringify({schemaVersion:2,teamId:'a',profile:{name:'User',email:'user@example.invalid'},storage:{mode:'local'}}));
 for(const scope of ['master','team','my']){const folder=path.join(cwd,'context',scope,'domain');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'CONTEXT.md'),'# Domain\nFacts.\n');}
 git('update-ref','refs/remotes/origin/team-b','HEAD');
 const target=promotionPlan(cwd,'origin/team-a'),foreign=promotionPlan(cwd,'origin/team-b'),shared=promotionPlan(cwd,'origin/master');
 assert.ok(target.candidates.some(row=>row.path==='context/team/domain/CONTEXT.md'));
 assert.ok(foreign.excluded.some(row=>row.path==='context/team/domain/CONTEXT.md'));
 assert.ok(shared.excluded.some(row=>row.path==='context/team/domain/CONTEXT.md'));
 for(const plan of [target,foreign,shared])assert.ok(plan.excluded.some(row=>row.path==='context/my/domain/CONTEXT.md'));
 assert.ok(shared.candidates.some(row=>row.path==='context/master/domain/CONTEXT.md'));
 console.log('✓ team config is explicit administrative input; personal config is excluded from team/master');
}finally{fs.rmSync(cwd,{recursive:true,force:true});}

#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync,spawnSync}=require('node:child_process');
const source=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'pk-team-fixes-')),cwd=path.join(temp,'repo'),remote=path.join(temp,'origin.git');
const {splitFixture,normalizeFixture}=require('./sdd-data');
let count=0;const check=(name,fn)=>{fn();count++;console.log(`✓ ${name}`);};
const read=f=>fs.readFileSync(path.join(cwd,f),'utf8'),write=(f,t)=>{fs.mkdirSync(path.dirname(path.join(cwd,f)),{recursive:true});fs.writeFileSync(path.join(cwd,f),t);};
const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const validate=(...args)=>{const result=spawnSync(process.execPath,[path.join(source,'tools/validate.js'),'--root',cwd,'--json',...args],{cwd,encoding:'utf8'});assert.ok([0,1].includes(result.status),result.stderr);return JSON.parse(result.stdout);};
try{
 fs.cpSync(source,cwd,{recursive:true,filter:file=>!['.git','outputs','.history','.codegraph','node_modules'].includes(path.relative(source,file).split(path.sep)[0])});
 // Build a clean common fixture even when tests are launched from a configured team/my checkout.
 for(const file of ['TEAM.md','config/sources.json'])fs.rmSync(path.join(cwd,file),{force:true});
 for(const dir of ['processes','actions','context','adapters','tests','.gigacode/skills']){
  const base=path.join(cwd,dir);if(!fs.existsSync(base))continue;
  function prune(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,item.name);if(/^(?:my-|team-[a-z0-9]+-)/.test(item.name))fs.rmSync(file,{recursive:true,force:true});else if(item.isDirectory())prune(file);}}
  prune(base);
 }
 git('init','-q','-b','master');git('config','user.name','Fixture User');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-qm','current common snapshot');
 execFileSync('git',['init','--bare','-q','--initial-branch=master',remote]);git('remote','add','origin',remote);git('push','-q','origin','master');
 git('switch','-qc','team-alpha','--no-track','origin/master');write('TEAM.md','# Команда Alpha\nКод: alpha\nВладельцы: Тестовый владелец\n');write('config/sources.json',read('config/sources.template.json'));
 check('fresh team template does not block full structural validation',()=>assert.equal(validate().errors,0));
 check('selected TODO configuration still blocks live SDD',()=>assert.ok(validate('--process','sdd-stories-report').errors>0));
 check('demo works without configured selected sources',()=>assert.equal(validate('--process','sdd-stories-report','--demo').errors,0));
 check('a real missing adapter is not excused as TODO',()=>{const original=read('config/sources.json'),cfg=JSON.parse(original);cfg.taskStores[0].adapter='missing-real';write('config/sources.json',JSON.stringify(cfg));assert.ok(validate('--only','connections').errors>0);write('config/sources.json',original);});
 check('a real missing default process is rejected',()=>{const original=read('config/sources.json'),cfg=JSON.parse(original);cfg.defaults.process='missing-real';write('config/sources.json',JSON.stringify(cfg));assert.ok(validate('--only','connections').errors>0);write('config/sources.json',original);});
 const teamProcess=read('processes/edit-text.md').replace('name: edit-text','name: team-alpha-edit');write('processes/team-alpha-edit.md',teamProcess);
 check('team process reuses common action without duplication',()=>assert.equal(validate('--only','processes').errors,0));
 git('add','TEAM.md','config/sources.json','processes/team-alpha-edit.md');git('commit','-qm','prepare team');git('push','-q','-u','origin','team-alpha');git('switch','-qc','my','--no-track','origin/team-alpha');git('config','--local','processkit.team','team-alpha');
 check('personal branch inherits unchanged common and team content',()=>assert.equal(validate('--only','levels').errors,0));
 for(const f of ['context/common.md','processes/team-alpha-edit.md','README.md','tools/paths.js'])check('inherited edit is blocked: '+f,()=>{const original=read(f);write(f,original+'\nchanged\n');assert.ok(validate('--only','levels').issues.some(issue=>issue.msg.includes('унаследованный файл')));write(f,original);});
 check('checkout line endings do not masquerade as inherited content edits',()=>{const f='context/common.md',original=read(f);git('config','--local','core.autocrlf','true');try{write(f,original.replace(/\r?\n/g,'\r\n'));assert.equal(validate('--only','levels').errors,0);}finally{write(f,original);git('config','--local','core.autocrlf','false');}});
 check('inherited deletion is blocked',()=>{const f='context/common.md',original=read(f);fs.unlinkSync(path.join(cwd,f));assert.ok(validate('--only','levels').errors>0);write(f,original);});
 check('explicit personal connection setup is still allowed',()=>{const f='config/sources.json',original=read(f);write(f,original+'\n');assert.equal(validate('--only','levels').errors,0);write(f,original);});
 check('personal recipe can reuse the team process',()=>{write('processes/my-edit.md',teamProcess.replace('name: team-alpha-edit','name: my-edit'));assert.equal(validate('--only','levels').errors,0);});
 check('advanced remote does not invalidate an unchanged pinned installation',()=>{git('switch','-q','team-alpha');write('context/team-alpha-new.md','# Новый факт\n');git('add','context/team-alpha-new.md');git('commit','-qm','team advanced');git('push','-q','origin','team-alpha');git('switch','-q','my');assert.equal(validate('--only','levels').errors,0);});
 const fixture=JSON.parse(read('tests/sdd-stories-report/fixture.json'));
 for(const query of ['my-sdd','team-alpha-sdd'])check('explicit query identity is supported: '+query,()=>{const fx=structuredClone(fixture);fx.query=query;const data=splitFixture(fx,query);assert.equal(data.tasks.meta.query,query);assert.equal(normalizeFixture(fx,query).counters.sddShare,'75,0');assert.throws(()=>splitFixture(fx));assert.throws(()=>splitFixture(fx,'different-query'));});
 check('report checker verifies personal fixture against selected query',()=>{const tests='tests/my-sdd';fs.cpSync(path.join(cwd,'tests/sdd-stories-report'),path.join(cwd,tests),{recursive:true});const fx=structuredClone(fixture);fx.query='my-sdd';write(tests+'/fixture.json',JSON.stringify(fx));const expected=JSON.parse(read(tests+'/fetch.json'));expected.query='actions/run-query/queries/my-sdd.md';expected.fixture=tests+'/fixture.json';write(tests+'/fetch.json',JSON.stringify(expected));const args=[path.join(source,'tools/check-report.js'),'--root',cwd,'--tests',tests];assert.equal(spawnSync(process.execPath,args,{cwd,encoding:'utf8'}).status,0);expected.query='actions/run-query/queries/wrong.md';write(tests+'/fetch.json',JSON.stringify(expected));assert.equal(spawnSync(process.execPath,args,{cwd,encoding:'utf8'}).status,1);});
 check('wrong demo folder gives an actionable prefix error',()=>{const f='outputs/2026-11-03_demo-sdd/итог.md';write(f,'# Проба\nДата: 2026-11-03\nЧем закончилось: Пробный прогон, ничего не отправлено. Готово.\n');assert.ok(validate('--only','outputs').issues.some(issue=>issue.msg.includes('_проба-')));fs.renameSync(path.dirname(path.join(cwd,f)),path.join(cwd,'outputs/2026-11-03_проба-sdd'));assert.equal(validate('--only','outputs').errors,0);});
 console.log(`Team workflow: ${count} passed.`);
}finally{fs.rmSync(temp,{recursive:true,force:true});}

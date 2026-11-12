'use strict';
const c=require('../fixture')(),{tmp,write,fs,path,assert}=c;
const {spawn}=require('node:child_process'),journal=require('../../tools/lib/runtime/run-journal');
const wait=async(predicate)=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Worker barrier did not arrive');};
(async()=>{
 let workers=[];
 try{
  write('actions/audit-exclusive/ACTION.md','---\nname: audit-exclusive\ndescription: exclusive computation\nkind: transform\nadapter: none\nconsumes:\n  artifacts: []\n  params: []\nproduces:\n  result: Text\ncontracts:\n  result: text\nruntime: runtime.js\n---\n# Exclusive computation\n');
  write('actions/audit-exclusive/runtime.js',"const fs=require('node:fs'),p=require('node:path');exports.execute=ctx=>{const dir=p.join(ctx.cwd,'barrier');fs.writeFileSync(p.join(dir,String(process.pid)),'entered');for(let i=0;!fs.existsSync(p.join(dir,'go'));i++){if(i>1000)throw new Error('Barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}return 'done';};");
  write('processes/audit-exclusive/PROCESS.md','---\nname: audit-exclusive\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: exclusive execute\nexample: test\nentry: work\n---\n## Шаги\n### work\n- действие: audit-exclusive\n- артефакт: result\n- следующий: end\n');
  fs.mkdirSync(path.join(tmp,'barrier'));
  const {output}=journal.start(tmp,{process:'audit-exclusive',mode:'local',definitionTest:true});
  const begun=journal.operation(tmp,'begin',{output,step:'work'}),spec={output,step:'work',attemptId:begun.pending.id};
  const launch=()=>{
   const child=spawn(process.execPath,['-e',"try{require(process.argv[1]).execute(process.argv[2],JSON.parse(process.argv[3]));}catch(e){process.stderr.write(e.message);process.exitCode=1;}",path.join(c.source,'tools/lib/runtime/run-journal.js'),tmp,JSON.stringify(spec)]);
   const result={child,done:false,error:''};child.stderr.on('data',d=>result.error+=d);result.promise=new Promise(resolve=>child.on('close',code=>{result.done=true;result.code=code;resolve(result);}));workers.push(result);return result;
  };
  const first=launch();await wait(()=>fs.readdirSync(path.join(tmp,'barrier')).length===1);
  const second=launch();await wait(()=>second.done||fs.readdirSync(path.join(tmp,'barrier')).length===2);
  const entered=fs.readdirSync(path.join(tmp,'barrier')).length;
  write('barrier/go','go');await Promise.all(workers.map(w=>w.promise));
  assert.equal(entered,1,'The same pending attempt was computed twice');
  assert.equal(first.code,0,first.error);assert.equal(second.code,1);assert.match(second.error,/Журнал занят/);
  assert.equal(journal.operation(tmp,'next',{output}).operation,'finish');
  console.log('✓ ARCH-003: one run lock owns execute through computation and save');
 }finally{
  if(fs.existsSync(path.join(tmp,'barrier')))write('barrier/go','go');
  await Promise.all(workers.map(w=>w.promise));c.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});

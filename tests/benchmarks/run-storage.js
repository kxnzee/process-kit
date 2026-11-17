'use strict';
// Manual bounded benchmark, outside the automatic correctness suite:
// node tests/benchmarks/run-storage.js
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {performance}=require('node:perf_hooks'),storage=require('../../tools/lib/runtime/run-storage');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pk-storage-bench-')),results=[];
try{
 for(const payloadBytes of [128,4096])for(const events of [100,1000,10000]){
  const dir=path.join(tmp,`${payloadBytes}-${events}`);fs.mkdirSync(dir);
  const row={ts:'2026-11-17T00:00:00.000Z',type:'step_completed',process:'benchmark',step:'work',params:{text:'x'.repeat(payloadBytes)}};
  const trace=(JSON.stringify(row)+'\n').repeat(events);fs.writeFileSync(path.join(dir,'trace.jsonl'),trace);
  const state={revision:0,identity:{process:'benchmark'}},samples=[],written=[];
  for(let i=0;i<5;i++){
   let bytes=0;const write=fs.writeFileSync;
   fs.writeFileSync=function(file,value){bytes+=Buffer.isBuffer(value)?value.length:Buffer.byteLength(value);return write.apply(this,arguments);};
   const begin=performance.now();
   try{storage.stage(dir,state,[{...row,params:undefined}]);storage.restore(dir);storage.finish(dir);}finally{fs.writeFileSync=write;}
   samples.push(performance.now()-begin);written.push(bytes);
  }
  results.push({events,payloadBytes,traceMiB:+(Buffer.byteLength(trace)/1048576).toFixed(2),medianCommitMs:+samples.sort((a,b)=>a-b)[2].toFixed(2),medianWrittenMiB:+(written.sort((a,b)=>a-b)[2]/1048576).toFixed(2)});
 }
 console.log(JSON.stringify({node:process.version,platform:process.platform,scope:'storage stage/restore/finish only; synthetic pre-existing trace; 5 commits per size; no fsync durability measurement',results},null,2));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

'use strict';
// One recoverable file transaction per run, not a second journal or event-sourced model.
const fs=require('node:fs'),crypto=require('node:crypto'),os=require('node:os');
const {inside}=require('../core/safe-path');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const encode=value=>JSON.stringify(value,null,2)+'\n';
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
function atomic(file,value){
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(tmp,typeof value==='string'?value:encode(value),{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}
 finally{fs.rmSync(tmp,{force:true});}
}
function lock(dir,recover=false,name='.journal.lock'){
 const file=inside(dir,name),owner={pid:process.pid,host:os.hostname(),id:crypto.randomUUID()};
 function claim(){
  // Publish a nonempty directory with its owner in one rename: no ownerless lock window.
  const candidate=inside(dir,`${name}.${owner.pid}.${owner.id}.candidate`);
  fs.mkdirSync(candidate);
  try{
   atomic(inside(candidate,'owner.json'),owner);
   if(fs.existsSync(file))return false;
   try{fs.renameSync(candidate,file);return true;}catch(error){if(['ENOTEMPTY','EEXIST'].includes(error.code)||fs.existsSync(file))return false;throw error;}
  }finally{fs.rmSync(candidate,{recursive:true,force:true});}
 }
 if(!claim()){
  if(!recover)throw new Error('Журнал занят или прерван: используйте run recover, не удаляйте lock вручную');
  // The recovery guard uses the same owned protocol. A crashed recovery is recoverable too.
  const releaseGuard=lock(dir,true,name==='.journal.lock'?'.recovery.lock':name+'.recovery');
  try{
   let acquired=false;
   const entry=fs.statSync(file,{throwIfNoEntry:false});
   if(entry){
    let previous;
    try{previous=JSON.parse(fs.readFileSync(inside(file,'owner.json'),'utf8'));}
    catch(error){
     const current=fs.statSync(file,{throwIfNoEntry:false});
     // An ordinary release may remove/replace the path between stat and read.
     if(error.code==='ENOENT'&&(!current||current.dev!==entry.dev||current.ino!==entry.ino)){
      if(!claim())throw new Error('Журнал занят работающим процессом');
      acquired=true;
     }else throw new Error('Владелец lock неизвестен: требуется проверка разработчиком');
    }
    if(!acquired){
     if(previous.host!==os.hostname()||!Number.isInteger(previous.pid)||previous.pid<=0)throw new Error('Нельзя проверить владельца lock на этом компьютере');
     try{process.kill(previous.pid,0);throw new Error('Журнал занят работающим процессом');}catch(error){if(error.code!=='ESRCH')throw error;}
     const stale=file+'.'+crypto.randomUUID()+'.stale';fs.renameSync(file,stale);fs.rmSync(stale,{recursive:true,force:true});
    }
   }
   // A normal writer can acquire during recovery; never remove its newly published lock.
   if(!acquired&&!claim())throw new Error('Журнал занят работающим процессом');
  }finally{releaseGuard();}
 }
 return ()=>{
  const current=JSON.parse(read(inside(file,'owner.json')));
  if(current.id!==owner.id)throw new Error('Изменился владелец блокировки');
  // Withdraw the complete owned directory before deleting metadata inside it.
  const released=file+'.'+owner.id+'.released';fs.renameSync(file,released);fs.rmSync(released,{recursive:true});
 };
}

function verify(dir){
 const checkpoint=read(inside(dir,'checkpoint.json'));
 if(!checkpoint)return false; // Old runs are explicitly kept on the legacy protocol.
 const expected=JSON.parse(checkpoint),state=JSON.parse(read(inside(dir,'state.json')));
 if(expected.state!==hash(read(inside(dir,'state.json')))||expected.trace!==hash(read(inside(dir,'trace.jsonl')))||expected.revision!==state.revision)throw new Error('Нарушена согласованность состояния и журнала');
 return true;
}
function stage(dir,state,events,spec={}){
 if(fs.existsSync(inside(dir,'transaction.json')))throw new Error('Незавершённая запись: используйте run recover');
 const beforeState=read(inside(dir,'state.json')),beforeTrace=read(inside(dir,'trace.jsonl'));
 state.revision=(state.revision||0)+1;
 const transaction={beforeState:hash(beforeState),beforeTrace:hash(beforeTrace),state:encode(state),trace:beforeTrace+events.map(e=>JSON.stringify(e)+'\n').join(''),spec:{summary:spec.summary,reason:spec.reason}};
 atomic(inside(dir,'transaction.json'),transaction);
 return transaction;
}
function restore(dir){
 const file=inside(dir,'transaction.json');if(!fs.existsSync(file))return null;
 const tx=JSON.parse(read(file)),currentState=hash(read(inside(dir,'state.json'))),currentTrace=hash(read(inside(dir,'trace.jsonl')));
 if(![tx.beforeState,hash(tx.state)].includes(currentState)||![tx.beforeTrace,hash(tx.trace)].includes(currentTrace))throw new Error('Нарушена согласованность незавершённой записи');
 const state=JSON.parse(tx.state);
 atomic(inside(dir,'trace.jsonl'),tx.trace);atomic(inside(dir,'state.json'),tx.state);
 atomic(inside(dir,'checkpoint.json'),{revision:state.revision,state:hash(tx.state),trace:hash(tx.trace)});
 // Human log is a projection; it can always be rebuilt from the committed trace.
 atomic(inside(dir,'run.md'),'# Прогон '+state.identity.process+'\n'+tx.trace.split('\n').filter(Boolean).map(line=>{const e=JSON.parse(line);return `${e.ts} ${e.type}${e.step?' '+e.step:''}`;}).join('\n')+'\n');
 return {state,spec:tx.spec};
}
function finish(dir){fs.unlinkSync(inside(dir,'transaction.json'));}
module.exports={atomic,hash,lock,verify,stage,restore,finish};

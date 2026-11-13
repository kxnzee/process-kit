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
 const candidateFor=owner=>inside(dir,`${name}.${owner.pid}.${owner.id}.candidate`);
 const same=(a,b)=>a&&b&&a.dev===b.dev&&a.ino===b.ino;
 const sameOwner=(a,b)=>a?.pid===b?.pid&&a?.host===b?.host&&a?.id===b?.id;
 function readOwner(entry){
  if(entry.isDirectory())return JSON.parse(fs.readFileSync(inside(file,'owner.json'),'utf8'));
  // Never open the reusable lock name. Windows can deny that open when a writer
  // unlinks it concurrently. Read a private hard-link snapshot, then close/remove it.
  const reader=file+'.'+crypto.randomUUID()+'.reader';
  fs.linkSync(file,reader);
  try{return JSON.parse(fs.readFileSync(reader,'utf8'));}finally{fs.unlinkSync(reader);}
 }
 function claim(){
  // Publish closed, complete owner bytes exclusively. A file rename could overwrite a lock.
  // Keep the candidate as an anchor until after unlinking the reusable name.
  // On Windows a last-link delete can leave that name pending while a reader is open.
  const candidate=candidateFor(owner);let published=false;
  try{
   fs.writeFileSync(candidate,encode(owner),{flag:'wx',mode:0o600});
   try{fs.linkSync(candidate,file);published=true;return true;}catch(error){if(error.code==='EEXIST'||fs.existsSync(file))return false;throw error;}
  }finally{if(!published)fs.rmSync(candidate,{force:true});}
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
    try{previous=readOwner(entry);}
    catch(error){
     const current=fs.statSync(file,{throwIfNoEntry:false});
     // A file may disappear/reappear between stat and read, including inode reuse.
     // Never infer ownership from stat: one exclusive claim either succeeds or is busy.
     // Missing owner.json in the same legacy directory remains an unknown owner.
     if(['ENOENT','ENOTDIR','EISDIR'].includes(error.code)&&(!entry.isDirectory()||!same(current,entry))){
      if(!claim())throw new Error('Журнал занят работающим процессом');
      acquired=true;
     }else throw Object.assign(new Error('Владелец lock неизвестен: требуется проверка разработчиком ('+name+': '+(error.code||error.name)+')'),{cause:error});
    }
    if(!acquired){
     if(!previous||previous.host!==os.hostname()||!Number.isInteger(previous.pid)||previous.pid<=0)throw new Error('Нельзя проверить владельца lock на этом компьютере');
     try{process.kill(previous.pid,0);throw new Error('Журнал занят работающим процессом');}catch(error){if(error.code!=='ESRCH')throw error;}
     if(entry.isDirectory()){
      // Legacy locks remain recoverable only after their local owner is proven dead.
      const latest=fs.statSync(file,{throwIfNoEntry:false});
      if(!same(latest,entry)||!sameOwner(readOwner(latest),previous))throw new Error('Журнал занят работающим процессом');
      const stale=file+'.'+crypto.randomUUID()+'.stale';fs.renameSync(file,stale);fs.rmSync(stale,{recursive:true,force:true});
     }else{
      // A crash immediately after link may leave its candidate hard link. Remove only
      // that same inode, never an unrelated candidate or a path supplied by metadata.
      const anchor=candidateFor(owner);
      try{fs.linkSync(file,anchor);}catch(error){
       if(error.code!=='ENOENT')throw error;
       if(!claim())throw new Error('Журнал занят работающим процессом');
       acquired=true;
      }
      if(!acquired)try{
       const anchored=fs.statSync(anchor),captured=JSON.parse(fs.readFileSync(anchor,'utf8'));
       if(!same(anchored,entry)||!sameOwner(captured,previous))throw new Error('Журнал занят работающим процессом');
       fs.unlinkSync(file);
       if(typeof previous.id==='string'&&/^[a-f0-9-]{36}$/.test(previous.id)){
        const candidate=candidateFor(previous);
        if(same(fs.statSync(candidate,{throwIfNoEntry:false}),entry))fs.unlinkSync(candidate);
       }
      }finally{fs.unlinkSync(anchor);}
     }
    }
   }
   // A normal writer can acquire during recovery; never remove its newly published lock.
   if(!acquired&&!claim())throw new Error('Журнал занят работающим процессом');
  }finally{releaseGuard();}
 }
 return ()=>{
  const entry=fs.statSync(file),current=readOwner(entry);
  if(current.id!==owner.id)throw new Error('Изменился владелец блокировки');
  fs.unlinkSync(file);
  const candidate=candidateFor(owner);
  if(same(fs.statSync(candidate,{throwIfNoEntry:false}),entry))fs.unlinkSync(candidate);
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

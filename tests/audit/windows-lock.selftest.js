'use strict';
const c=require('../fixture')({copy:false}),{tmp,fs,path,assert,check}=c;
const storage=require('../../tools/lib/runtime/run-storage');
try{
 check('ARCH-004: release never deletes the last link at a reusable lock path while a reader is open',()=>{
  // Deterministic model of Windows delete-pending: recreating the same name fails
  // if unlink removed the last hard link while another process still reads it.
  const file=path.join(tmp,'.journal.lock'),release=storage.lock(tmp),reader=fs.openSync(file,'r');
  const unlink=fs.unlinkSync,link=fs.linkSync;let pending=false;
  fs.unlinkSync=function(target){if(target===file&&fs.statSync(target).nlink===1)pending=true;return unlink.apply(this,arguments);};
  fs.linkSync=function(from,to){if(to===file&&pending)throw Object.assign(new Error('WINDOWS_DELETE_PENDING'),{code:'EPERM'});return link.apply(this,arguments);};
  try{
   release();const next=storage.lock(tmp);next();
   assert.equal(pending,false,'Reusable lock path entered delete-pending');
  }finally{fs.unlinkSync=unlink;fs.linkSync=link;fs.closeSync(reader);}
  assert.deepEqual(fs.readdirSync(tmp),[]);
 });
 check('ARCH-004: a disappearing owner read cannot turn a cached stat into unknown ownership or steal a live lock',()=>{
  const file=path.join(tmp,'.journal.lock'),bytes=JSON.stringify({pid:process.pid,host:require('node:os').hostname(),id:require('node:crypto').randomUUID()});
  fs.writeFileSync(file,bytes);const read=fs.readFileSync;let injected=false;
  fs.readFileSync=function(target){if(String(target).startsWith(file)&&String(target).endsWith('.reader')&&!injected){injected=true;throw Object.assign(new Error('Cached stat / disappearing path'),{code:'ENOENT'});}return read.apply(this,arguments);};
  try{assert.throws(()=>storage.lock(tmp,true),/Журнал занят работающим процессом/);}
  finally{fs.readFileSync=read;}
  assert.equal(fs.readFileSync(file,'utf8'),bytes);fs.unlinkSync(file);assert.deepEqual(fs.readdirSync(tmp),[]);
 });
 check('ARCH-004: recovery anchors old file locks before unlinking their reusable name',()=>{
  const file=path.join(tmp,'.journal.lock');
  const child=require('node:child_process').spawnSync(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,host:require('node:os').hostname(),id:require('node:crypto').randomUUID()}));",file],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);const reader=fs.openSync(file,'r'),unlink=fs.unlinkSync,link=fs.linkSync;let pending=false;
  fs.unlinkSync=function(target){if(target===file&&fs.statSync(target).nlink===1)pending=true;return unlink.apply(this,arguments);};
  fs.linkSync=function(from,to){if(to===file&&pending)throw Object.assign(new Error('WINDOWS_DELETE_PENDING'),{code:'EPERM'});return link.apply(this,arguments);};
  try{const release=storage.lock(tmp,true);release();assert.equal(pending,false);}
  finally{fs.unlinkSync=unlink;fs.linkSync=link;fs.closeSync(reader);}
  assert.deepEqual(fs.readdirSync(tmp),[]);
 });
 check('ARCH-004: recovery does not remove a replacement live owner after the old owner exits',()=>{
  const file=path.join(tmp,'.journal.lock'),owner={pid:2147483647,host:require('node:os').hostname(),id:require('node:crypto').randomUUID()};
  // The process/FS boundary replaces the lock exactly while liveness is checked.
  for(const legacy of [false,true]){
   if(legacy){fs.mkdirSync(file);fs.writeFileSync(path.join(file,'owner.json'),JSON.stringify(owner));}else fs.writeFileSync(file,JSON.stringify(owner));
   const kill=process.kill,newOwner={...owner,pid:process.pid,id:require('node:crypto').randomUUID()};let replaced=false;
   process.kill=function(pid){if(pid===owner.pid){replaced=true;fs.rmSync(file,{recursive:true,force:true});if(legacy){fs.mkdirSync(file);fs.writeFileSync(path.join(file,'owner.json'),JSON.stringify(newOwner));}else fs.writeFileSync(file,JSON.stringify(newOwner));throw Object.assign(new Error('Owner exited'),{code:'ESRCH'});}return kill.apply(this,arguments);};
   try{assert.throws(()=>storage.lock(tmp,true),/Журнал занят работающим процессом/);}
   finally{process.kill=kill;}
   assert.ok(replaced);assert.equal(JSON.parse(fs.readFileSync(legacy?path.join(file,'owner.json'):file,'utf8')).id,newOwner.id);fs.rmSync(file,{recursive:true,force:true});
  }
  assert.deepEqual(fs.readdirSync(tmp),[]);
 });
 check('ARCH-004: canonical lock open can fail during deletion without reading or removing an unknown owner',()=>{
  const file=path.join(tmp,'.journal.lock'),owner={pid:process.pid,host:require('node:os').hostname(),id:require('node:crypto').randomUUID()},bytes=JSON.stringify(owner);
  fs.writeFileSync(file,bytes);const read=fs.readFileSync;
  fs.readFileSync=function(target){if(target===file)throw Object.assign(new Error('WINDOWS_CANONICAL_OPEN_DENIED'),{code:'EPERM'});return read.apply(this,arguments);};
  try{assert.throws(()=>storage.lock(tmp,true),/Журнал занят работающим процессом/);}
  finally{fs.readFileSync=read;}
  assert.equal(fs.readFileSync(file,'utf8'),bytes);fs.unlinkSync(file);assert.deepEqual(fs.readdirSync(tmp),[]);
 });
 check('ARCH-004: genuine permission failure reading an owner remains unknown and cannot reclaim it',()=>{
  const file=path.join(tmp,'.journal.lock'),bytes=JSON.stringify({pid:process.pid,host:require('node:os').hostname(),id:require('node:crypto').randomUUID()});
  fs.writeFileSync(file,bytes);const read=fs.readFileSync;
  fs.readFileSync=function(target){if(String(target).startsWith(file)&&String(target).endsWith('.reader'))throw Object.assign(new Error('OWNER_READ_DENIED'),{code:'EPERM'});return read.apply(this,arguments);};
  try{assert.throws(()=>storage.lock(tmp,true),/Владелец lock неизвестен/);}
  finally{fs.readFileSync=read;}
  assert.equal(fs.readFileSync(file,'utf8'),bytes);fs.unlinkSync(file);assert.deepEqual(fs.readdirSync(tmp),[]);
 });
}finally{c.close();}

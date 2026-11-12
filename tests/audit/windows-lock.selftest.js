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
  fs.readFileSync=function(target){if(target===file&&!injected){injected=true;throw Object.assign(new Error('Cached stat / disappearing path'),{code:'ENOENT'});}return read.apply(this,arguments);};
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
}finally{c.close();}

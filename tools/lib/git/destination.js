'use strict';
// Repository identity for local safety checks; remote ACLs remain authoritative.
const fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url');
function identity(cwd,address){
 if(typeof address!=='string'||!address.trim()||/[\r\n\0]/.test(address)||address.includes('::'))return null;
 try{
  let local;
  if(address.startsWith('file:'))local=fileURLToPath(new URL(address));
  else if(path.isAbsolute(address)||address.startsWith('.')||!address.includes(':'))local=address;
  if(local!==undefined){
   let resolved=path.resolve(cwd,local);if(fs.existsSync(resolved))resolved=fs.realpathSync(resolved);
   return 'file:'+ (process.platform==='win32'?resolved.toLowerCase():resolved);
  }
  const scp=address.match(/^(?:[^/@:]+@)?([^/:]+):(.+)$/);
  const url=new URL(address.includes('://')?address:scp?`ssh://${scp[1]}/${scp[2]}`:address);
  if(!['ssh:','https:','http:','git:'].includes(url.protocol)||url.search||url.hash)return null;
  const host=url.hostname.toLowerCase();let repo=decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g,'').replace(/\.git$/i,'');
  if(!repo||repo.split('/').some(x=>!x||x==='.'||x==='..'))return null;
  if(host==='github.com')repo=repo.toLowerCase();
  // Nonstandard ports cannot prove identity with another transport; deny own exemption.
  if(url.port&&!(url.protocol==='ssh:'&&url.port==='22'))return null;
  return 'remote:'+host+'/'+repo;
 }catch{return null;}
}
function isolated(cwd,own,common){
 const personal=own.map(address=>identity(cwd,address)),shared=common.map(address=>identity(cwd,address));
 return personal.length>0&&personal.every(Boolean)&&shared.every(Boolean)&&personal.every(id=>!shared.includes(id));
}
module.exports={identity,isolated};

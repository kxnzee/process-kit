'use strict';
// Git executes hooks through its POSIX shell on Windows, including non-.exe hooks.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
function invocation(file,args=[],platform=process.platform,gitExecPath=''){
 if(platform!=='win32'||/\.(exe|com)$/i.test(file))return {command:file,args};
 const candidates=['../../../usr/bin/sh.exe','../../../bin/sh.exe'].map(relative=>path.resolve(gitExecPath,relative));
 const shell=candidates.find(candidate=>fs.existsSync(candidate))||'sh';
 return {command:shell,args:['-c','exec "$@"','rockit-hook',file,...args]};
}
function runHook(file,args=[],options={}){
 let gitExecPath='';
 if(process.platform==='win32'&&!/\.(exe|com)$/i.test(file))gitExecPath=execFileSync('git',['--exec-path'],{cwd:options.cwd,encoding:'utf8'}).trim();
 const call=invocation(file,args,process.platform,gitExecPath);
 return spawnSync(call.command,call.args,options);
}
// Previous hook metadata survives a product rename; conflicting namespaces fail closed.
const hookBody=text=>text.replace(/\r\n/g,'\n').split('\n').filter(line=>line.trim()&&!line.trim().startsWith('#')).join('\n');
const sameBootstrap=(left,right)=>hookBody(left)===hookBody(right);
function forwardsToBootstrap(text,source){
 const lines=hookBody(text).split('\n').map(line=>line.trim());
 return hookBody(source).split('\n').some(line=>line.trim().startsWith('exec ')&&lines.includes(line.trim()));
}
function previousHook(cwd,event){
 const suffix={'pre-commit':'previousPreCommit','pre-push':'previousPrePush'}[event];
 if(!suffix)throw new Error('Неизвестный Git hook');
 const git=(...args)=>{try{return execFileSync('git',['config','--local',...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch(error){if(error.status===1)return '';throw error;}};
 const key='rockit.'+suffix;
 const keys=[...new Set(git('--name-only','--get-regexp','.').split(/\r?\n/).filter(name=>name.toLowerCase().endsWith('.'+suffix.toLowerCase())))];
 const files=[...new Set(keys.flatMap(name=>git('--get-all',name).split(/\r?\n/)).filter(Boolean))];
 if(files.length>1)throw new Error('Конфликт прежних Git hooks: согласуйте одну сохранённую проверку перед переустановкой');
 if(files.length){
  const file=path.resolve(cwd,files[0]),source=path.join(cwd,'.gigacode/hooks',event);
  const active=path.resolve(cwd,execFileSync('git',['rev-parse','--git-path','hooks/'+event],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim());
  if(file===active)throw new Error('Прежний Git hook указывает на текущую обёртку: рекурсия запрещена');
  if(!fs.existsSync(file))throw new Error('Прежний Git hook отсутствует: сначала восстановите сохранённую пользовательскую проверку');
  if(fs.existsSync(source)&&!/\.(exe|com)$/i.test(file)&&forwardsToBootstrap(fs.readFileSync(file,'utf8'),fs.readFileSync(source,'utf8')))throw new Error('Прежний Git hook является обёрткой RocKit: рекурсия запрещена');
 }
 return {key,keys,file:files[0]||''};
}
module.exports={runHook,invocation,previousHook,sameBootstrap,forwardsToBootstrap};

#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{root}=require('./paths');
const cwd=root(),git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
try{
 let custom='';try{custom=git('config','--get','core.hooksPath');}catch{}
 if(custom)throw new Error('Задан core.hooksPath: не меняю общие hooks. Согласуйте установку локальной защиты.');
 for(const [name,marker,key]of [['pre-push','Process Kit pre-push v2','processkit.previousPrePush'],['pre-commit','Process Kit pre-commit v1','processkit.previousPreCommit']]){
  const hook=path.resolve(cwd,git('rev-parse','--git-path','hooks/'+name)),source=fs.readFileSync(path.join(cwd,'.gigacode/hooks',name),'utf8');
  fs.mkdirSync(path.dirname(hook),{recursive:true});
  if(fs.existsSync(hook)&&!fs.readFileSync(hook,'utf8').includes(marker)){
   const backup=hook+'.before-process-kit';if(fs.existsSync(backup))throw new Error('Резервный hook уже существует: не перезаписываю '+name);
   fs.copyFileSync(hook,backup);fs.chmodSync(backup,0o755);git('config','--local',key,backup);
  }
  fs.writeFileSync(hook,source.replace(/\r\n/g,'\n'),{mode:0o755});fs.chmodSync(hook,0o755);
 }
 console.log('Защита коммита и отправки установлена в этой копии.');
}catch(error){console.error(error.message);process.exitCode=1;}

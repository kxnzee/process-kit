#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{root}=require('../core/paths');
const cwd=root(),git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const {previousHook,sameBootstrap,forwardsToBootstrap}=require('./git-hook');
try{
 let custom='';try{custom=git('config','--get','core.hooksPath');}catch{}
 if(custom)throw new Error('Задан core.hooksPath: не меняю общие hooks. Согласуйте установку локальной защиты.');
 const plans=[];
 // Check both hooks before replacing either one; a known conflict leaves both intact.
 for(const name of ['pre-push','pre-commit']){
  const hook=path.resolve(cwd,git('rev-parse','--git-path','hooks/'+name)),source=fs.readFileSync(path.join(cwd,'.gigacode/hooks',name),'utf8');
  const entry=fs.lstatSync(hook,{throwIfNoEntry:false});
  if(entry&&!entry.isFile())throw new Error('Установленный '+name+' не является обычным файлом: ссылку или каталог не меняю');
  const previous=previousHook(cwd,name),existing=entry?fs.readFileSync(hook,'utf8'):'';
  const owned=!!entry&&sameBootstrap(existing,source);
  if(entry&&!owned&&forwardsToBootstrap(existing,source))throw new Error('Установленный '+name+' — изменённая обёртка RocKit: сначала согласуйте сохранение пользовательских проверок');
  if(entry&&!owned&&previous.file)throw new Error('Установленный '+name+' не совпадает с защитой RocKit: сначала восстановите прежнюю цепочку hooks');
  const backup=entry&&!owned?hook+'.before-rockit':null;
  if(backup&&fs.lstatSync(backup,{throwIfNoEntry:false}))throw new Error('Резервный hook уже существует: не перезаписываю '+name);
  plans.push({hook,source,previous,backup});
 }
 for(const {hook,source,previous,backup}of plans){
  fs.mkdirSync(path.dirname(hook),{recursive:true});
  if(backup){fs.copyFileSync(hook,backup,fs.constants.COPYFILE_EXCL);fs.chmodSync(backup,0o755);previous.file=backup;}
  fs.writeFileSync(hook,source.replace(/\r\n/g,'\n'),{mode:0o755});fs.chmodSync(hook,0o755);
  if(previous.file)git('config','--local',previous.key,previous.file);
  for(const key of previous.keys.filter(key=>key.toLowerCase()!==previous.key.toLowerCase()))git('config','--local','--unset-all',key);
 }
 console.log('Защита коммита и отправки установлена в этой копии.');
}catch(error){console.error(error.message);process.exitCode=1;}

#!/usr/bin/env node
'use strict';
// Scan the Git index, not the working tree. This is commit protection, not a test suite.
const {execFileSync}=require('node:child_process'),{root}=require('../core/paths');
function problems(file,text){
 const issues=[];
 if(/(^|\/)(?:outputs|\.history)\//.test(file)||/(^|\/)\.env(?:\.|$)/.test(file))issues.push('локальные данные/доступы не коммитятся');
 const patterns=[new RegExp('gl'+'pat-[A-Za-z0-9_-]{10,}'),new RegExp('gh'+'[psu]_[A-Za-z0-9]{20,}'),new RegExp('xox'+'[abp]-[A-Za-z0-9-]{10,}'),/\bAKIA[0-9A-Z]{16}\b/,/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/Bearer\s+[A-Za-z0-9+/=._-]{20,}/];
 if(patterns.some(re=>re.test(text)))issues.push('возможный секрет');
 if(file.endsWith('settings.json')){
  let value;try{value=JSON.parse(text);}catch{issues.push('неверный JSON настроек');return issues;}
  function walk(obj,key=''){if(obj&&typeof obj==='object'){for(const [name,item]of Object.entries(obj))walk(item,name);return;}if(/token|password|passwd|api[-_]?key|authorization|secret/i.test(key)&&(typeof obj!=='string'||!/^(?:Bearer )?\$secret:[\w.-]+\/[\w.-]+$/.test(obj)))issues.push('доступ должен быть ссылкой на секрет');}
  walk(value);
 }
 return [...new Set(issues)];
}
function staged(cwd){
 const git=(...args)=>execFileSync('git',args,{cwd,stdio:['ignore','pipe','pipe']}),names=git('diff','--cached','--name-only','--diff-filter=ACMR','-z').toString().split('\0').filter(Boolean);
 return names.flatMap(file=>problems(file,git('show',':'+file).toString()).map(reason=>({file,reason})));
}
module.exports={problems,staged};
if(require.main===module){try{
 if(process.argv.length!==2)throw new Error('commit-guard.js проверяет только подготовленный индекс');
 const cwd=root(),issues=staged(cwd);if(issues.length){for(const row of issues)console.error(`${row.file}: ${row.reason}. Значение секрета не выводится.`);process.exitCode=1;}else{
  let previous='';try{previous=execFileSync('git',['config','--local','processkit.previousPreCommit'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
  if(previous){const result=require('./git-hook').runHook(previous,[],{cwd,stdio:'inherit'});if(result.error||result.status!==0)throw new Error('Прежняя проверка коммита отклонила действие');}
 }
}catch(error){console.error(error.message);process.exitCode=1;}}

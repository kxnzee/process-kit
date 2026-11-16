#!/usr/bin/env node
'use strict';
const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const cwd=path.join(__dirname,'..');
const checkArgs=process.argv.slice(2);
for(let i=0;i<checkArgs.length;i+=2){
 if(!['--level','--team'].includes(checkArgs[i])||!checkArgs[i+1]||checkArgs[i+1].startsWith('--')){
  console.error('Использование: node tools/kit.js test [--level master|team|my] [--team <код>]');process.exit(2);
 }
}
function suites(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(item=>item.isDirectory()?suites(path.join(dir,item.name)):item.name.endsWith('.selftest.js')?[path.join(dir,item.name)]:[]);}
let failed=false;
const validator=path.join(cwd,'tools/lib/validation/validate.js');
for(const file of [validator,...suites(__dirname)]){
 console.log('\n'+path.relative(cwd,file));
 const result=spawnSync(process.execPath,[file,...(file===validator?checkArgs:[])],{cwd,stdio:'inherit'});
 if(result.error||result.status!==0){failed=true;console.error(`${path.relative(cwd,file)}: exit=${result.status}; signal=${result.signal||'none'}`);if(result.error)console.error(result.error.message);}
}
if(failed){console.error('\nЕсть ошибки: смотрите результаты наборов выше.');process.exitCode=1;}
else console.log('\nОсновные проверки структуры, архитектуры и контрактов пройдены.');

#!/usr/bin/env node
'use strict';
const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const cwd=path.join(__dirname,'..');
function suites(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(item=>item.isDirectory()?suites(path.join(dir,item.name)):item.name.endsWith('.selftest.js')?[path.join(dir,item.name)]:[]);}
let failed=false;
for(const file of [path.join(cwd,'tools/lib/validation/validate.js'),...suites(__dirname)]){
 console.log('\n'+path.relative(cwd,file));
 const result=spawnSync(process.execPath,[file],{cwd,stdio:'inherit'});
 if(result.error||result.status!==0){failed=true;console.error(`${path.relative(cwd,file)}: exit=${result.status}; signal=${result.signal||'none'}`);if(result.error)console.error(result.error.message);}
}
if(failed){console.error('\nЕсть ошибки: смотрите результаты наборов выше.');process.exitCode=1;}
else console.log('\nОсновные проверки структуры, архитектуры и контрактов пройдены.');

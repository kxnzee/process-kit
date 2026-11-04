#!/usr/bin/env node
'use strict';
const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const cwd=path.join(__dirname,'..');
function suites(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(item=>item.isDirectory()?suites(path.join(dir,item.name)):item.name.endsWith('.selftest.js')?[path.join(dir,item.name)]:[]);}
for(const file of [path.join(cwd,'tools/lib/validation/validate.js'),...suites(__dirname)]){
 console.log('\n'+path.relative(cwd,file));
 const result=spawnSync(process.execPath,[file],{cwd,stdio:'inherit'});
 if(result.error||result.status!==0)process.exit(result.status||1);
}
console.log('\nОсновные проверки структуры, архитектуры и контрактов пройдены.');

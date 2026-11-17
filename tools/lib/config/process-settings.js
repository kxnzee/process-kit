'use strict';
// Настройки одного процесса — файл ближнего уровня: config/<уровень>/processes/<имя процесса>.json.
// Файл не вводит новых параметров: заполнять можно только имена, объявленные в params процесса,
// поэтому рецепт процесса остаётся единственным описанием того, что вообще настраивается.
const fs=require('node:fs');
const {inside}=require('../core/safe-path');
const {NAME}=require('../entities/process-model');
const LEVELS=['master','team','my'];
const SECRET_KEY=/token|password|passwd|secret|api[-_]?key|authorization/i;
const file=(level,name)=>`config/${level}/processes/${name}.json`;
function secrets(value,where){
 for(const [key,item]of Object.entries(value)){
  if(SECRET_KEY.test(key))throw new Error(where+': секреты не являются параметрами');
  if(item!==null&&typeof item==='object')secrets(item,where+'.'+key);
 }
}
function read(cwd,level,name,declared=[]){
 require('../entities/entities').levels([level],'уровень настроек процесса');
 if(!NAME.test(name||''))throw new Error('Неверное имя процесса для файла настроек');
 const rel=file(level,name),full=inside(cwd,rel);
 if(!fs.existsSync(full))return null;
 let data;
 try{data=JSON.parse(fs.readFileSync(full,'utf8'));}catch(error){throw new Error(rel+': нужно прочитать как JSON — '+error.message);}
 if(data===null||typeof data!=='object'||Array.isArray(data))throw new Error(rel+': нужен объект параметров процесса');
 secrets(data,rel);
 const allowed=new Set(declared);
 for(const key of Object.keys(data))if(!allowed.has(key))throw new Error(rel+': параметр '+key+' не объявлен в params процесса '+name);
 return data;
}
function merge(cwd,name,declared=[],wanted=[]){
 require('../entities/entities').levels(wanted,'requires.config');
 if(!NAME.test(name||''))throw new Error('Неверное имя процесса для файла настроек');
 const params={},origins={},files=[];
 if(!wanted.length)return {params,origins,files};
 const config=require('./config').loadConfig(cwd,wanted);
 files.push(...config.files);
 for(const level of LEVELS.filter(level=>wanted.includes(level)&&config.files.includes(require('./config').FILES[level]))){
  const data=read(cwd,level,name,declared);if(data===null)continue;
  const rel=file(level,name);files.push(rel);
  for(const [key,value]of Object.entries(data)){params[key]=value;origins[key]=rel;}
 }
 return {params,origins,files};
}
module.exports={LEVELS,file,read,merge};

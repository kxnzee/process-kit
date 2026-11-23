'use strict';
// One input reader for existing CLI commands. It never creates or deletes files.
const fs=require('node:fs');
function readSpec(args,{usage,flags={},lists=[],allowFull=false}){
 const full=args.filter(arg=>arg==='--full').length;
 if(full&&(!allowFull||full!==1))throw new Error(usage);
 const rest=args.filter(arg=>arg!=='--full');let spec;
 function parse(text){
  let value;try{value=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('SPEC_JSON: нужен корректный JSON-объект; содержимое не выводится.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('SPEC_OBJECT: нужен JSON-объект параметров.');
  return value;
 }
 if(rest.length===1&&rest[0]==='--stdin'){
  if(process.stdin.isTTY)throw new Error('SPEC_STDIN: передайте JSON-объект через stdin.');
  spec=parse(fs.readFileSync(0,'utf8'));
 }else if(rest.length===1&&!rest[0].startsWith('--')){
  let body;try{body=fs.readFileSync(rest[0],'utf8');}
  catch(error){
   let literal=false;
   if(error.code==='ENOENT')try{const value=JSON.parse(rest[0]);literal=!!value&&typeof value==='object';}catch{ /* Имя файла тоже может начинаться со скобки. */ }
   if(literal)throw new Error('SPEC_ARGUMENT: получен JSON-текст вместо пути; используйте --stdin или существующий JSON-файл.');
   throw new Error(error.code==='ENOENT'?'SPEC_FILE_NOT_FOUND: файл spec не найден; сначала сохраните JSON-файл или используйте --stdin.':'SPEC_READ: не удалось прочитать файл spec.');
  }
  spec=parse(body);
 }else{
  spec={};if(!rest.length||rest.length%2)throw new Error(usage);
  for(let i=0;i<rest.length;i+=2){
   const [flag,value]=rest.slice(i,i+2),key=flags[flag];
   if(!Object.hasOwn(flags,flag)||value.startsWith('--'))throw new Error(usage);
   if(lists.includes(key))(spec[key]||=[]).push(value);
   else{if(Object.hasOwn(spec,key))throw new Error('SPEC_DUPLICATE: параметр '+flag+' передан повторно.');spec[key]=value;}
  }
 }
 return {spec,full:!!full};
}
module.exports={readSpec};

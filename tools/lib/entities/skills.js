'use strict';
const fs=require('node:fs');
const {inside}=require('../core/safe-path'),{parseFrontmatter}=require('../core/markdown');
function catalog(cwd){
 const folder='.gigacode/skills';
 return fs.readdirSync(inside(cwd,folder),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort().map(name=>{
  const file=`${folder}/${name}/SKILL.md`,parsed=parseFrontmatter(fs.readFileSync(inside(cwd,file),'utf8'));
  const data=parsed.data;
  if(parsed.error||!data||data.name!==name||typeof data.description!=='string'||!data.description.trim())throw new Error('Неверная шапка скилла: '+file);
  return {name:data.name,description:data.description,file};
 });
}
module.exports={catalog};
if(require.main===module){
 if(process.argv.length!==2){console.error('Использование: node tools/kit.js skills');process.exitCode=2;}
 else try{console.log(JSON.stringify(catalog(process.cwd()),null,2));}catch{console.error('Не удалось прочитать каталог скиллов. Проверьте папки и шапки SKILL.md.');process.exitCode=1;}
}

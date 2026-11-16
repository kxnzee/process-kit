'use strict';
// Discovery facts only. Never validate a route, load its executable modules or check the network.
const fs=require('node:fs');
const {inside}=require('../core/safe-path'),{parseFrontmatter}=require('../core/markdown');
const {NAME,owner}=require('./process-model');
const {scopeFor,visible,publicationFacts}=require('./process-facts');

function catalog(cwd,options={}){
 const {all=false,...scopeOptions}=options;
 if(typeof all!=='boolean')throw new Error('all должен быть boolean');
 const issues=[];
 const issue=(code,file)=>issues.push({code,...(file?{file}:{})});
 const scope=scopeFor(cwd,scopeOptions,issue);
 const processes=[];
 // Failure to read the root is fatal; a broken visible entry produces an explicit partial catalog.
 const entries=fs.readdirSync(inside(cwd,'processes'),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
 for(const entry of entries){
  const ownership=owner(entry.name);
  if(!visible(entry.name,scope))continue;
  if(!options.all&&entry.name==='example')continue;
  if(!NAME.test(entry.name)){if(entry.isDirectory()||entry.isSymbolicLink())issue('invalid-entry');continue;}
  if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
  const file=`processes/${entry.name}/PROCESS.md`;
  let data,examples;
  try{
   const parsed=parseFrontmatter(fs.readFileSync(inside(cwd,file),'utf8'));data=parsed.data;
   examples=data?.examples??data?.example;examples=Array.isArray(examples)?examples:[examples];
   if(parsed.error||!data||data.name!==entry.name||typeof data.description!=='string'||!data.description.trim()||data.title!==undefined&&(typeof data.title!=='string'||!data.title.trim())||!['действует','устарел'].includes(data.status)||!examples.length||examples.some(value=>typeof value!=='string'||!value.trim()))throw new Error('Invalid metadata');
  }catch{issue('metadata-unavailable',file);continue;}
  if(!options.all&&data.status==='устарел')continue;
  const publication=publicationFacts(cwd,entry.name,scope,issue);
  processes.push({name:data.name,file,title:data.title||data.name,description:data.description,examples,level:['master','team','my'][ownership.level],teamId:ownership.team,educational:entry.name==='example',status:data.status,publication});
 }
 return {version:1,view:options.all?'all':'work',complete:issues.length===0,scope,processes,issues};
}
module.exports={catalog};
if(require.main===module){
 try{
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){const key=args[i];if(key==='--all'){if(options.all)throw new Error('Arguments');options.all=true;continue;}if(!['--level','--team'].includes(key)||!args[i+1]||args[i+1].startsWith('--')||Object.hasOwn(options,key.slice(2)))throw new Error('Arguments');options[key.slice(2)]=args[++i];}
  console.log(JSON.stringify(catalog(process.cwd(),options),null,2));
 }catch{console.error('Не удалось получить каталог процессов. Использование: node tools/kit.js processes [--all] [--level master|team|my] [--team <код>]. Проверьте корень копии и область просмотра.');process.exitCode=1;}
}

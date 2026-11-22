'use strict';
// Safe placeholder locations, never configuration values or arbitrary property names.
const fs=require('node:fs');
const {inside}=require('../core/safe-path');
const keys=new Set('schemaVersion team id name owners profile email teamId storage mode repositoryUrl taskStores codeStores defaults preferences kind adapter displayName mcpServer enabled baseUrl issueUrlTemplate projects issueTypes statusesExclude modules code capabilities limits jqlMustIncludeIssueType getIssuesBatchMax pageSize pullRequestUrlTemplate repositories projectKey slug defaultBranch url acceptTargetBranches pullRequest keyExtraction fields pattern ignorePatterns taskStore codeStore project repository'.split(' '));
const todo=value=>typeof value==='string'&&/\bTODO\b/i.test(value);
function locations(value,at=''){
 if(todo(value))return [at];
 if(Array.isArray(value))return value.flatMap((item,index)=>locations(item,at+'['+index+']'));
 if(value&&typeof value==='object')return Object.entries(value).flatMap(([key,item])=>locations(item,at+(at?'.':'')+(keys.has(key)?key:'*')));
 return [];
}
function inspect(cwd,files){
 const result={state:files.length?'ready':'missing',files:[],missing:[]};
 for(const file of files){
  try{
   const full=inside(cwd,file);if(!fs.existsSync(full)){result.state='incomplete';result.missing.push({file,field:'config'});continue;}
   result.files.push(file);const data=JSON.parse(fs.readFileSync(full,'utf8'));
   for(const field of new Set(locations(data)))result.missing.push({file,field});
  }catch{result.state='unknown';}
 }
 if(result.missing.length&&result.state!=='unknown')result.state='incomplete';
 return result;
}
module.exports={todo,locations,inspect};

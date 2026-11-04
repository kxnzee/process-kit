'use strict';
const fs=require('node:fs'),{inside}=require('../core/safe-path'),{owner}=require('./process-model');
function contextFile(cwd,processName,ref){
 if(typeof ref!=='string')throw new Error('Нужен точный путь контекста');
 const file=ref.startsWith('context/')?ref:'context/'+ref;
 const match=file.match(/^context\/(master|team|my)\/([a-z0-9][a-z0-9-]*)\/CONTEXT\.md$/);
 if(!match||match[2]==='example')throw new Error('Неверный путь рабочего контекста: '+file);
 const level={master:0,team:1,my:2}[match[1]],caller=owner(processName);
 if(level>caller.level)throw new Error('Контекст нижнего уровня запрещён: '+file);
 if(level===1){const teamId=require('../config/config').loadConfig(cwd).teamId;if(!teamId||caller.level===1&&caller.team!==teamId)throw new Error('Контекст team не принадлежит выбранной команде');}
 if(!fs.statSync(inside(cwd,file)).isFile())throw new Error('Нет контекста '+file);return file;
}
function contextLevel(cwd,processName,level){
 require('./entities').levels([level],'requires.context');
 // Validate access even if this level has no topics yet.
 const caller=owner(processName),rank={master:0,team:1,my:2}[level];
 if(rank>caller.level)throw new Error('Контекст нижнего уровня запрещён: '+level);
 if(level==='team'){const id=require('../config/config').loadConfig(cwd).teamId;if(!id||caller.level===1&&caller.team!==id)throw new Error('Контекст team не принадлежит выбранной команде');}
 const dir=inside(cwd,'context/'+level);
 return fs.readdirSync(dir,{withFileTypes:true}).filter(item=>item.name!=='example'&&item.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)).map(item=>contextFile(cwd,processName,`${level}/${item.name}/CONTEXT.md`));
}
module.exports={contextFile,contextLevel};

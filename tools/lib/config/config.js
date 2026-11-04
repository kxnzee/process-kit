'use strict';
const fs=require('node:fs');
const {inside}=require('../core/safe-path');
const {validateValue}=require('../contracts/value-contract');
const FILES={master:'config/master/config.json',team:'config/team/config.json',my:'config/my/config.json'};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const DEFAULTS=new Set(['taskStore','codeStore','project','repository']);
function loadMaster(cwd){
 const master=JSON.parse(fs.readFileSync(inside(cwd,FILES.master),'utf8'));
 validateValue(require('./config-contract').master,master);return master;
}
function loadConfig(cwd,levels=['master','team','my']){
 require('../entities/entities').levels(levels,'requires.config');
 const files=[],read=(file,optional=true)=>{if(!fs.existsSync(inside(cwd,file))){if(optional)return null;throw new Error('Нет '+file);}files.push(file);const data=JSON.parse(fs.readFileSync(inside(cwd,file),'utf8'));if(!object(data)||data.schemaVersion!==2)throw new Error(file+': нужен schemaVersion 2');return data;};
 const master=loadMaster(cwd),my=levels.includes('my')?read(FILES.my):null;files.unshift(FILES.master);
 const schemas=require('./config-contract');
 if(my)validateValue(schemas.my,my);
 if(my){for(const key of Object.keys(my))if(!['schemaVersion','teamId','taskStores','codeStores','defaults','preferences','profile','storage'].includes(key))throw new Error('Неизвестное личное поле '+key);if(my.teamId!==null&&my.teamId!==undefined&&(typeof my.teamId!=='string'||!my.teamId.trim()||my.teamId==='TODO'))throw new Error('Неверный my.teamId');if(my.preferences!==undefined&&!object(my.preferences))throw new Error('preferences: нужен объект');}
 if(my&&[my.profile.name,my.profile.email].some(value=>/^TODO/.test(value)))throw new Error('profile: нужны подтверждённые имя и email');
 if(my?.storage?.mode==='repository'&&(!my.storage.repositoryUrl||/^TODO/.test(my.storage.repositoryUrl)))throw new Error('storage.repositoryUrl: нужен подтверждённый адрес личного репозитория');
 if(my?.storage?.mode==='local'&&my.storage.repositoryUrl)throw new Error('storage.repositoryUrl не задаётся для local');
 const team=!levels.includes('team')||my&&Object.hasOwn(my,'teamId')&&my.teamId===null?null:read(FILES.team);
 if(team){validateValue(schemas.team,team);for(const key of Object.keys(team))if(!['schemaVersion','team','taskStores','codeStores','defaults'].includes(key))throw new Error('Неизвестное командное поле '+key);if(!object(team.team)||typeof team.team.id!=='string'||!team.team.id.trim()||typeof team.team.name!=='string'||!Array.isArray(team.team.owners))throw new Error('team: нужны id, name, owners');}
 if(team&&!/^[a-z0-9]+$/.test(team.team.id))throw new Error('Неверный team.id');
 if(levels.includes('team')&&my?.teamId&&my.teamId!==team?.team.id)throw new Error('Выбранная команда '+my.teamId+' не совпадает с config/team/config.json');
 for(const [where,data]of [['team',team],['my',my]])if(data){for(const collection of ['taskStores','codeStores'])if(data[collection]!==undefined&&!Array.isArray(data[collection]))throw new Error(where+'.'+collection+': нужен массив');if(data.defaults!==undefined&&!object(data.defaults))throw new Error(where+'.defaults: нужен объект');for(const key of Object.keys(data.defaults||{}))if(!DEFAULTS.has(key))throw new Error('Неизвестный default '+where+'.'+key);}
 const result={schemaVersion:2,team:team?.team||null,teamId:team?.team.id||null,taskStores:[],codeStores:[],defaults:{...(levels.includes('master')?master.defaults:{}),...team?.defaults,...my?.defaults},execution:{...master.execution},preferences:my?.preferences||{},profile:my?.profile||null,storage:my?.storage||null,files,origins:{}};
 function scan(value,scope){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(/token|password|passwd|secret|api[-_]?key|authorization/i.test(key))throw new Error('Секреты не хранятся в '+scope);if(scope==='team'&&/^(localPath|checkoutPath|workdir|cwd)$/i.test(key))throw new Error('Локальные пути компьютера не хранятся в team');scan(item,scope);}}
 scan(team,'team');scan(my,'my');
 for(const [slot,key]of [['taskStore','project'],['codeStore','repository']])if(my?.defaults?.[slot]&&my.defaults[slot]!==team?.defaults?.[slot]&&!Object.hasOwn(my.defaults,key))delete result.defaults[key];
 const ids=new Set();
 for(const [where,data]of [['team',team],['my',my]])for(const collection of ['taskStores','codeStores'])for(const entry of data?.[collection]||[]){if(!object(entry)||typeof entry.id!=='string'||!entry.id.trim())throw new Error(collection+': нужен непустой id');if(ids.has(entry.id))throw new Error('повтор id '+entry.id+': личные записи не переопределяют командные');ids.add(entry.id);result[collection].push({...entry});result.origins[entry.id]=where;}
 // Selection values are checked by the caller against the explicitly selected store.
 return result;
}
function selectedStore(config,slot,explicit){
 const collection=slot==='taskStore'?'taskStores':slot==='codeStore'?'codeStores':null;if(!collection)throw new Error('Неизвестный тип подключения');
 const id=explicit??config.defaults[slot],entry=config[collection].find(item=>item.id===id);
 if(!entry)throw new Error('не найдена выбранная запись '+collection+': '+(id||'id не задан')+'; нужна настройка');
 if(entry.enabled===false)throw new Error('подключение '+id+' выключено');return entry;
}
function selectedResource(config,slot,entry){
 const key=slot==='taskStore'?'project':'repository';
 if(entry.id!==config.defaults[slot]||!config.defaults[key])return undefined;
 const value=config.defaults[key];
 const known=slot==='taskStore'?entry.projects?.includes(value):entry.repositories?.some(repo=>`${repo.projectKey}/${repo.slug}`===value);
 if(!known)throw new Error('defaults.'+key+': ресурс не входит в выбранное подключение '+entry.id);return value;
}
function requiredFields(cwd,processName,params){
 const fields=['baseUrl'];
 if(params.queryFile){require('../actions/query-file').queryFile(cwd,processName,params.queryFile);const parsed=require('../core/markdown').parseFrontmatter(fs.readFileSync(inside(cwd,params.queryFile),'utf8'));if(parsed.error)throw new Error(parsed.error);const declared=parsed.data?.configFields||[];if(!Array.isArray(declared)||declared.some(field=>typeof field!=='string'||!field.trim()))throw new Error('configFields запроса: нужен список полей');fields.push(...declared);}
 return [...new Set(fields)];
}
function resolveStore(cwd,config,slot,explicit,fields=[]){
 const entry=selectedStore(config,slot,explicit),collection=slot+'s';
 function values(obj,parts){if(!parts.length)return [obj];const [part,...rest]=parts;if(part.endsWith('[]')){const list=obj?.[part.slice(0,-2)];return Array.isArray(list)&&list.length?list.flatMap(item=>values(item,rest)):[undefined];}return values(obj?.[part],rest);}
 const empty=value=>value==null||value===''||typeof value==='string'&&/^TODO/i.test(value)||Array.isArray(value)&&(!value.length||value.some(empty));
 const missing=[];
 for(const field of ['adapter','mcpServer',...fields]){if(field.startsWith('modules[]')&&Array.isArray(entry.modules)&&!entry.modules.length)continue;if(values(entry,field.split('.')).some(empty))missing.push(`${collection}[${entry.id}].${field} не заполнено`);}
 if(missing.length)throw new Error(missing.join('; '));
 const name=String(entry.adapter).replace(/^adapters\//,'').replace(/\/ADAPTER\.md$/,'');
 if(!/^[a-z0-9][a-z0-9-]*$/.test(name))throw new Error('Неверный адаптер '+entry.adapter);
 const adapterFile=`adapters/${name}/ADAPTER.md`;
 if(!fs.existsSync(inside(cwd,adapterFile)))throw new Error('нет подключения '+entry.adapter);
 return {id:entry.id,configFile:FILES[config.origins[entry.id]],adapterFile,mcpServer:entry.mcpServer,fields,settings:entry};
}
function resolveProcess(cwd,name,params={},overrides=params){
 const {processModel,NAME}=require('../entities/process-model'),{stepParams,childParams,action}=require('../entities/process-dependencies');
 if(!NAME.test(name||'')||!object(params))throw new Error('Нужны имя процесса и объект параметров');
 const configFiles=new Set(),connections=[],missing=[],visiting=new Set(),maxDepth=loadMaster(cwd).execution.maxProcessDepth;
 function visit(process,inherited,depth){
  if(visiting.has(process)||depth>=maxDepth)throw new Error('Цикл или глубина подпроцессов');visiting.add(process);
  const model=processModel(fs.readFileSync(inside(cwd,`processes/${process}/PROCESS.md`),'utf8'));
  if(model.errors.length)throw new Error(model.errors.join('; '));
  require('../entities/entities').declarations(cwd,process,model);
  const values={...model.data.params,...inherited};
  for(const step of model.steps){
   if(step.kind==='process'){visit(step.ref,childParams(cwd,model,step,values,{},overrides),depth+1);continue;}
   if(step.kind!=='action')continue;
   const meta=action(cwd,step.ref);if(meta.kind==='transform')continue;
   for(const slot of ['taskStore','codeStore'].filter(slot=>meta.consumes.params.includes(slot))){
    try{
     const levels=model.data.requires?.config||[];if(!levels.length)throw new Error('requires.config не объявлен для сетевого шага');
     const config=loadConfig(cwd,levels),effective=stepParams(values,step,overrides),fields=requiredFields(cwd,process,effective);
     for(const file of config.files)configFiles.add(file);
     const selected=resolveStore(cwd,config,slot,effective[slot],fields);
     connections.push({process,step:step.name,slot,...selected});
    }catch(error){missing.push({process,step:step.name,slot,reason:error.message});}
   }
  }
  visiting.delete(process);
 }
 visit(name,params,0);
 return {ready:missing.length===0,process:name,configFiles:[...configFiles],connections,readFiles:[...new Set(connections.map(item=>item.adapterFile))],missing,note:'Доступность MCP-инструментов проверяется отдельно в среде агента.'};
}
module.exports={FILES,loadMaster,loadConfig,selectedStore,selectedResource,requiredFields,resolveStore,resolveProcess};

if(require.main===module){
 try{
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--json')console.log(JSON.stringify(loadConfig(process.cwd()),null,2));
  else if(args[0]==='--process'&&args[1]&&(args.length===2||args.length===4&&args[2]==='--params')){
   const params=args[2]?JSON.parse(fs.readFileSync(args[3],'utf8')):{};
   const result=resolveProcess(process.cwd(),args[1],params);console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=1;
  }else throw new Error('Использование: node tools/kit.js config --json | --process <имя> [--params <JSON-файл>]');
 }catch(error){console.error(error.message);process.exitCode=1;}
}

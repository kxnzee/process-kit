'use strict';
// Direct local function calls do not create a process or a process journal.
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process'),{action}=require('../entities/process-dependencies'),{runtime}=require('./action-runtime'),{validateArtifact}=require('../contracts/artifact-contract'),{inside}=require('../core/safe-path'),{root,validRunFolderName,validResultName}=require('../core/paths');
function invoke(cwd,spec){
 if(!spec||typeof spec!=='object'||Array.isArray(spec))throw new Error('Нужен объект spec');
 for(const key of ['params','inputs'])if(spec[key]!==undefined&&(!spec[key]||typeof spec[key]!=='object'||Array.isArray(spec[key])))throw new Error(key+': нужен объект');
 const meta=action(cwd,spec.action);if(meta.kind!=='transform'||spec.mode!==undefined&&spec.mode!=='local')throw new Error('Прямой вызов поддерживает локальные transform; сетевой сценарий выполняйте процессом');
 let caller=spec.action;try{const branch=execFileSync('git',['branch','--show-current'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();caller=branch==='my'?'my-invocation':/^team-[a-z0-9]+$/.test(branch)?branch+'-invocation':'direct-invocation';}catch{}
 if(!require('../entities/process-model').allowedReference(caller,spec.action))throw new Error('Экшен нижнего уровня недоступен в этой ветке');
 const requires={actions:[spec.action],context:[...new Set([...(meta.requires?.context||[]),...(spec.context||[])])],config:[]};require('../entities/entities').levels(requires.context,'requires.context');
 for(const key of Object.keys(spec.params||{}))if(!meta.consumes.params.includes(key))throw new Error('Необъявленный аргумент экшена: '+key);
 const params={...meta.defaults,...spec.params};if(spec.inputText!==undefined)params.inputText=spec.inputText;
 const inputs=spec.inputs||{};for(const name of meta.consumes.artifacts)if(!Object.hasOwn(inputs,name))throw new Error('Нет входа '+name);
 const ctx={cwd,actionName:spec.action,processName:caller,meta,params,inputs,requires,mode:'local'},policy=runtime(cwd,spec.action,meta);
 const files=policy.dependencies?.(ctx)||[];Object.assign(params,policy.prepare?.(ctx)||{});
 const port=Object.keys(meta.produces)[0],extension=meta.contracts[port]==='text'?'md':'json';
 if(spec.value===undefined)return {status:'needs-model',action:spec.action,readFiles:[`actions/${spec.action}/ACTION.md`,...files],params,inputs,port,extension,instruction:'Вы выполните рецепт экшена; повторите kit.js action с теми же аргументами и фактическим value. Процесс создавать не нужно.'};
 let value=spec.value;if(policy.normalize)value=policy.normalize({...ctx,value});validateArtifact(cwd,spec.action,port,extension,value,ctx);
 let file=null;
 if(spec.resultFile!==undefined){if(typeof spec.resultFile!=='string')throw new Error('resultFile должен быть путём');const parts=spec.resultFile.split('/');if(parts.length!==3||parts[0]!=='outputs'||!validRunFolderName(parts[1])||!validResultName(parts[2])||parts[2]==='итог.md')throw new Error('resultFile: нужен outputs/<дата>_<имя>/<результат>.md|txt|json|html');file=spec.resultFile;const target=inside(cwd,file);fs.mkdirSync(inside(cwd,'outputs'),{recursive:true});fs.mkdirSync(inside(cwd,'outputs/'+parts[1]));const bytes=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});fs.writeFileSync(inside(cwd,'outputs/'+parts[1]+'/.action.json'),JSON.stringify({schemaVersion:1,action:spec.action,port,resultName:parts[2],sha256:crypto.createHash('sha256').update(bytes).digest('hex'),mode:'local'},null,2)+'\n',{flag:'wx',mode:0o600});}
 return {status:'completed',action:spec.action,port,value,resultFile:file?inside(cwd,file):null,outputDir:file?require('node:path').dirname(inside(cwd,file)):null,note:'Локальный экшен; внешние изменения не выполнялись. Журнал процесса не создавался.'};
}
module.exports={invoke};
if(require.main===module){try{const [file,...rest]=process.argv.slice(2);if(!file||rest.length)throw new Error('node tools/kit.js action <spec.json>');console.log(JSON.stringify(invoke(root(),JSON.parse(fs.readFileSync(file,'utf8'))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}

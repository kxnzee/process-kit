#!/usr/bin/env node
'use strict';
// GigaCode integration boundary. Uses files and Node only; no private harness API or loop.
const fs=require('node:fs'),crypto=require('node:crypto');
const controller=require('../runtime/run-journal'),{root}=require('../core/paths');
const commands=['start','next','choose','recover','retry','execute','enter','leave','begin','save','finish','fail','publish','diagnose'];
function environment(mode){
 return {
  files:['tools/lib/integrations/gigacode-run.js',...(mode==='live'?['.gigacode/settings.json']:[])],
  fingerprint(file,body){
   // Permissions may grow after user consent; connection/server settings must stay unchanged.
   if(file==='.gigacode/settings.json')try{const value=JSON.parse(body.toString());delete value.permissions;body=Buffer.from(JSON.stringify(value));}catch{ /* Invalid JSON is compared byte for byte. */ }
   return crypto.createHash('sha256').update(body).digest('hex');
  }
 };
}
function run(cwd,command,spec){
 if(!commands.includes(command))throw new Error('Неизвестная операция run');
 if(!spec||typeof spec!=='object'||Array.isArray(spec))throw new Error('Нужен объект spec');
 if(command!=='start'){
  const match=typeof spec.output==='string'&&spec.output.match(/^outputs[/\\]([^/\\]+)[/\\]?$/);
  const output=match?match[1]:spec.output;
  if(!require('../core/paths').validRunFolderName(output))throw new Error('Неверный output: нужно имя <ГГГГ-ММ-ДД>_<задача> или относительный путь outputs/<имя>. Используйте output из карточки запуска.');
  spec={...spec,output};
 }
 if(command==='diagnose'){
  require('../entities/process-facts').assertDiagnosticAccess(cwd,spec.output);
  return require('../runtime/diagnostics').report(cwd,spec.output);
 }
 const access=state=>require('../entities/process-facts').assertAccess(cwd,state.identity.process,state.identity.params,state.identity.extraFiles);
 if(command==='start')require('../entities/process-facts').assertAccess(cwd,spec.process,{...spec.params,...spec.explicitParams},spec.files);
 else {
  const {inside}=require('../core/safe-path'),dir=inside(cwd,`outputs/${spec.output}/.run`);
  const stateFile=inside(dir,'state.json'),transaction=inside(dir,'transaction.json');
  if(fs.existsSync(stateFile))access(JSON.parse(fs.readFileSync(stateFile,'utf8')));
  else if(command!=='recover'||!fs.existsSync(transaction))throw new Error('Состояние отсутствует: требуется run recover');
  // Admission is pure. The existing Controller alone validates/restores the transaction.
  if(command==='recover'&&fs.existsSync(transaction))access(JSON.parse(JSON.parse(fs.readFileSync(transaction,'utf8')).state));
 }
 const options=environment(spec.mode);
 if(command==='start')return controller.start(cwd,spec,options);
 if(command==='execute')return controller.execute(cwd,spec,options);
 return controller.operation(cwd,command,spec,options);
}
module.exports={run};
if(require.main===module){try{
 const [command,...args]=process.argv.slice(2),usage='node tools/kit.js run <'+commands.join('|')+'> <spec.json>|--stdin|--output <имя> [--step <шаг>] [--attempt-id <id>] [--result-name <файл>] [--full]';
 if(!commands.includes(command))throw new Error(usage);
 const {spec,full}=require('../core/cli-spec').readSpec(args,{usage,allowFull:true,flags:{'--output':'output','--step':'step','--attempt-id':'attemptId','--result-name':'resultName'}});
 const response=run(root(),command,spec);console.log(JSON.stringify(full?response:controller.brief(command,response),null,full?2:undefined));
}catch(error){console.error(error.message);if(error.summaryFile)console.error('Итог: '+error.summaryFile);process.exitCode=1;}}

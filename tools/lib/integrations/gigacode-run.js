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
 const options=environment(spec.mode);
 if(command==='start')return controller.start(cwd,spec,options);
 if(command==='execute')return controller.execute(cwd,spec,options);
 if(command==='diagnose')return require('../runtime/diagnostics').report(cwd,spec.output);
 return controller.operation(cwd,command,spec,options);
}
module.exports={run};
if(require.main===module){try{const [command,file,...rest]=process.argv.slice(2);if(!file||rest.length||!commands.includes(command))throw new Error('node tools/kit.js run <'+commands.join('|')+'> <spec.json>');console.log(JSON.stringify(run(root(),command,JSON.parse(fs.readFileSync(file,'utf8'))),null,2));}catch(error){console.error(error.message);if(error.summaryFile)console.error('Итог: '+error.summaryFile);process.exitCode=1;}}

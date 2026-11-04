'use strict';
// Git executes hooks through its POSIX shell on Windows, including non-.exe hooks.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
function invocation(file,args=[],platform=process.platform,gitExecPath=''){
 if(platform!=='win32'||/\.(exe|com)$/i.test(file))return {command:file,args};
 const candidates=['../../../usr/bin/sh.exe','../../../bin/sh.exe'].map(relative=>path.resolve(gitExecPath,relative));
 const shell=candidates.find(candidate=>fs.existsSync(candidate))||'sh';
 return {command:shell,args:['-c','exec "$@"','process-kit-hook',file,...args]};
}
function runHook(file,args=[],options={}){
 let gitExecPath='';
 if(process.platform==='win32'&&!/\.(exe|com)$/i.test(file))gitExecPath=execFileSync('git',['--exec-path'],{cwd:options.cwd,encoding:'utf8'}).trim();
 const call=invocation(file,args,process.platform,gitExecPath);
 return spawnSync(call.command,call.args,options);
}
module.exports={runHook,invocation};

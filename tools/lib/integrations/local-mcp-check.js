#!/usr/bin/env node
'use strict';
// Local installation/stdio check only. Never sends working credentials or invokes business tools.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {inside}=require('../core/safe-path');
function probe(cwd,file,timeout=5000){return new Promise(resolve=>{
 const inherited=Object.fromEntries(['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
 const child=spawn(process.execPath,[file],{cwd,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...inherited,BITBUCKET_URL:'https://example.invalid',BITBUCKET_TOKEN:'probe',USER:'probe',PASSWORD:'probe',SMTP_FROM:'probe@example.invalid',LDAP_BIND_DN:'probe',LDAP_BIND_PASSWORD:'probe'}});
 let settled=false,buffer='',outcome;
 // Windows keeps cwd/files busy until the child and its stdio handles are closed.
 const finish=result=>{if(settled)return;settled=true;outcome=result;clearTimeout(timer);child.kill();};
 child.once('close',()=>{if(!settled)finish({status:'failed',reason:'exited-before-tools'});resolve(outcome);});
 const timer=setTimeout(()=>finish({status:'failed',reason:'timeout'}),timeout);
 child.on('error',()=>finish({status:'failed',reason:'start-failed'}));child.on('exit',()=>finish({status:'failed',reason:'exited-before-tools'}));child.stdin.on('error',()=>{});
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 child.stdout.on('data',chunk=>{
  buffer+=chunk.toString();if(buffer.length>1024*1024)return finish({status:'failed',reason:'response-too-large'});
  let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}
   if(message.id===1){if(message.error||!message.result)return finish({status:'failed',reason:'initialize-failed'});send({jsonrpc:'2.0',method:'notifications/initialized'});send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});}
   if(message.id===2){if(message.error||!Array.isArray(message.result?.tools))return finish({status:'failed',reason:'tools-list-failed'});finish({status:'ready',tools:message.result.tools.length});}
  }
 });
 send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'rockit-install-check',version:'1.0.0'}}});
});}
async function check(cwd,{probe:withProbe=false}={}){
 const data=JSON.parse(fs.readFileSync(inside(cwd,'.gigacode/settings.json'),'utf8')),servers=[];
 for(const name of ['rk-bitbucket','rk-email']){
  const config=data.mcpServers?.[name],args=config?.args;
  const arg=Array.isArray(args)&&typeof args[0]==='string'?args[0].replace(/\\/g,'/'):null;
  if(!config){servers.push({name,status:'missing',reason:'configuration'});continue;}
  if(config.command!=='node'||!Array.isArray(args)||args.length!==1||!/^\.?\/?\.gigacode\/mcp\/[a-z0-9-]+\/dist\/index\.js$/.test(arg||'')){servers.push({name,status:'failed',reason:'unsupported-entry'});continue;}
  const rel=arg.replace(/^\.\//,''),file=inside(cwd,rel);
  if(!fs.existsSync(file)){servers.push({name,status:'missing',reason:'server-files',file:rel});continue;}
  servers.push({name,file:rel,...(withProbe?await probe(cwd,file):{status:'installed'})});
 }
 return {status:servers.every(server=>['installed','ready'].includes(server.status))?'completed':'blocked',probe:withProbe,servers};
}
module.exports={check};
if(require.main===module){(async()=>{const args=process.argv.slice(2);if(args.some(arg=>arg!=='--probe')||args.length>1)throw new Error('node tools/kit.js mcp-check [--probe]');const result=await check(require('../core/paths').root(),{probe:args.includes('--probe')});console.log(JSON.stringify(result,null,2));if(result.status!=='completed')process.exitCode=1;})().catch(()=>{console.error('Не удалось проверить локальную установку MCP');process.exitCode=1;});}

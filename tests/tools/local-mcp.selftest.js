'use strict';
const ctx=require('../fixture')({copy:false,prefix:'pk MCP пробелы '}),{tmp,write,assert,check}=ctx;
const {check:inspect}=require('../../tools/lib/integrations/local-mcp-check');
(async()=>{try{
 const servers=Object.fromEntries(['rk-bitbucket','rk-email'].map((name,i)=>[name,{command:'node',args:[`.\\.gigacode\\mcp\\server-${i}\\dist\\index.js`],env:{PASSWORD:'DO_NOT_FORWARD'}}]));
 write('.gigacode/settings.json',JSON.stringify({mcpServers:servers}));
 let result=await inspect(tmp);check('missing local MCP binaries are reported without installing or connecting',()=>{assert.equal(result.status,'blocked');assert.ok(result.servers.every(server=>server.reason==='server-files'));});
 for(const args of [undefined,null,'not-an-array',[7],[null],[],{}]){
  write('.gigacode/settings.json',JSON.stringify({mcpServers:{...servers,'rk-bitbucket':{command:'node',args}}}));
  result=await inspect(tmp);assert.equal(result.status,'blocked');assert.equal(result.servers[0].reason,'unsupported-entry');
 }
 check('malformed server arguments are reported without crashing or skipping the other server',()=>{assert.equal(result.servers[1].reason,'server-files');});
 write('.gigacode/settings.json',JSON.stringify({mcpServers:servers}));
 for(let i=0;i<2;i++)write(`.gigacode/mcp/server-${i}/dist/index.js`,"if(process.env.PASSWORD==='DO_NOT_FORWARD')process.exit(9);require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fake',version:'1'}}:{tools:[{name:'fixture-read'}]}})+'\\n');});");
 result=await inspect(tmp,{probe:true});check('stdio probe handles Windows paths and Unicode roots without working credentials',()=>{assert.equal(result.status,'completed',JSON.stringify(result));assert.ok(result.servers.every(server=>server.status==='ready'&&server.tools===1));});
 }finally{ctx.close();}})().catch(error=>{console.error(error);process.exitCode=1;});

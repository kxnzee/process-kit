'use strict';
const ctx=require('../fixture')(),{fs,path,assert,tmp,write,check}=ctx;
const core=require('../../tools/lib/runtime/run-journal'),integration=require('../../tools/lib/integrations/gigacode-run');
const spec={process:'example',mode:'live',inputText:'12 задач.',params:{to:'User',subject:'Status'}};
try{
 check('GigaCode adapter snapshots connections but permits additional user consent during a run',()=>{
  const settings={mcpServers:{test:{url:'https://example.invalid/mcp'}},permissions:{allow:[]}};
  write('.gigacode/settings.json',JSON.stringify(settings));
  const output=integration.run(tmp,'start',spec).output;
  settings.permissions.allow.push('read');write('.gigacode/settings.json',JSON.stringify(settings));
  assert.equal(integration.run(tmp,'next',{output}).operation,'begin');
  settings.mcpServers.test.url='https://other.invalid/mcp';write('.gigacode/settings.json',JSON.stringify(settings));
  assert.throws(()=>integration.run(tmp,'next',{output}),/Изменён вход/);
 });
 check('core controller works without GigaCode files; only the live adapter requires its settings',()=>{
  const folder=path.join(tmp,'.gigacode'),hidden=path.join(tmp,'hidden-client-files');fs.renameSync(folder,hidden);
  try{
   const run=core.start(tmp,spec);
   assert.equal(core.operation(tmp,'next',{output:run.output}).operation,'begin');
   assert.ok(!Object.keys(run.state.identity.files).some(f=>f.startsWith('.gigacode/')));
   assert.throws(()=>integration.run(tmp,'start',spec),/ENOENT/);
  }finally{fs.renameSync(hidden,folder);}
 });
}finally{ctx.close();}

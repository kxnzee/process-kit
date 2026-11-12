'use strict';
const c=require('../fixture')(),{tmp,fs,path,assert,check}=c;
const integration=require('../../tools/lib/integrations/gigacode-run');
try{
 check('ARCH-001/004: public recover admits the prepared initial transaction when state is absent',()=>{
  const rename=fs.renameSync;let interrupted=false;
  fs.renameSync=function(from,to){if(!interrupted&&to.endsWith(path.join('.run','state.json'))){interrupted=true;throw Object.assign(new Error('INITIAL_STATE_INTERRUPTED'),{code:'EIO'});}return rename.apply(this,arguments);};
  try{assert.throws(()=>integration.run(tmp,'start',{process:'example',mode:'local',inputText:'12 задач.',params:{to:'Test',subject:'Status'}}),/INITIAL_STATE_INTERRUPTED/);}finally{fs.renameSync=rename;}
  assert.ok(interrupted);const output=fs.readdirSync(path.join(tmp,'outputs'))[0];
  assert.equal(fs.existsSync(path.join(tmp,'outputs',output,'.run/state.json')),false);
  assert.equal(integration.run(tmp,'recover',{output}).operation,'begin');
  assert.equal(integration.run(tmp,'recover',{output}).operation,'begin');
 });
 check('ARCH-007: unavailable or corrupt state still permits safe diagnosis without exposing contents',()=>{
  const output=fs.readdirSync(path.join(tmp,'outputs'))[0],file=path.join(tmp,'outputs',output,'.run/state.json');
  fs.writeFileSync(file,'PRIVATE_RAW_FAILURE');
  const result=integration.run(tmp,'diagnose',{output});
  assert.ok(result.reportFile);assert.ok(!fs.readFileSync(result.reportFile,'utf8').includes('PRIVATE_RAW_FAILURE'));
 });
}finally{c.close();}

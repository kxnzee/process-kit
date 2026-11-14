'use strict';
const c=require('../fixture')({copy:false}),{tmp,source,write,fs,path,assert,check}=c;
const {spawnSync}=require('node:child_process');
try{
 check('the test runner reports a silent nonzero suite exit without hiding its status',()=>{
  write('tools/lib/validation/validate.js','');
  write('tests/silent-failure.selftest.js','process.exit(37);\n');
  fs.copyFileSync(path.join(source,'tests/run.js'),path.join(tmp,'tests/run.js'));
  const result=spawnSync(process.execPath,[path.join(tmp,'tests/run.js')],{cwd:tmp,encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stdout+result.stderr,/exit=37/);
 });
}finally{c.close();}

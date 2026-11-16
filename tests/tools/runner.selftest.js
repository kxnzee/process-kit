'use strict';
const c=require('../fixture')({copy:false}),{tmp,source,write,fs,path,assert,check}=c;
const {spawnSync}=require('node:child_process');
try{
 fs.mkdirSync(path.join(tmp,'tests'),{recursive:true});
 fs.copyFileSync(path.join(source,'tests/run.js'),path.join(tmp,'tests/run.js'));
 check('explicit ownership scope reaches the validator without changing selftest arguments',()=>{
  write('tools/lib/validation/validate.js',"require('node:fs').writeFileSync('validation-args.json',JSON.stringify(process.argv.slice(2)));\n");
  write('tests/scope.selftest.js',"require('node:assert/strict').deepEqual(process.argv.slice(2),[]);\n");
  const args=['--level','master','--team','scope-probe'];
  const result=spawnSync(process.execPath,[path.join(tmp,'tests/run.js'),...args],{cwd:tmp,encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp,'validation-args.json'),'utf8')),args);
 });
 check('unsupported or incomplete test options fail before running validation or selftests',()=>{
  fs.unlinkSync(path.join(tmp,'validation-args.json'));
  for(const args of [['--unknown'],['--level'],['--team'],['--level','--team','scope-probe']]){
   const result=spawnSync(process.execPath,[path.join(tmp,'tests/run.js'),...args],{cwd:tmp,encoding:'utf8'});
   assert.equal(result.status,2);assert.equal(fs.existsSync(path.join(tmp,'validation-args.json')),false);
  }
 });
 check('the test runner reports a silent nonzero suite exit without hiding its status',()=>{
  write('tools/lib/validation/validate.js','');
  write('tests/silent-failure.selftest.js','process.exit(37);\n');
  const result=spawnSync(process.execPath,[path.join(tmp,'tests/run.js')],{cwd:tmp,encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stdout+result.stderr,/exit=37/);
 });
}finally{c.close();}

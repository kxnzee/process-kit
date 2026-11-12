'use strict';
const ctx=require('../fixture')({prefix:'pk skills пробелы '}),{fs,path,assert,tmp,write,check}=ctx;
const {spawnSync}=require('node:child_process'),{catalog}=require('../../tools/lib/entities/skills');
const call=args=>spawnSync(process.execPath,['tools/kit.js','skills',...args],{cwd:tmp,encoding:'utf8'});
try{
 check('skill catalog returns actual metadata and paths without instruction bodies',()=>{
  write('.gigacode/skills/custom-skill/SKILL.md','---\nname: custom-skill\ndescription: Операция из текущей копии\n---\nPRIVATE_INSTRUCTION_BODY\n');
  const result=call([]);assert.equal(result.status,0,result.stderr);
  const rows=JSON.parse(result.stdout),entry=rows.find(row=>row.name==='custom-skill');
  assert.deepEqual(entry,{name:'custom-skill',description:'Операция из текущей копии',file:'.gigacode/skills/custom-skill/SKILL.md'});
  assert.ok(!result.stdout.includes('PRIVATE_INSTRUCTION_BODY'));
  assert.deepEqual(rows,catalog(tmp));
  for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['description','file','name']);
  assert.notEqual(call(['unexpected']).status,0);
 });
 check('CRLF skill checkout produces the same metadata-only catalog',()=>{
  const before=catalog(tmp);
  for(const row of before){const file=path.join(tmp,row.file);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/\r?\n/g,'\r\n'));}
  const result=call([]);assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),before);assert.ok(!result.stdout.includes('PRIVATE_INSTRUCTION_BODY'));
 });
 check('broken skill metadata fails without a partial catalog or instruction text',()=>{
  write('.gigacode/skills/custom-skill/SKILL.md','---\nname: another-name\ndescription: Invalid\n---\nPRIVATE_INSTRUCTION_BODY\n');
  assert.throws(()=>catalog(tmp));
  const result=call([]);assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.ok(!result.stderr.includes('PRIVATE_INSTRUCTION_BODY'));
 });
}finally{ctx.close();}

'use strict';
const ctx=require('../fixture')({prefix:'pk references пробелы '}),{fs,path,assert,tmp,source,write,check}=ctx;
const {catalog}=require('../../tools/lib/entities/skills');
const names=['interaction.md','promotion.md'];
const target=name=>`.gigacode/references/${name}`;
function markdown(dir){
 if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?markdown(path.join(dir,entry.name)):entry.name.endsWith('.md')?[path.join(dir,entry.name)]:[]);
}
// Only the two shared references, not a general Markdown parser or a runtime gate.
function references(root){
 for(const name of names){
  assert.ok(fs.existsSync(path.join(root,target(name))),'Missing required reference: '+target(name));
  assert.ok(fs.statSync(path.join(root,target(name))).isFile(),target(name));
  assert.ok(!fs.existsSync(path.join(root,'docs','references',name)),'Old reference copy: '+name);
 }
 const files=['GIGACODE.md','README.md'].map(file=>path.join(root,file)).filter(file=>fs.existsSync(file));
 for(const folder of ['docs','.gigacode/skills','.gigacode/references'])files.push(...markdown(path.join(root,folder)));
 let links=0;
 for(const file of files){
  const relative=path.relative(root,file).split(path.sep).join('/');
  const raw=fs.readFileSync(file,'utf8');
  for(const name of names)assert.ok(!raw.includes(['docs','references',name].join('/')),relative+': old reference path');
  // Directory-tree examples are not links; remove labels before checking link targets.
  const text=raw.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*(?:\n|$)/gm,'').replace(/\[[^\]]*\]\(([^)\s]+)\)/g,'$1');
  for(const [ref]of text.matchAll(/(?:[\w.-]+\/)*(?:interaction|promotion)\.md/g)){
   const name=ref.slice(ref.lastIndexOf('/')+1),expected=target(name);links++;
   for(const [api,base]of [[path.posix,'/process kit'],[path.win32,'C:\\process kit']]){
    const resolved=api.resolve(base,api.dirname(relative),ref);
    assert.equal(api.relative(base,resolved).split(api.sep).join('/'),expected,relative+': '+ref);
   }
   assert.ok(fs.statSync(path.resolve(path.dirname(file),ref)).isFile(),relative+': '+ref);
  }
 }
 assert.ok(links>0,'No shared reference links checked');
}
try{
 check('shared references and their links resolve from every consumer on POSIX and Windows paths',()=>references(source));
 check('missing mandatory references fail the check',()=>{
  for(const name of names){
   const file=path.join(tmp,target(name)),bytes=fs.readFileSync(file);fs.unlinkSync(file);
   try{assert.throws(()=>references(tmp),{message:'Missing required reference: '+target(name)});}
   finally{fs.writeFileSync(file,bytes);}
  }
  references(tmp);
 });
 check('old copies, old links and incorrectly based relative links fail the check',()=>{
  const old=['docs','references',names[0]].join('/');write(old,'old copy');
  try{assert.throws(()=>references(tmp),/Old reference copy/);}finally{fs.unlinkSync(path.join(tmp,old));}
  for(const ref of [old,'references/interaction.md','.gigacode/references/interaction.md']){
   write('docs/reference-probe.md',`[interaction.md](${ref})\n`);
   try{assert.throws(()=>references(tmp),/reference-probe\.md/);}finally{fs.unlinkSync(path.join(tmp,'docs/reference-probe.md'));}
  }
  write('docs/reference-probe.md','[interaction.md](../.gigacode/references/interaction.md)\n');references(tmp);
 });
 check('the ten shipped Skills are unchanged and shared references are not catalog entries or bodies',()=>{
  const before=catalog(source);assert.equal(before.length,10);assert.deepEqual(catalog(tmp),before);
  write('.gigacode/references/SKILL.md','SHARED_REFERENCE_BODY');
  for(const name of names)fs.appendFileSync(path.join(tmp,target(name)),'\nSHARED_REFERENCE_BODY\n');
  const after=catalog(tmp);assert.deepEqual(after,before);
  assert.ok(after.every(row=>row.file.startsWith('.gigacode/skills/')));assert.ok(!JSON.stringify(after).includes('SHARED_REFERENCE_BODY'));
 });
}finally{ctx.close();}

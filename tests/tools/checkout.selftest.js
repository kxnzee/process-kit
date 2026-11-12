'use strict';
const ctx=require('../fixture')({prefix:'pk checkout пробелы '}),{fs,path,assert,tmp,source,check}=ctx;
const os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const release=require('../../tools/lib/entities/process-release'),journal=require('../../tools/lib/runtime/run-journal');
const checkout=fs.mkdtempSync(path.join(os.tmpdir(),'pk lf checkout пробелы '));
const git=(args,cwd=tmp)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
const names=['example','sdd-stories-report','info-povod'];
const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
let output;
try{
 check('published bytes and binary files survive Git checkout with core.autocrlf=true',()=>{
  console.log('Actual source checkout EOL:\n'+git(['ls-files','--eol','--','processes/example/PROCESS.md','actions/edit-text/ACTION.md','actions/edit-text/runtime.js'],source).trim());
  for(const name of names){
   const receipt=JSON.parse(fs.readFileSync(path.join(tmp,'processes',name,'publication.json'),'utf8'));
   const mismatches=[];
   for(const [file,expected]of Object.entries(receipt.files)){
    const body=fs.readFileSync(path.join(tmp,file)),actual=sha(body);
    if(actual!==expected)mismatches.push({file,expected,actual,crlf:(body.toString('binary').match(/\r\n/g)||[]).length});
   }
   assert.deepEqual(mismatches,[],name+': source checkout differs from published bytes: '+JSON.stringify(mismatches));
   console.log(name+': '+Object.keys(receipt.files).length+' published source hashes match');
  }
  fs.copyFileSync(path.join(source,'.gitattributes'),path.join(tmp,'.gitattributes'));
  fs.writeFileSync(path.join(tmp,'binary-fixture.bin'),Buffer.from([0,13,10,255,10,0]));
  fs.writeFileSync(path.join(tmp,'opaque-fixture.bin'),Buffer.from('opaque\npayload\n'));
  git(['init']);
  git(['-c','core.autocrlf=false','add','--','.gitattributes','.gigacode','actions','adapters','processes','context','config','tools','binary-fixture.bin','opaque-fixture.bin']);
  // Materialize the real Git index, using the conversion setting of Windows checkouts.
  git(['-c','core.autocrlf=true','checkout-index','--all','--prefix='+checkout.replace(/\\/g,'/')+'/']);
  for(const file of git(['ls-files','-z']).split('\0').filter(Boolean))assert.deepEqual(fs.readFileSync(path.join(checkout,file)),fs.readFileSync(path.join(tmp,file)),file+': checkout changed bytes');
  for(const name of names){const receipt=JSON.parse(fs.readFileSync(path.join(checkout,'processes',name,'publication.json'),'utf8'));assert.equal(release.current(checkout,receipt,name),true,name);}
  output=journal.start(checkout,{process:'example',mode:'local',inputText:'12 задач.',params:{to:'User',subject:'Status'}}).output;
  assert.equal(journal.operation(checkout,'next',{output}).operation,'begin');
 });
 check('manual LF to CRLF changes still invalidate publication and an existing run snapshot',()=>{
  const file=path.join(checkout,'actions/edit-text/ACTION.md'),body=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,body.replace(/\r?\n/g,'\r\n'));
  const receipt=JSON.parse(fs.readFileSync(path.join(checkout,'processes/example/publication.json'),'utf8'));
  assert.equal(release.current(checkout,receipt,'example'),false);
  assert.throws(()=>journal.operation(checkout,'next',{output}),/Изменён вход: actions\/edit-text\/ACTION.md/);
 });
}finally{ctx.close();fs.rmSync(checkout,{recursive:true,force:true});}

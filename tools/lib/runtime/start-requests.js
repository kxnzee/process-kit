'use strict';
// Optional retry identity for one start operation, scoped to this working copy.
const fs=require('node:fs'),crypto=require('node:crypto');
const {inside}=require('../core/safe-path'),{validRunFolderName}=require('../core/paths'),storage=require('./run-storage');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
function start(cwd,spec,environment,create,resume){
 const key=spec.idempotencyKey;
 if(typeof key!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(key))throw new Error('idempotencyKey: нужна непустая строка до 128 символов из букв, цифр, . _ : -');
 const fields=new Set(['process','mode','date','slug','title','inputText','params','explicitParams','files','definitionTest','idempotencyKey']);
 if(Object.keys(spec).some(field=>!fields.has(field)))throw new Error('Неизвестное поле запроса start с idempotencyKey');
 const body=JSON.stringify(canonical(spec),null,2)+'\n';
 const {idempotencyKey,...request}=spec,keyHash=hash(key),requestHash=hash(JSON.stringify(canonical({request,environmentFiles:environment.files||[]})));
 const dir=inside(cwd,'.history/start-requests');fs.mkdirSync(dir,{recursive:true});
 const release=storage.lock(dir,true,'.start-'+keyHash);
 try{
  const file=inside(dir,keyHash+'.json');let record;
  if(fs.existsSync(file)){
   record=JSON.parse(fs.readFileSync(file,'utf8'));
   if(record.version!==1||record.keyHash!==keyHash||record.requestHash!==requestHash)throw new Error('Ключ start уже использован с другими параметрами');
   if(!validRunFolderName(record.output)||record.date!==record.output.slice(0,10)||!['reserved','ready'].includes(record.status))throw new Error('Повреждена запись start');
   const run=inside(cwd,'outputs/'+record.output+'/.run');
   if(fs.existsSync(inside(cwd,'outputs/'+record.output))){
    let state;
    if(fs.existsSync(inside(run,'transaction.json')))state=JSON.parse(JSON.parse(fs.readFileSync(inside(run,'transaction.json'),'utf8')).state);
    else if(fs.existsSync(inside(run,'state.json')))state=JSON.parse(fs.readFileSync(inside(run,'state.json'),'utf8'));
    if(state?.identity?.startRequest?.keyHash!==keyHash||state.identity.startRequest.requestHash!==requestHash)throw new Error('Создание start прервано или принадлежность запуска не подтверждена; новый запуск не создан');
    const result=resume(record.output);storage.atomic(file,{...record,status:'ready'});return {...result,reused:true};
   }
   if(record.status==='ready')throw new Error('Ранее созданный запуск отсутствует; повторный start с этим ключом запрещён');
  }
  const reserve=(output,date)=>{record={version:1,keyHash,requestHash,output,date,status:'reserved'};storage.atomic(file,record);};
  const result=create({output:record?.output,date:record?.date,identity:{keyHash,requestHash,requestFileHash:hash(body)},body,reserve});
  storage.atomic(file,{...record,status:'ready'});return {...result,reused:false};
 }finally{release();}
}
module.exports={start};

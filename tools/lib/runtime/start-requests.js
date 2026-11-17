'use strict';
// Optional retry identity for one start operation, scoped to this working copy.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const {inside}=require('../core/safe-path'),{validRunFolderName}=require('../core/paths'),storage=require('./run-storage');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
// Only an initial reservation can fill a pre-transaction directory. It never
// deletes user files, replaces differing bytes, or restarts an already-created run.
function prepare(cwd,record,spec,body,environment){
 const initial=record.initial,state=initial?.state,identity=state?.identity;
 if(record.status!=='reserved'||!initial||record.initialHash!==hash(JSON.stringify(initial))||state?.revision!==0||identity?.process!==spec.process||identity.mode!==spec.mode||identity.startRequest?.keyHash!==record.keyHash||identity.startRequest.requestHash!==record.requestHash||identity.startRequest.requestFileHash!==hash(body))throw new Error('Создание start прервано; нет проверенного начального состояния, требуется проверка разработчиком');
 const folder=inside(cwd,'outputs/'+record.output),run=inside(folder,'.run'),input=spec.inputText!==undefined?path.relative(cwd,inside(run,'inputs/input.md')):null;
 const expected=new Map([['.run/start-request.json',Buffer.from(body)]]);
 const transactionBytes=Buffer.from(JSON.stringify(storage.transaction({...state,revision:1},initial.events),null,2)+'\n'),temporary=new Map();
 if(input){expected.set('.run/inputs/input.md',Buffer.from(spec.inputText));if(identity.files[input]!==hash(spec.inputText))throw new Error('Изменён вход начального start');}
 const fingerprint=environment.fingerprint||((file,bytes)=>hash(bytes));
 for(const [file,digest] of Object.entries(identity.files))if(file!==input&&fingerprint(file,fs.readFileSync(inside(cwd,file)))!==digest)throw new Error('Изменён вход: '+file);
 const dirs=new Set(['','.run',...(input?['.run/inputs']:[])]);
 const held=new Set();
 function inspect(relative=''){
  if(held.has(relative))return;
  const full=inside(folder,relative),entry=fs.statSync(full,{throwIfNoEntry:false});if(!entry)return;
  if(entry.isDirectory()){
   if(!dirs.has(relative))throw new Error('Неподтверждённый каталог в незавершённом start');
   for(const name of fs.readdirSync(full))inspect(relative?relative+'/'+name:name);
  }else{
   const bytes=fs.readFileSync(full),isTemporary=/^\.run\/transaction\.json\.[a-f0-9-]{36}\.tmp$/.test(relative),wanted=isTemporary?transactionBytes:expected.get(relative);
   if(!wanted||bytes.length>wanted.length||!wanted.subarray(0,bytes.length).equals(bytes))throw new Error('Неподтверждённый файл в незавершённом start');
   if(isTemporary)temporary.set(relative,hash(bytes));
  }
 }
 fs.mkdirSync(run,{recursive:true});
 const release=storage.lock(run,true);
 try{
  // A public recover may have completed the transaction while this caller waited.
  if(fs.existsSync(inside(run,'transaction.json')))return JSON.parse(JSON.parse(fs.readFileSync(inside(run,'transaction.json'),'utf8')).state);
  if(fs.existsSync(inside(run,'state.json')))return JSON.parse(fs.readFileSync(inside(run,'state.json'),'utf8'));
  const owner=JSON.parse(fs.readFileSync(inside(run,'.journal.lock'),'utf8'));
  held.add('.run/.journal.lock');held.add(`.run/.journal.lock.${owner.pid}.${owner.id}.candidate`);
  inspect();
  for(const [file,wanted] of expected){
   const full=inside(folder,file);fs.mkdirSync(path.dirname(full),{recursive:true});
   if(fs.existsSync(full)){
    const bytes=fs.readFileSync(full);if(bytes.length>wanted.length||!wanted.subarray(0,bytes.length).equals(bytes))throw new Error('Изменён файл незавершённого start');
    if(bytes.length<wanted.length)fs.appendFileSync(full,wanted.subarray(bytes.length));
   }else fs.writeFileSync(full,wanted,{flag:'wx',mode:0o600});
  }
  storage.stage(run,structuredClone(state),initial.events);
  // Only discard proven interrupted atomic-write bytes after the transaction exists.
  for(const [file,digest] of temporary){const full=inside(folder,file);if(hash(fs.readFileSync(full))!==digest)throw new Error('Изменён временный файл начального start');fs.unlinkSync(full);}
  return state;
 }finally{release();}
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
   if(fs.existsSync(inside(cwd,'outputs/'+record.output))||record.initial){
    let state;
    if(fs.existsSync(inside(run,'transaction.json')))state=JSON.parse(JSON.parse(fs.readFileSync(inside(run,'transaction.json'),'utf8')).state);
    else if(fs.existsSync(inside(run,'state.json')))state=JSON.parse(fs.readFileSync(inside(run,'state.json'),'utf8'));
    else state=prepare(cwd,record,spec,body,environment);
    if(state?.identity?.startRequest?.keyHash!==keyHash||state.identity.startRequest.requestHash!==requestHash)throw new Error('Создание start прервано или принадлежность запуска не подтверждена; новый запуск не создан');
    const result=resume(record.output);const {initial,initialHash,...ready}=record;storage.atomic(file,{...ready,status:'ready'});return {...result,reused:true};
   }
   if(record.status==='ready')throw new Error('Ранее созданный запуск отсутствует; повторный start с этим ключом запрещён');
  }
  const reserve=(output,date,initial)=>{record={version:1,keyHash,requestHash,output,date,status:'reserved',initial,initialHash:hash(JSON.stringify(initial))};storage.atomic(file,record);};
  const result=create({output:record?.output,date:record?.date,identity:{keyHash,requestHash,requestFileHash:hash(body)},body,reserve});
  const {initial,initialHash,...ready}=record;storage.atomic(file,{...ready,status:'ready'});return {...result,reused:false};
 }finally{release();}
}
module.exports={start};

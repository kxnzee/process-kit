'use strict';
// Explicit, owner-scoped, byte-preserving migration. No definition JS or network calls.
const fs=require('node:fs'),crypto=require('node:crypto');
const {inside}=require('../core/safe-path'),{processModel,NAME}=require('../entities/process-model');
const settings=require('./process-settings'),{atomic,lock}=require('../runtime/run-storage');
const hash=body=>crypto.createHash('sha256').update(body).digest('hex');
const folder='.history/process-settings-migrations';
function scope(cwd){
 const {scopeFor}=require('../entities/process-facts'),issues=[],value=scopeFor(cwd,{},code=>issues.push(code));
 if(issues.length||!value.level)throw new Error('Миграции нужна подтверждённая область master/team/my');
 return value;
}
function active(cwd,entries){
 if(!entries.length)return [];
 const base=inside(cwd,'outputs');if(!fs.existsSync(base))return [];
 const files=new Set(entries.flatMap(e=>[e.source,e.target])),blocked=[];
 for(const item of fs.readdirSync(base,{withFileTypes:true})){
  if(!item.isDirectory())continue;
  const run=`outputs/${item.name}/.run`;
  try{
   if(!fs.existsSync(inside(cwd,run)))continue;
   if(['transaction.json','.journal.lock','.recovery.lock'].some(file=>fs.existsSync(inside(cwd,run+'/'+file)))){blocked.push(run);continue;}
   const state=JSON.parse(fs.readFileSync(inside(cwd,run+'/state.json'),'utf8'));
   const pinned=state?.identity?.files;
   if(!pinned||typeof pinned!=='object'||Array.isArray(pinned)||!Object.keys(pinned).length){blocked.push(run);continue;}
   if(['completed','failed'].includes(state.status))continue;
   if(state.status!=='running'||Object.keys(pinned).some(file=>files.has(file)))blocked.push(run);
  }catch{blocked.push(run);}
 }
 return blocked;
}
function plan(cwd){
 const current=scope(cwd),base=`config/${current.level}/processes`,entries=[],issues=[];
 if(fs.existsSync(inside(cwd,base)))for(const item of fs.readdirSync(inside(cwd,base),{withFileTypes:true})){
  const name=item.name.replace(/\.json$/,''),source=base+'/'+item.name;
  try{
   if(!item.isFile()||!item.name.endsWith('.json')||!NAME.test(name))throw new Error('Invalid entry');
   if(!require('../entities/process-facts').visible(name,current))throw new Error('Foreign process');
   const model=processModel(fs.readFileSync(inside(cwd,`processes/${name}/PROCESS.md`),'utf8'));
   if(model.errors.length)throw new Error('Invalid process');
   settings.read(cwd,current.level,name,Object.keys(model.data.params||{}));
   const target=settings.file(current.level,name);
   if(fs.existsSync(inside(cwd,target)))throw new Error('Destination exists');
   entries.push({process:name,level:current.level,source,target,sha256:hash(fs.readFileSync(inside(cwd,source)))});
  }catch{issues.push({file:source,code:'invalid-or-conflicting-settings'});}
 }
 for(const run of active(cwd,entries))issues.push({file:run,code:'active-or-unknown-run'});
 return {ready:!issues.length,level:current.level,teamId:current.teamId,entries,issues};
}
function move(cwd,entry,reverse=false){
 const source=inside(cwd,reverse?entry.target:entry.source),target=inside(cwd,reverse?entry.source:entry.target);
 if(hash(fs.readFileSync(source))!==entry.sha256)throw new Error('Файл настроек изменён после подготовки миграции');
 // COPYFILE_EXCL never overwrites a newly appeared file. Keep the source on any failure.
 const parent=target.slice(0,target.lastIndexOf(require('node:path').sep));fs.mkdirSync(parent,{recursive:true});
 inside(cwd,reverse?entry.source:entry.target);
 fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
 if(hash(fs.readFileSync(target))!==entry.sha256||hash(fs.readFileSync(source))!==entry.sha256)throw new Error('Настройки изменились при переносе; сохранены обе копии');
 if(active(cwd,[entry]).length){fs.unlinkSync(target);throw new Error('Появился активный запуск; перенос отменён');}
 fs.unlinkSync(source);
}
function exclusive(cwd,operation){
 fs.mkdirSync(inside(cwd,folder),{recursive:true});
 const release=lock(inside(cwd,folder),true,'.migration.lock');
 try{return operation();}finally{release();}
}
function migrate(cwd,{apply=false}={}){
 const preview=plan(cwd);if(!apply||!preview.ready||!preview.entries.length)return {...preview,applied:false};
 return exclusive(cwd,()=>{
 const result=plan(cwd);if(!result.ready||!result.entries.length)return {...result,applied:false};
 const id=crypto.randomUUID(),rel=folder+'/'+id+'.json',journal={schemaVersion:1,id,level:result.level,teamId:result.teamId,status:'applying',entries:result.entries};
 const save=()=>{fs.mkdirSync(inside(cwd,folder),{recursive:true});atomic(inside(cwd,rel),journal);};
 save();
 try{for(const entry of journal.entries){move(cwd,entry);save();}journal.status='applied';save();}
 catch(error){journal.status='incomplete';save();throw new Error('Миграция не завершена; выполните config --rollback-process-settings '+id);}
 return {...result,applied:true,journal:id};
 });
}
function rollback(cwd,id){
 if(!/^[a-f0-9-]{36}$/.test(id||''))throw new Error('Нужен идентификатор журнала миграции');
 return exclusive(cwd,()=>{
 const current=scope(cwd),rel=folder+'/'+id+'.json',full=inside(cwd,rel),journal=JSON.parse(fs.readFileSync(full,'utf8'));
 if(journal.schemaVersion!==1||journal.id!==id||journal.level!==current.level||journal.teamId!==current.teamId||!['applying','applied','incomplete','rolled-back'].includes(journal.status)||!Array.isArray(journal.entries))throw new Error('Чужой или повреждённый журнал миграции');
 if(journal.status==='rolled-back')return {rolledBack:true,journal:id};
 const visible=require('../entities/process-facts').visible;
 for(const entry of journal.entries){
  if(!NAME.test(entry.process||'')||entry.level!==current.level||!visible(entry.process,current)||entry.source!==settings.legacyFile(entry.level,entry.process)||entry.target!==settings.file(entry.level,entry.process)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('Повреждённый журнал миграции');
  for(const file of [entry.source,entry.target])if(fs.existsSync(inside(cwd,file))&&hash(fs.readFileSync(inside(cwd,file)))!==entry.sha256)throw new Error('Настройки изменены; автоматический откат запрещён');
  if(!fs.existsSync(inside(cwd,entry.source))&&!fs.existsSync(inside(cwd,entry.target)))throw new Error('Файл миграции утрачен');
 }
 if(active(cwd,journal.entries).length)throw new Error('Активный или неизвестный запуск блокирует откат');
 for(const entry of [...journal.entries].reverse()){
  const old=inside(cwd,entry.source),now=inside(cwd,entry.target);
  if(!fs.existsSync(now))continue;
  if(fs.existsSync(old))fs.unlinkSync(now);else move(cwd,entry,true);
 }
 journal.status='rolled-back';atomic(full,journal);return {rolledBack:true,journal:id};
 });
}
module.exports={plan,migrate,rollback};

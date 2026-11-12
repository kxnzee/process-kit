'use strict';
const fixture=require('../fixture'),ctx=fixture(),{fs,path,assert,tmp,write,check,validate}=ctx;
const journal=require('../../tools/lib/runtime/run-journal');
try{
 const attempt=output=>JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'.run/state.json'))).pending.id;

 const process=`---
name: my-page
version: 1.0.0
area: test
status: действует
publication: legacy
description: Чтение страницы
example: test
entry: read
requires:
  actions: [read-page]
  context: []
  config: []
params:
  url: https://example.org/method
---
## Шаги
### read
- действие: read-page
- параметры: {"url":"{params.url}","dataFile":"{params.dataFile}"}
- артефакт: page
- следующий: end
`;
 write('processes/my-page/PROCESS.md',process);
 write('processes/my-page/fixture.json',JSON.stringify({url:'https://example.org/method',content:'Учебная методология'}));
 check('page source preflight needs no configured connection',()=>validate(['--process','my-page'],true));
 const live=journal.start(tmp,{process:'my-page',mode:'live',date:'2026-11-08',slug:'страница'}).output;
 check('live page is an agent step and cannot save a different source',()=>{
  const card=journal.operation(tmp,'next',{output:live});assert.equal(card.operation,'begin');
  journal.operation(tmp,'begin',{output:live,step:'read'});
  const save={attemptId:attempt(live),output:live,step:'read',artifact:'page',extension:'json',next:'end'};
  assert.throws(()=>journal.operation(tmp,'save',{...save,content:{url:'https://other.example/',content:'Текст'}}),/Адрес результата/);
  journal.operation(tmp,'save',{...save,content:{url:'https://example.org/method',content:'Методология'}});
  journal.operation(tmp,'finish',{output:live,resultName:'страница.json'});
  const result=JSON.parse(fs.readFileSync(path.join(tmp,'outputs',live,'страница.json')));
  assert.equal(result.content,'Методология');assert.equal(result.demo,undefined);
 });
 check('demo reads only selected fixture without network',()=>{
  const output=journal.start(tmp,{process:'my-page',mode:'demo',date:'2026-11-08',slug:'страница',params:{dataFile:'processes/my-page/fixture.json'}}).output;
  assert.equal(journal.operation(tmp,'next',{output}).operation,'execute');
  journal.execute(tmp,{output,step:'read'});
  const state=JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'.run/state.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'.run',state.artifacts.page))).content,'Учебная методология');
  journal.operation(tmp,'finish',{output,resultName:'страница.json'});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'страница.json'))),{url:'https://example.org/method',content:'Учебная методология',demo:'ДАННЫЕ ДЕМО'});
 });
 check('demo rejects an invented page even if the step is saved manually',()=>{
  const output=journal.start(tmp,{process:'my-page',mode:'demo',date:'2026-11-08',slug:'проверка',params:{dataFile:'processes/my-page/fixture.json'}}).output;
  journal.operation(tmp,'begin',{output,step:'read'});
  assert.throws(()=>journal.operation(tmp,'save',{attemptId:attempt(output),output,step:'read',artifact:'page',extension:'json',content:{url:'https://example.org/method',content:'Другая страница'},next:'end'}),/фикстурой/);
 });
 check('local mode and credential-bearing URLs cannot read pages',()=>{
  const output=journal.start(tmp,{process:'my-page',mode:'local',date:'2026-11-08',slug:'локально'}).output;
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'read'}),/только в live или demo/);
  assert.throws(()=>journal.start(tmp,{process:'my-page',mode:'live',params:{url:'https://user:password@example.org/'}}),/без учётных данных/);
 });
 check('external writes cannot claim environment-tool',()=>{
  write('actions/my-write/ACTION.md',fs.readFileSync(path.join(tmp,'actions/read-page/ACTION.md'),'utf8').replace('name: read-page','name: my-write').replace('kind: source','kind: act'));
  assert.throws(()=>require('../../tools/lib/entities/process-dependencies').action(tmp,'my-write'),/только для source/);
 });
 check('ordinary author and keyword parameters survive a complete live run',()=>{
  const url='https://example.org/method?author=alice&keyword=process#section';
  const {output}=journal.start(tmp,{process:'my-page',mode:'live',params:{url}});
  journal.operation(tmp,'begin',{output,step:'read'});
  journal.operation(tmp,'save',{attemptId:attempt(output),output,step:'read',artifact:'page',extension:'json',next:'end',content:{url,content:'Текст страницы'}});
  journal.operation(tmp,'finish',{output,resultName:'страница.json'});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp,'outputs',output,'страница.json'))),{url,content:'Текст страницы'});
 });
 check('credential parameters in queries and fragments are rejected before a run is created',()=>{
  const before=fs.readdirSync(path.join(tmp,'outputs')).sort();
  for(const suffix of ['?access_token=SYNTHETIC_SECRET','?api_key=SYNTHETIC_SECRET','?sig=SYNTHETIC_SECRET','#access_token=SYNTHETIC_SECRET','#/page?access_token=SYNTHETIC_SECRET','#access%5Ftoken=SYNTHETIC_SECRET','#access_token=SYNTHETIC_SECRET?view=page','#/page?access_token=SYNTHETIC_SECRET?view=page','#/page?access%5Ftoken=SYNTHETIC_SECRET?view=page']){
   assert.throws(()=>journal.start(tmp,{process:'my-page',mode:'live',params:{url:'https://example.org/method'+suffix}}),/без учётных данных/);
  }
  assert.deepEqual(fs.readdirSync(path.join(tmp,'outputs')).sort(),before);
 });
}finally{ctx.close();}

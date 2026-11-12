#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { processModel, allowedReference } = require('../tools/lib/entities/process-model');
const { parseFrontmatter } = require('../tools/lib/core/markdown');
const { validRunFolderName } = require('../tools/lib/core/paths');

const source = path.join(__dirname, '..');
function declare(text){
 const {data}=parseFrontmatter(text);if(!data)return text;
 const contexts=[...new Set([...text.matchAll(/context\/(master|team|my)\//g)].map(m=>m[1]))];
 const wanted={actions:[...new Set([...text.matchAll(/- действие: ([a-z0-9-]+)/g)].map(m=>m[1]))],processes:[...new Set([...text.matchAll(/- процесс: ([a-z0-9-]+)/g)].map(m=>m[1]))]};
 if(!data.requires)return text.replace('\n---\n','\nrequires:\n  actions: ['+wanted.actions.join(', ')+']\n  processes: ['+wanted.processes.join(', ')+']\n  context: ['+contexts.join(', ')+']\n---\n');
 let extra=data.requires.context===undefined&&contexts.length?'  context: ['+contexts.join(', ')+']\n':'';for(const key of ['actions','processes'])if(data.requires[key]===undefined)extra+='  '+key+': ['+wanted[key].join(', ')+']\n';
 return text.replace('requires:\n','requires:\n'+extra);
}
function copyProject(from,to){
 function tree(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const item of fs.readdirSync(src,{withFileTypes:true})){
   const original=path.join(src,item.name),target=path.join(dst,item.name);
   if(/^config\/(my|team)\/config\.json$/.test(path.relative(from,original).split(path.sep).join('/')))continue;
   if(item.isDirectory())tree(original,target);else if(item.isFile())fs.copyFileSync(original,target);else throw new Error('Unsupported fixture entry: '+original);
  }
 }
 for(const name of ['processes','actions','context','config','adapters','.gigacode','tools'])if(fs.existsSync(path.join(from,name)))tree(path.join(from,name),path.join(to,name));
}
module.exports = function fixture({copy=true,prefix='pk-contracts-'}={}) {
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true }); fs.writeFileSync(path.join(tmp, file), file.endsWith('/PROCESS.md')?declare(text):text); };

function check(name, fn) { fn(); console.log(`✓ ${name}`); }
function validate(args, success, contains) {
  const result = spawnSync(process.execPath, [path.join(source, 'tools/lib/validation/validate.js'), '--root', tmp, '--json', ...args], { encoding: 'utf8' });
  assert.equal(result.status, success ? 0 : 1, result.stdout + result.stderr);
  if (contains) assert.ok(result.stdout.includes(contains), result.stdout);
}
function model(body) { return processModel(`---\nname: sample\nentry: a\n---\n## Шаги\n${body}`); }
if(copy)copyProject(source,tmp);

return { fs, path, assert, tmp, source, write, check, validate, model, allowedReference, validRunFolderName, parseFrontmatter, close: () => fs.rmSync(tmp, {recursive:true,force:true}) };
};

module.exports.declare=declare;

module.exports.copyProject=copyProject;

// Synthetic publication fixtures isolate runtime/config tests from the publication workflow.
// Genuine lifecycle acceptance uses process-release + completed runs in publication.selftest.js.
// This helper is never imported by tools/, skills, or a production run.
function seedPublication(cwd,name,spec={}){
 if(path.resolve(cwd)===path.resolve(source))throw new Error('Synthetic publication is restricted to test copies');
 const model=require('../tools/lib/entities/process-definition').validateDefinition(cwd,name);
 const params=require('../tools/lib/runtime/run-journal').effectiveParams(cwd,{...spec,date:spec.date||new Date().toISOString().slice(0,10)},model.data.params||{});
 for(const step of model.steps.filter(step=>step.kind==='process')){const child=require('../tools/lib/entities/process-dependencies').childParams(cwd,model,step,params,{},spec.explicitParams||spec.params||{});seedPublication(cwd,step.ref,{...spec,params:child});}
 const release=require('../tools/lib/entities/process-release');
 release.lifecycle(cwd,'validate',{process:name,mode:spec.mode==='demo'?'demo':'local',params});
 const file=path.join(cwd,'processes',name,'publication.json'),receipt=JSON.parse(fs.readFileSync(file,'utf8'));
 Object.assign(receipt,{status:'published',scope:'local/demo',outputs:['2026-01-01_синтетическая-фикстура'],syntheticTestFixture:true});
 fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');
}
module.exports.seedPublication=seedPublication;
module.exports.runtimeJournal=function(){
 const controller=require('../tools/lib/runtime/run-journal');
 return {...controller,start(cwd,spec,environment){if(!spec.definitionTest)seedPublication(cwd,spec.process,spec);return controller.start(cwd,spec,environment);}};
};

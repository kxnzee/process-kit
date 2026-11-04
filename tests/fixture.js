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
// Explicit traversal keeps Unicode destination handling consistent across Node versions.
function copyTree(from,to){
 fs.mkdirSync(to,{recursive:true});
 for(const item of fs.readdirSync(from,{withFileTypes:true})){
  const src=path.join(from,item.name),dst=path.join(to,item.name);
  if(item.isDirectory())copyTree(src,dst);
  else if(item.isFile())fs.copyFileSync(src,dst);
  else throw new Error('Unsupported fixture entry: '+src);
 }
}
if(copy)for(const dir of ['processes','actions','context','config','adapters','.gigacode','tools'])copyTree(path.join(source,dir),path.join(tmp,dir));

return { fs, path, assert, tmp, source, write, check, validate, model, allowedReference, validRunFolderName, parseFrontmatter, close: () => fs.rmSync(tmp, {recursive:true,force:true}) };
};

module.exports.declare=declare;

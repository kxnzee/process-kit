'use strict';
const c=require('../fixture')(),{tmp,write,fs,path,assert,check}=c;
const journal=require('../../tools/lib/runtime/run-journal');
try{
 const definition='processes/audit-admission/PROCESS.md',marker=path.join(tmp,'loaded');
 write(definition,'---\nname: audit-admission\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: admission\nexample: test\nentry: work\nbranchRule: rules/probe.js\n---\n## Шаги\n### work\n- действие: example\n- артефакт: result\n- следующий: end\n');
 write('processes/audit-admission/rules/probe.js',"require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../../loaded'),'loaded');exports.choose=()=>{};");
 check('ARCH-007: unpublished normal start is rejected before loading definition code',()=>{
  assert.throws(()=>journal.start(tmp,{process:'audit-admission',mode:'local',params:{rule:'default'}}),/не опубликовано/);
  assert.equal(fs.existsSync(marker),false);
 });
 check('ARCH-007: executable deep commands advertise definition-code trust, unlike safe inspection',()=>{
  const {commands}=require('../../tools/kit');
  for(const command of ['entities','check']){assert.equal(commands[command].scope,'definition-code');assert.match(commands[command].scopeNote,/код/);}
  assert.equal(commands.processes.scope,'read-only');assert.match(commands.definition.scopeNote,/inspect: read-only/);
 });
 check('ARCH-007: parameter-selected JS is covered by publication before dependency hooks load it',()=>{
  const {lifecycle}=require('../../tools/lib/entities/process-release');
  write('processes/admission-evaluate/PROCESS.md','---\nname: admission-evaluate\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: selected code admission\nexample: test\nentry: work\nparams:\n  inputs: {}\n  parameters: {}\n  rulesFile: processes/admission-evaluate/rules/default.js\n  resultContract: processes/admission-evaluate/contracts/result.json\n---\n## Шаги\n### work\n- действие: evaluate-data\n- артефакт: result\n- следующий: end\n');
  write('processes/admission-evaluate/rules/default.js',"const fs=require('node:fs'),path=require('node:path');if(fs.existsSync(path.join(__dirname,'helper.js')))require('./helper.js');exports.evaluate=()=>({});");
  write('processes/admission-evaluate/contracts/result.json','{"type":"object"}');
  lifecycle(tmp,'validate',{process:'admission-evaluate'});
  const {output}=journal.start(tmp,{process:'admission-evaluate',mode:'local',definitionTest:true});
  journal.execute(tmp,{output,step:'work'});journal.operation(tmp,'finish',{output,resultName:'result.json'});
  lifecycle(tmp,'test',{process:'admission-evaluate',outputs:[output]});lifecycle(tmp,'publish',{process:'admission-evaluate'});
  const selected='processes/unpublished-selected/rules/probe.js',marker=path.join(tmp,'UNPUBLISHED_SELECTED_LOADED');
  write(selected,"require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../../UNPUBLISHED_SELECTED_LOADED'),'loaded');exports.evaluate=()=>({});");
  assert.throws(()=>journal.start(tmp,{process:'admission-evaluate',mode:'local',params:{rulesFile:selected}}),/не проверена при публикации/);
  assert.equal(fs.existsSync(marker),false,'Unpublished selected code already ran before rejection');
  const helper='processes/admission-evaluate/rules/helper.js',helperMarker=path.join(tmp,'UNPUBLISHED_HELPER_LOADED');
  write(helper,"require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../../UNPUBLISHED_HELPER_LOADED'),'loaded');");
  assert.throws(()=>journal.start(tmp,{process:'admission-evaluate',mode:'local'}),/не проверена при публикации/);
  assert.equal(fs.existsSync(helperMarker),false,'New helper ran through an unchanged published module');
  fs.unlinkSync(path.join(tmp,helper));
  assert.equal(journal.operation(tmp,'next',{output:journal.start(tmp,{process:'admission-evaluate',mode:'local'}).output}).operation,'execute');
  const params={rulesFile:selected};lifecycle(tmp,'validate',{process:'admission-evaluate',params});
  const checked=journal.start(tmp,{process:'admission-evaluate',mode:'local',params,definitionTest:true});
  journal.execute(tmp,{output:checked.output,step:'work'});journal.operation(tmp,'finish',{output:checked.output,resultName:'result.json'});
  lifecycle(tmp,'test',{process:'admission-evaluate',outputs:[checked.output]});lifecycle(tmp,'publish',{process:'admission-evaluate'});
  assert.equal(journal.operation(tmp,'next',{output:journal.start(tmp,{process:'admission-evaluate',mode:'local',params}).output}).operation,'execute');
 });
 check('ARCH-007: an unpublished renderer override is rejected without loading its module',()=>{
  const {lifecycle}=require('../../tools/lib/entities/process-release');
  write('processes/admission-render/PROCESS.md','---\nname: admission-render\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: renderer admission\nexample: test\nentry: work\nparams:\n  data: processes/admission-render/data.json\n  templateFile: processes/admission-render/templates/report.md\n  rendererFile: processes/admission-render/renderers/default.js\n---\n## Шаги\n### work\n- действие: compose-report\n- артефакт: result\n- следующий: end\n');
  write('processes/admission-render/data.json','{}');write('processes/admission-render/templates/report.md','# Report');
  write('processes/admission-render/renderers/default.js',"exports.render=()=>'# Report';exports.validate=()=>{};");
  lifecycle(tmp,'validate',{process:'admission-render'});
  const {output}=journal.start(tmp,{process:'admission-render',mode:'local',definitionTest:true});
  journal.execute(tmp,{output,step:'work'});journal.operation(tmp,'finish',{output,resultName:'result.md'});
  lifecycle(tmp,'test',{process:'admission-render',outputs:[output]});lifecycle(tmp,'publish',{process:'admission-render'});
  const selected='processes/unpublished-selected/renderers/probe.js',marker=path.join(tmp,'UNPUBLISHED_RENDERER_LOADED');
  write(selected,"require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../../UNPUBLISHED_RENDERER_LOADED'),'loaded');exports.render=()=>'# Report';exports.validate=()=>{};");
  assert.throws(()=>journal.start(tmp,{process:'admission-render',mode:'local',params:{rendererFile:selected}}),/не проверена при публикации/);
  assert.equal(fs.existsSync(marker),false,'Unpublished renderer already ran before rejection');
 });
}finally{c.close();}

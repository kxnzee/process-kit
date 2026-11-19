'use strict';
const ctx=require('../fixture')(),{tmp,write,fs,path,assert,check}=ctx;
const {validateValue,loadContract}=require('../../tools/lib/contracts/value-contract');
try{
 check('new Action examples satisfy their result contracts',()=>{
  for(const name of ['check-fields','check-rules','check-security'])validateValue(loadContract(tmp,`actions/${name}/contracts/result.json`),JSON.parse(fs.readFileSync(path.join(tmp,`actions/${name}/examples/result.json`),'utf8')));
 });
 check('empty strings, HTML placeholders and absent fields retain honest statuses',()=>{
  const base='processes/validation-cr/data';
  write(`${base}/empty-records.json`,JSON.stringify({records:[{key:'D-1',summary:'',empty:'',markup:'<div> </div>',zero:0}]}));
  write(`${base}/empty-checks.json`,JSON.stringify({checks:[{fieldId:'empty',check:'nonempty'},{fieldId:'markup',check:'nonempty'},{fieldId:'missing',check:'nonempty'},{fieldId:'zero',check:'notNull'}]}));
  const value=require('../../actions/check-fields/runtime').execute({cwd:tmp,processName:'validation-cr',params:{records:`${base}/empty-records.json`,checksFile:`${base}/empty-checks.json`}});
  assert.deepEqual(value.items[0].results.map(item=>item.status),['fail','fail','unreadable','pass']);
  assert.equal(value.items[0].results[0].value,'');validateValue(loadContract(tmp,'actions/check-fields/contracts/result.json'),value);
 });
 check('CR preserves empty field values and unreadable causes through the report contract',()=>{
  const base='processes/validation-cr/data';
  const records={meta:{issueType:'Change Request',queryFile:'processes/validation-cr/queries/cr-selection.md'},records:[{key:'CR-EMPTY',summary:'CR',description:null,empty:''}],excluded:[],unverified:[]};
  write(`${base}/review-records.json`,JSON.stringify(records));write(`${base}/review-checks.json`,JSON.stringify({checks:[{fieldId:'empty',check:'nonempty'}]}));
  const params={records:`${base}/review-records.json`},context={cwd:tmp,processName:'validation-cr',params};
  const security={checkedCount:1,violationCount:0,unreadableCount:0,items:[{key:'CR-EMPTY',summary:'CR',violation:false,findings:[],unreadFields:[]}]};
  const runtime=require('../../actions/check-security/runtime');assert.throws(()=>runtime.validate({...context,value:security}),/нечитаемых/);
  security.items[0].unreadFields=['description'];security.unreadableCount=1;runtime.validate({...context,value:security});
  const fields=require('../../actions/check-fields/runtime').execute({...context,params:{...params,checksFile:`${base}/review-checks.json`}});
  const data=require('../../processes/validation-cr/rules/decide').evaluate({records,fields,rules:{skipped:true},security},{runDate:'2026-11-19',okLabel:'CHECK_OK',errorLabel:'CHECK_ERROR'});
  validateValue(loadContract(tmp,'processes/validation-cr/contracts/report-data.json'),data);
  assert.equal(data.items[0].verdict,'CHECK_ERROR');assert.deepEqual(data.items[0].unreadFields,['description']);assert.equal(data.items[0].failedFields[0].value,'');
  for(const name of ['report','report-html'])assert.ok(require('../../processes/validation-cr/renderers/'+name).render(data).includes('description'));
 });
 check('rule files define the complete ordered result set, not the model output',()=>{
  const base='processes/validation-cr/data';write(`${base}/complete-records.json`,JSON.stringify({records:[{key:'CR-1',summary:'CR',description:'registry link'}]}));
  write(`${base}/complete-rules.md`,'| id | Requirement |\n|---|---|\n| R1 | registry |\n| R2 | link |\n');write(`${base}/complete-manifest.json`,JSON.stringify([{field:'description',rulesFile:`${base}/complete-rules.md`}]));
  const context={cwd:tmp,processName:'validation-cr',params:{records:`${base}/complete-records.json`,manifestFile:`${base}/complete-manifest.json`}};
  const value={manifestFile:context.params.manifestFile,processedCount:1,totalFailedCount:0,skipped:false,sections:[{field:'description',rulesFile:`${base}/complete-rules.md`,ruleCount:1,statusCounts:{pass:1,fail:0,unknown:0,unreadable:0},items:[{key:'CR-1',summary:'CR',emptyOrPlaceholder:false,results:[{ruleId:'R1',status:'pass',basis:'registry',note:null}],failedCount:0}]}]};
  const runtime=require('../../actions/check-rules/runtime');assert.throws(()=>runtime.validate({...context,value}),/состав правил/);
  value.sections[0].ruleCount=2;value.sections[0].items[0].results.push({ruleId:'R2',status:'pass',basis:'link',note:null});value.sections[0].statusCounts.pass=2;runtime.validate({...context,value});
  value.sections[0].items[0].results.reverse();assert.throws(()=>runtime.validate({...context,value}),/порядок правил/);
  write(`${base}/complete-rules.md`,'No explicit rules');assert.throws(()=>runtime.dependencies(context),/нет явных id/);
 });
 check('text rule dependencies are pinned and invented quotations cannot be saved',()=>{
  const runtime=require('../../actions/check-rules/runtime'),base='processes/validation-cr/data';
  write(`${base}/manifest.json`,JSON.stringify([{field:'description',rulesFile:`${base}/rules.md`}]));write(`${base}/rules.md`,'# Rules\n- R1: require registry');
  write(`${base}/records.json`,JSON.stringify({records:[{key:'DEMO-1',summary:'CR',description:'Actual registry'}]}));
  const context={cwd:tmp,processName:'validation-cr',params:{records:`${base}/records.json`,manifestFile:`${base}/manifest.json`}};
  assert.deepEqual(runtime.dependencies(context),[`${base}/manifest.json`,`${base}/rules.md`]);assert.equal(runtime.canExecute(context),false);
  const value={manifestFile:context.params.manifestFile,processedCount:1,totalFailedCount:0,skipped:false,sections:[{field:'description',rulesFile:`${base}/rules.md`,ruleCount:1,statusCounts:{pass:1,fail:0,unknown:0,unreadable:0},items:[{key:'DEMO-1',summary:'CR',emptyOrPlaceholder:false,results:[{ruleId:'R1',status:'pass',basis:'Actual registry',note:null}],failedCount:0}]}]};
  runtime.validate({...context,value});value.sections[0].items[0].results[0].basis='invented';assert.throws(()=>runtime.validate({...context,value}),/цитатой/);
  write(`${base}/manifest.json`,JSON.stringify([{field:'description',rulesFile:'processes/team-foreign-secret/rules.md'}]));assert.throws(()=>runtime.dependencies(context),/Недопустимый ресурс/);
 });
}finally{ctx.close();}

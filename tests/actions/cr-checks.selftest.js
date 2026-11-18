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
 check('text rule dependencies are pinned and invented quotations cannot be saved',()=>{
  const runtime=require('../../actions/check-rules/runtime'),base='processes/validation-cr/data';
  write(`${base}/manifest.json`,JSON.stringify([{field:'description',rulesFile:`${base}/rules.md`}]));write(`${base}/rules.md`,'# Rules\n- R1: require registry');
  write(`${base}/records.json`,JSON.stringify({records:[{key:'DEMO-1',summary:'CR',description:'Actual registry'}]}));
  const context={cwd:tmp,processName:'validation-cr',params:{records:`${base}/records.json`,manifestFile:`${base}/manifest.json`}};
  assert.deepEqual(runtime.dependencies(context),[`${base}/manifest.json`,`${base}/rules.md`]);assert.equal(runtime.canExecute(context),false);
  const value={manifestFile:context.params.manifestFile,processedCount:1,totalFailedCount:0,skipped:false,sections:[{field:'description',rulesFile:`${base}/rules.md`,ruleCount:1,statusCounts:{pass:1,fail:0,unknown:0,unreadable:0},items:[{key:'DEMO-1',summary:'CR',results:[{ruleId:'R1',status:'pass',basis:'Actual registry',note:null}],failedCount:0}]}]};
  runtime.validate({...context,value});value.sections[0].items[0].results[0].basis='invented';assert.throws(()=>runtime.validate({...context,value}),/цитатой/);
  write(`${base}/manifest.json`,JSON.stringify([{field:'description',rulesFile:'processes/team-foreign-secret/rules.md'}]));assert.throws(()=>runtime.dependencies(context),/Недопустимый ресурс/);
 });
}finally{ctx.close();}

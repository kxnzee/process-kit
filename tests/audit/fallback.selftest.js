'use strict';
const c=require('../fixture')(),{tmp,source,write,fs,path,assert,check}=c;
const journal=require('../../tools/lib/runtime/run-journal');
try{
 check('ARCH-009: delegation policy does not authorize unconditional re-execution after a worker error',()=>{
  const skill=fs.readFileSync(path.join(source,'.gigacode/skills/pp-ai-run-process/SKILL.md'),'utf8');
  const section=skill.slice(skill.indexOf('## Шаг в отдельном агенте'),skill.indexOf('## Шаг в отдельном агенте')+4500);
  assert.doesNotMatch(section,/агент завершился ошибкой, шаг исполняется у\s*координатора/);
  for(const term of ['attemptId','reconcile','not-applied','recover'])assert.ok(section.includes(term),'Missing fallback invariant: '+term);
 });
 check('ARCH-009: a coordinator resuming after save observes the successor, not a new attempt',()=>{
  const {output}=journal.start(tmp,{process:'example',mode:'local',inputText:'12 задач.',params:{to:'Test',subject:'Status'}});
  const child=journal.operation(tmp,'begin',{output,step:'edit'});
  journal.operation(tmp,'save',{...child.save,content:'12 задач.'});
  const recovered=journal.operation(tmp,'recover',{output});assert.equal(recovered.spec.step,'draft');
  assert.throws(()=>journal.operation(tmp,'begin',{output,step:'edit'}));
  const trace=fs.readFileSync(path.join(tmp,'outputs',output,'.run/trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(trace.filter(row=>row.type==='step_completed'&&row.id===child.pending.id).length,1);
 });
}finally{c.close();}

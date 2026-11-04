'use strict';
const fixture = require('../fixture');
const ctx = fixture();
const { fs, path, assert, tmp, source, write, check, validate, model, allowedReference, validRunFolderName, parseFrontmatter } = ctx;
try {
  check('рабочие данные не выносятся в общие папки', () => {
    write('.gitignore', 'outputs/\n.history/\n');
    for (const dir of ['fixtures', 'config/fixtures']) {
      write(dir + '/sample.json', '{}');
      try { validate(['--only', 'layout'], false, 'данные должны лежать рядом'); }
      finally { fs.rmSync(path.join(tmp, dir), {recursive:true,force:true}); }
    }
  });
  check('demo never silently replaces an explicitly supplied period', () => {
    const {effectiveParams}=require('../../tools/lib/runtime/run-journal');
    write('processes/my-demo/fixture.json',JSON.stringify({result:{meta:{window:'01.01.2026 — 20.01.2026'}}}));
    const base={mode:'demo',date:'2026-11-05',params:{dataFile:'processes/my-demo/fixture.json'}};
    for(const key of ['params','explicitParams'])assert.throws(()=>effectiveParams(tmp,{...base,[key]:{...base.params,startDate:'01.10.2026'}},{}),/Явный период/);
    const result=effectiveParams(tmp,base,{});assert.equal(result.startDate,'01.01.2026');
    assert.equal(effectiveParams(tmp,{...base,params:{...base.params,startDate:'2026-01-01'}},{}).startDate,'01.01.2026');
  });
  check('human result names reject Windows device names and forbidden characters', () => {
    const {validResultName}=require('../../tools/lib/core/paths');
    for(const name of ['CON.md','nul.txt','COM1.json','LPT9.md','report:final.md','bad?.md','folder/report.md','report.md ','a\u0001.md'])assert.equal(validResultName(name),false,name);
    for(const name of ['отчёт.md','письмо.txt','report-2.json'])assert.equal(validResultName(name),true,name);
  });
  check('previous hooks preserve arguments, stdin and failure status', () => {
    const {runHook,invocation}=require('../../tools/lib/git/git-hook');
    const result=runHook(process.execPath,['-e',"process.stdout.write(require('node:fs').readFileSync(0,'utf8')+'|'+process.argv[1]);process.exitCode=7",'argument with spaces'],{cwd:tmp,input:'hook input',encoding:'utf8'});
    assert.equal(result.status,7,result.error?.message);assert.equal(result.stdout,'hook input|argument with spaces');
    const call=invocation('C:/Repo With Spaces/hook',['remote','address with spaces'],'win32',tmp);
    assert.deepEqual(call.args,['-c','exec "$@"','process-kit-hook','C:/Repo With Spaces/hook','remote','address with spaces']);
  });
  check('повтор поля в шапке', () => assert.ok(parseFrontmatter('---\nname: one\nname: two\n---').error));
  check('неподдерживаемая шапка', () => assert.ok(parseFrontmatter('---\nname: one\nnot yaml\n---').error));
} finally { ctx.close(); }

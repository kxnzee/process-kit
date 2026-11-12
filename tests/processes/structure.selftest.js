'use strict';
const fixture = require('../fixture');
const ctx = fixture();
const { fs, path, assert, tmp, source, write, check, validate, model, allowedReference, validRunFolderName, parseFrontmatter } = ctx;
try {
  check('definition validation reports one issue per invalid version in structure and preflight',()=>{
    const file='processes/example/PROCESS.md',original=fs.readFileSync(path.join(tmp,file),'utf8');
    try{
      write(file,original.replace('version: 1.0.0','version: wrong'));
      for(const args of [['--only','processes'],['--process','example']]){
        const result=require('node:child_process').spawnSync(process.execPath,[path.join(source,'tools/lib/validation/validate.js'),'--root',tmp,'--json',...args],{encoding:'utf8'});
        assert.equal(result.status,1,result.stderr);const report=JSON.parse(result.stdout);
        assert.equal(report.errors,1);assert.equal(report.issues.filter(issue=>issue.msg.includes('version')).length,1);
      }
    }finally{write(file,original);}
  });
  check('фикстура без процесса запрещена', () => {
    write('processes/orphan/fixture.json', '{}');
    try { validate(['--only', 'processes'], false, 'папка без определения процесса'); }
    finally { fs.rmSync(path.join(tmp, 'processes/orphan'), {recursive:true,force:true}); }
  });
  check('transform без конфига', () => validate(['--process', 'example'], true));
  check('демо без конфига и MCP', () => validate(['--process', 'sdd-stories-report', '--demo'], true));
  check('пропуск чтения кода нарушает контракт процесса', () => {
    const file = 'processes/sdd-stories-report/PROCESS.md';
    const original = fs.readFileSync(path.join(tmp, file), 'utf8');
    try {
      write(file, original.replace('следующий: read-code', 'следующий: assess').replace(/### read-code[\s\S]*?(?=### assess)/, ''));
      validate(['--only', 'processes'], false, 'code-evidence недоступен');
    } finally { write(file, original); }
  });
  check('requires accepts entity names and levels, not file paths or resolver objects', () => {
    const file='processes/sdd-stories-report/PROCESS.md',original=fs.readFileSync(path.join(tmp,file),'utf8');
    try{
      write(file,original.replace('config: [master, team, my]','config: [unknown]'));
      validate(['--only','processes'],false,'requires.config');
      write(file,original.replace('context: [master]','context: [master/writing-style/CONTEXT.md]'));
      validate(['--only','processes'],false,'requires.context');
    }finally{write(file,original);}
  });
  check('цикл маршрута', () => assert.ok(model('### a\n- действие: edit-text\n- следующий: a').errors.some(e => e.includes('цикл'))));
  check('неизвестный переход', () => assert.ok(model('### a\n- действие: edit-text\n- следующий: missing').errors.some(e => e.includes('отсутствующий'))));
  check('повтор шага', () => assert.ok(model('### a\n- действие: edit-text\n### a\n- действие: edit-text').errors.some(e => e.includes('повтор'))));
  check('branch требует default', () => assert.ok(model('### a\n- branch:\n - когда: true → goto: end').errors.some(e => e.includes('default'))));
  check('ссылка между командами запрещена', () => assert.equal(allowedReference('team-a-report', 'team-b-query'), false));
  check('личный на общий разрешён', () => assert.equal(allowedReference('my-report', 'run-query'), true));
  check('обратная ссылка даже при существующем файле', () => {
    fs.cpSync(path.join(tmp,'actions/edit-text'),path.join(tmp,'actions/my-edit'),{recursive:true});
    const actionFile=path.join(tmp,'actions/my-edit/ACTION.md');fs.writeFileSync(actionFile,fs.readFileSync(actionFile,'utf8').replace('name: edit-text','name: my-edit'));
    write('processes/sample/PROCESS.md', '---\nname: sample\nversion: 1.0.0\narea: test\nstatus: действует\ndescription: sample\nexample: test\nentry: a\n---\n## Шаги\n### a\n- действие: my-edit\n');
    validate(['--only', 'processes'], false, 'Ссылка вниз');
  });
  check('несовместимый вход действия', () => {
    write('processes/sample/PROCESS.md', '---\nname: sample\nversion: 1.0.0\narea: тест\nstatus: действует\ndescription: sample\nexample: test\nentry: compose\nrequires:\n  actions: [compose-report]\n---\n## Шаги\n### compose\n- действие: compose-report\n- параметры: `data: {report-data}`\n- артефакт: report-text\n');
    validate(['--only', 'processes'], false, 'вход report-data недоступен');
  });
} finally { ctx.close(); }

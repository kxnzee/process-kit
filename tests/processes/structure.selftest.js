'use strict';
const fixture = require('../fixture');
const ctx = fixture();
const { fs, path, assert, tmp, source, write, check, validate, model, allowedReference, validRunFolderName, parseFrontmatter } = ctx;
try {
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
      write(file, original.replace('следующий: read-code', 'следующий: assess'));
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
    write('actions/my-edit/ACTION.md', '---\nname: my-edit\ndescription: text\nkind: transform\nconsumes: []\nproduces: []\n---\n');
    write('processes/sample/PROCESS.md', '---\nname: sample\ndescription: sample\nentry: a\n---\n## Шаги\n### a\n- действие: my-edit\n');
    validate(['--only', 'processes'], false, 'ссылка вниз');
  });
  check('несовместимый вход действия', () => {
    write('processes/sample/PROCESS.md', '---\nname: sample\nversion: 1.0.0\narea: тест\nstatus: действует\ndescription: sample\nexample: test\nentry: compose\nrequires:\n  actions: [compose-report]\n---\n## Шаги\n### compose\n- действие: compose-report\n- параметры: `data: {report-data}`\n- артефакт: report-text\n');
    validate(['--only', 'processes'], false, 'вход report-data недоступен');
  });
} finally { ctx.close(); }

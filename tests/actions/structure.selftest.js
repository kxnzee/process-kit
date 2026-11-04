'use strict';
const fixture = require('../fixture');
const ctx = fixture();
const { fs, path, assert, tmp, source, write, check, validate, model, allowedReference, validRunFolderName, parseFrontmatter } = ctx;
try {
  check('экшен имеет один именованный результат', () => {
    const file = 'actions/run-query/ACTION.md';
    const original = fs.readFileSync(path.join(tmp, file), 'utf8');
    try {
      write(file, original.replace('  task-records:', '  records-text: иной результат\n  task-records:'));
      validate(['--only', 'actions'], false, 'один именованный результат');
    } finally { write(file, original); }
  });
} finally { ctx.close(); }

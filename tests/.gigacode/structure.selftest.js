'use strict';
const fixture = require('../fixture');
const ctx = fixture({copy:false});
const { fs, path, assert, tmp, source, write, check, validate, model, allowedReference, validRunFolderName, parseFrontmatter } = ctx;
try {
  check('числовой токен отклоняется', () => {
    write('.gigacode/settings.json', '{"headers":{"x-jira-token":12345}}');
    validate(['--only', 'settings'], false, 'должно быть ссылкой');
  });
  check('ссылка внутри произвольного токена не разрешается', () => {
    write('.gigacode/settings.json', '{"headers":{"x-jira-token":"prefix $secret:jira/token suffix"}}');
    validate(['--only', 'settings'], false, 'вместо ссылки');
  });
} finally { ctx.close(); }

'use strict';
const fixture = require('../fixture');
const ctx = fixture({copy:false});
const { fs, path, assert, tmp, source, write, check, validate, model, allowedReference, validRunFolderName, parseFrontmatter } = ctx;
try {
  check('skill commands use public CLI names and do not reference the removed runner',()=>{
    const {commands}=require('../../tools/kit');
    for(const name of fs.readdirSync(path.join(source,'.gigacode/skills'))){
      const text=fs.readFileSync(path.join(source,'.gigacode/skills',name,'SKILL.md'),'utf8');
      assert.ok(!text.includes('check-all.js'),name);
      for(const match of text.matchAll(/node tools\/kit\.js ([a-z-]+)/g))assert.ok(Object.hasOwn(commands,match[1]),name+': '+match[1]);
    }
  });
  check('числовой токен отклоняется', () => {
    write('.gigacode/settings.json', '{"headers":{"x-jira-token":12345}}');
    validate(['--only', 'settings'], false, 'должно быть ссылкой');
  });
  check('ссылка внутри произвольного токена не разрешается', () => {
    write('.gigacode/settings.json', '{"headers":{"x-jira-token":"prefix $secret:jira/token suffix"}}');
    validate(['--only', 'settings'], false, 'вместо ссылки');
  });
} finally { ctx.close(); }

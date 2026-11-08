'use strict';
const fs=require('node:fs'),{inside}=require('../../tools/lib/core/safe-path');
const sensitiveNames=new Set(['token','accesstoken','refreshtoken','idtoken','secret','clientsecret','password','passwd','auth','authorization','key','apikey','signature','sig','xamzsignature','xgoogsignature']);
function hasCredentials(params){return [...params.keys()].some(key=>sensitiveNames.has(key.toLowerCase().replace(/[-_]/g,'')));}
function check(ctx){
 const value=ctx.params.url;
 let url;try{url=new URL(value);}catch{throw new Error('Нужен полный адрес страницы HTTP или HTTPS');}
 const fragments=url.hash.slice(1).split('?').map(part=>new URLSearchParams(part));
 if(typeof value!=='string'||!['http:','https:'].includes(url.protocol)||url.username||url.password||hasCredentials(url.searchParams)||fragments.some(hasCredentials))throw new Error('Адрес страницы должен быть HTTP(S) без учётных данных и секретов');
 if(ctx.mode==='demo'&&!ctx.params.dataFile)throw new Error('Для demo нужен точный dataFile страницы');
 if(ctx.mode!=='demo'&&ctx.params.dataFile)throw new Error('dataFile допустим только для demo');
}
function fixture(ctx){return JSON.parse(fs.readFileSync(inside(ctx.cwd,ctx.params.dataFile),'utf8'));}
module.exports={
 dependencies(ctx){check(ctx);return ctx.mode==='demo'?[ctx.params.dataFile]:[];},
 prepare(ctx){check(ctx);if(!['live','demo'].includes(ctx.mode))throw new Error('Чтение страницы доступно только в live или demo');return ctx.params;},
 canExecute(ctx){return ctx.mode==='demo';},
 execute(ctx){return fixture(ctx);},
 normalize(ctx){return ctx.mode==='demo'?{...ctx.value,demo:'ДАННЫЕ ДЕМО'}:ctx.value;},
 validate(ctx){
  if(ctx.value.url!==ctx.params.url)throw new Error('Адрес результата не совпадает с запрошенной страницей');
  if(!ctx.value.content.trim())throw new Error('Страница не содержит текста');
  if(ctx.mode==='demo'){const expected=fixture(ctx);if(ctx.value.demo!=='ДАННЫЕ ДЕМО'||ctx.value.url!==expected.url||ctx.value.content!==expected.content)throw new Error('Результат demo не совпадает с выбранной фикстурой');}
  else if(ctx.value.demo!==undefined)throw new Error('Маркировка demo допустима только для demo');
 }
};

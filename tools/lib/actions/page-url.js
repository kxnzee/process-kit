'use strict';
// Shared input boundary for page-reading actions; it does not fetch or resolve URLs.
const sensitiveNames=new Set(['token','accesstoken','refreshtoken','idtoken','secret','clientsecret','password','passwd','auth','authorization','key','apikey','signature','sig','xamzsignature','xgoogsignature']);
function hasCredentials(params){return [...params.keys()].some(key=>sensitiveNames.has(key.toLowerCase().replace(/[-_]/g,'')));}
function pageUrl(value){
 let url;try{url=new URL(value);}catch{throw new Error('Нужен полный адрес страницы HTTP или HTTPS');}
 const fragments=url.hash.slice(1).split('?').map(part=>new URLSearchParams(part));
 if(typeof value!=='string'||!['http:','https:'].includes(url.protocol)||url.username||url.password||hasCredentials(url.searchParams)||fragments.some(hasCredentials))throw new Error('Адрес страницы должен быть HTTP(S) без учётных данных и секретов');
 return url;
}
module.exports={pageUrl};

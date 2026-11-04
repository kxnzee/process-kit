'use strict';
const {createHash}=require('node:crypto');
function selectionId(data){return createHash('sha256').update(JSON.stringify({meta:data.meta,records:data.records,excluded:data.excluded,unverified:data.unverified})).digest('hex');}
function queryFixture(fixture,queryFile){
 if(!fixture||fixture.query!==queryFile||!fixture.result||!Array.isArray(fixture.result.records)||!Array.isArray(fixture.result.excluded)||!Array.isArray(fixture.result.unverified))throw new Error('фикстура не соответствует выбранному запросу');
 const result=structuredClone(fixture.result);
 result.meta={...result.meta,queryFile,demo:true};result.selectionId=selectionId(result);return result;
}
module.exports={selectionId,queryFixture};

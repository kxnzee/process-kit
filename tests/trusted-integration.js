'use strict';
// Synthetic trusted host for local tests. Its private key never enters an agent's JSON spec.
const crypto=require('node:crypto');
module.exports=function trustedIntegration(){
 const key=crypto.randomBytes(32);
 const signature=body=>crypto.createHmac('sha256',key).update(JSON.stringify(body)).digest('hex');
 function verify({request,proof}){
  if(!proof||!proof.body||typeof proof.signature!=='string'||proof.body.requestId!==request.id||proof.body.purpose!==request.purpose)return null;
  const expected=Buffer.from(signature(proof.body),'hex'),actual=Buffer.from(proof.signature,'hex');
  if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual))return null;
  return proof.body;
 }
 return {environment:{verifyApproval:verify,verifyEffect:verify},receipt(request,outcome='approved'){
  const body={requestId:request.id,purpose:request.purpose,outcome,authority:'test:trusted-host',reference:'synthetic:'+request.id};
  return {source:'adapter',requestId:request.id,proof:{body,signature:signature(body)}};
 }};
};

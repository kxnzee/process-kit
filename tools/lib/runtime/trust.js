'use strict';
// Trust boundary only: the embedding integration verifies receipts. No approval UI, store or agent loop.
const {hash}=require('./run-storage');
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
function request(state,output,purpose,details={}){
 if(typeof state.identity.runId!=='string'||!state.identity.runId)throw new Error('Нет уникального runId: для защищённой операции нужен новый запуск');
 const body={version:1,purpose,run:output,runId:state.identity.runId,rootProcess:state.identity.process,mode:state.identity.mode,definitionTest:state.identity.definitionTest===true,process:state.cursorProcess,callStack:state.stack.map(frame=>({process:frame.process,call:frame.call})),revision:state.revision,snapshotHash:hash(JSON.stringify(canonical(state.identity.files))),artifactHashes:state.artifactHashes,...details};
 return {...body,id:hash(JSON.stringify(canonical(body)))};
}
function verify(environment,kind,challenge,receipt,outcome){
 const method=kind==='approval'?'verifyApproval':'verifyEffect';
 if(typeof environment[method]!=='function')throw new Error(`Нет доверенного канала ${method}; операция заблокирована`);
 if(!receipt||receipt.source!=='adapter'||receipt.requestId!==challenge.id||!Object.hasOwn(receipt,'proof'))throw new Error('Заявление агента не является проверенным подтверждением: нужен adapter receipt для текущего requestId');
 let result;
 try{result=environment[method]({request:structuredClone(challenge),proof:structuredClone(receipt.proof)});}catch{throw new Error('Доверенная интеграция не подтвердила требуемый исход для текущего запроса');}
 if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
 if(!result||typeof result.then==='function'||result.requestId!==challenge.id||result.outcome!==outcome||typeof result.authority!=='string'||!result.authority.trim()||typeof result.reference!=='string'||!result.reference.trim())throw new Error('Доверенная интеграция не подтвердила требуемый исход для текущего запроса');
 return {verification:'adapter-verified',requestId:challenge.id,outcome,authority:result.authority,reference:result.reference,receiptHash:hash(JSON.stringify(canonical(receipt.proof)))};
}
module.exports={request,verify};

'use strict';
const {action}=require('../entities/process-dependencies'),{validateValue,loadContract}=require('./value-contract');
function validateArtifact(cwd,actionName,port,extension,value,context={}){
 const meta=action(cwd,actionName),ref=meta.contracts[port];if(!ref)throw new Error('Необъявленный выход '+port);
 if(ref==='text'){if(!['md','txt'].includes(extension)||typeof value!=='string'||!value.trim())throw new Error('Нужен непустой текстовый результат');}
 else {if(extension!=='json')throw new Error('Контракт требует JSON');validateValue(loadContract(cwd,`actions/${actionName}/${ref}`),value);}
 require('../actions/action-runtime').runtime(cwd,actionName,meta).validate?.({cwd,actionName,meta,params:{},inputs:{},...context,value});
}
module.exports={validateArtifact};

'use strict';
const fs=require('node:fs');
const {inside}=require('../core/safe-path'),{allowedReference}=require('../entities/process-model');
function queryFile(cwd,processName,value){
 if(typeof value!=='string')throw new Error('нужен queryFile');
 const match=value.match(/^processes\/([a-z0-9][a-z0-9-]*)\/queries\/([a-z0-9][a-z0-9-]*)\.md$/);
 if(!match||!allowedReference(processName,match[1]))throw new Error('недопустимый queryFile: '+value);
 const full=inside(cwd,value);if(!fs.statSync(full,{throwIfNoEntry:false})?.isFile())throw new Error('нет queryFile: '+value);return value;
}
module.exports={queryFile};

'use strict';
const assert=require('node:assert/strict');
const {validateArtifact}=require('../../tools/lib/contracts/artifact-contract');
const cwd=require('node:path').join(__dirname,'../..');
const check=(name,fn)=>{fn();console.log('✓ '+name);};
 check('rendered text cannot retain template controls',()=>assert.throws(()=>validateArtifact(cwd,'compose-report','report-text','md','{{#each items}}x{{/each}}')));
 check('unsupported schema rules fail rather than being ignored',()=>assert.throws(()=>require('../../tools/lib/contracts/value-contract').checkContract({type:'object',requried:['x']})));

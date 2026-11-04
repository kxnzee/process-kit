'use strict';
const {inside}=require('../core/safe-path');
function runtime(cwd,name,meta){
 if(!meta.runtime)return {};
 if(meta.runtime!=='runtime.js')throw new Error('runtime: допускается runtime.js внутри папки экшена');
 const file=inside(cwd,`actions/${name}/${meta.runtime}`);
 delete require.cache[require.resolve(file)];
 return require(file);
}
module.exports={runtime};

'use strict';
const fs=require('node:fs'),path=require('node:path');
function inside(base,relative){
 if(typeof relative!=='string'||path.isAbsolute(relative))throw new Error('Нужен относительный путь');
 const file=path.resolve(base,relative);if(file!==path.resolve(base)&&!file.startsWith(path.resolve(base)+path.sep))throw new Error('Путь выходит из папки');
 let at=path.resolve(base);for(const part of path.relative(base,file).split(path.sep).filter(Boolean)){at=path.join(at,part);if(fs.lstatSync(at,{throwIfNoEntry:false})?.isSymbolicLink())throw new Error('Ссылки не допускаются');}return file;
}
module.exports={inside};

'use strict';
// User intent is an explicit input; the report counts and permitted route are computed here.
function choose({step,params,artifacts}){
 if(step!=='gate')throw new Error('Неизвестная развилка SDD');
 // PROCESS.md keeps scalar defaults as strings; JSON input may carry a boolean.
 if(![true,false,'true','false'].includes(params.wantsMail))throw new Error('wantsMail должен быть true/false');
 const wantsMail=params.wantsMail===true||params.wantsMail==='true';
 const count=artifacts['report-data']?.counters?.plainCount;
 if(!Number.isInteger(count)||count<0)throw new Error('Нет корректного plainCount для выбора ветки');
 return wantsMail&&count>0?{target:'prepare-mail-data',reason:'Запрошен черновик; есть истории без SDD'}:{target:'end',reason:wantsMail?'Нет историй без SDD':'Письмо не запрошено'};
}
module.exports={choose};

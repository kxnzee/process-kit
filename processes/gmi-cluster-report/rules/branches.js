'use strict';
function validateInput(params,{mode}={}){
 if(!['yes','no'].includes(params.methodologyCheck))throw new Error('methodologyCheck: до start нужен ответ yes или no; ask не является решением');
 if(![true,false,'true','false','yes','no'].includes(params.demo))throw new Error('demo: нужен явный признак демонстрационных данных');
 if(mode==='demo'&&![true,'true','yes'].includes(params.demo))throw new Error('В режиме demo данные должны быть помечены как демонстрационные');
 if(mode==='local'&&params.methodologyCheck==='yes')throw new Error('Сверка методики допускается только в live/demo');
 if(typeof params.runDate!=='string'||!params.runDate.trim())throw new Error('Нужна дата прогона runDate');
}
function choose({step,params}){
 validateInput(params);
 if(step!=='methodology-gate')throw new Error('Для этой развилки требуется отдельное решение человека');
 return params.methodologyCheck==='yes'
  ?{target:'check-scales',reason:'Запрошена сверка методики; в demo проверяется только синтетический результат без сети'}
  :{target:'read',reason:'Сверка методики не запрошена'};
}
module.exports={choose,validateInput};

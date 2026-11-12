'use strict';
function validateInput(params){
 if(!['yes','no'].includes(params.methodologyCheck))throw new Error('methodologyCheck: до start нужен ответ человека yes или no; ask не является решением');
}
function choose({step,params}){
 validateInput(params);
 if(step!=='methodology-gate')throw new Error('Для этой развилки требуется отдельное решение человека');
 return params.methodologyCheck==='yes'?{target:'check-methodology',reason:'Человек запросил сверку методики'}:{target:'fetch-sigma',reason:'Человек выбрал запуск без сверки методики'};
}
module.exports={choose,validateInput};

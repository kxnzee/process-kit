'use strict';
function validateInput(params){
 if(typeof params.runDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(params.runDate)||Number.isNaN(Date.parse(params.runDate))||new Date(params.runDate).toISOString().slice(0,10)!==params.runDate)throw new Error('runDate: нужна действительная дата ГГГГ-ММ-ДД');
}
function choose({step,params}){if(step!=='review-selection')throw new Error('Нужно отдельное решение человека');return params.issueKey?{target:'check-fields',reason:'Запрошен конкретный CR'}:{target:'review-confirmation',reason:'Для всей выборки нужен явный ответ человека'};}
module.exports={validateInput,choose};

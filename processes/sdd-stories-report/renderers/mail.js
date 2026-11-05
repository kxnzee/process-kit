'use strict';
function render(data){
 if(!data.meta?.window||!Array.isArray(data.stories)||!data.stories.length)throw new Error('Нет данных письма');
 return ['Здравствуйте!','',`За период ${data.meta.window} есть истории без подтверждённых признаков SDD. Просьба уточнить причины и дальнейшие действия.`,'',...data.stories.map(r=>`- ${r.key} — ${r.summary}; ответственный: ${r.responsible}; ${r.url}`),...(data.meta.demo?['','ДАННЫЕ ДЕМО']:[])].join('\n')+'\n';
}
function validate(text,data){if(text.replace(/\r\n/g,'\n').trim()!==render(data).trim())throw new Error('Тело письма не соответствует историям без SDD');}
module.exports={render,validate};

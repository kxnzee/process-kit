#!/usr/bin/env node
'use strict';
// The only public CLI. Libraries under lib/ are not agent-facing tools.
const path=require('node:path'),{spawnSync}=require('node:child_process');
const commands={
 action:{file:'lib/actions/invoke.js',usage:'<spec.json>',purpose:'Выполнить локальный экшен без создания процесса',scope:'local-write'},
 entities:{file:'lib/entities/entities.js',usage:'<process> [local|demo|live] [params.json]',purpose:'Разрешить сущности и подключения процесса',scope:'read-only'},
 run:{file:'lib/runtime/run-journal.js',usage:'<start|next|execute|begin|save|enter|leave|finish|publish|fail> <spec.json>',purpose:'Сохранить состояние и результаты запуска',scope:'local-write'},
 config:{file:'lib/config/config.js',usage:'--json | --process <name> [--params <file>]',purpose:'Проверить настройки и выбор подключений',scope:'read-only'},
 check:{file:'lib/validation/validate.js',usage:'[--process <name>] [--demo] [--params <file>] [--json]',purpose:'Проверить структуру или готовность процесса',scope:'read-only'},
 test:{file:'../tests/run.js',usage:'',purpose:'Запустить тесты разработки; не нужен для обычной задачи',scope:'temporary-files'},
 'hooks-install':{file:'lib/git/install-hooks.js',usage:'',purpose:'Установить локальную защиту Git при инициализации',scope:'git-local-write'},
 'promote-plan':{file:'lib/git/promotion-plan.js',usage:'--target <origin/master|origin/team-code>',purpose:'Рассчитать план переноса без копирования и отправки',scope:'read-only'}
};
function main(args){
 const [command,...rest]=args;
 if(!command||command==='--help'||command==='help'){
  if(rest.length){console.error('Использование: node tools/kit.js --help | --json | <command> [args]');return 2;}
  console.log('Process Kit: node tools/kit.js <command> [args]\n');
  for(const [name,item]of Object.entries(commands))console.log(`${name.padEnd(15)} ${item.purpose}\n                ${item.usage}`);
  return 0;
 }
 if(command==='--json'&&!rest.length){console.log(JSON.stringify(Object.fromEntries(Object.entries(commands).map(([name,{file,...info}])=>[name,info])),null,2));return 0;}
 if(!Object.hasOwn(commands,command)){console.error('Неизвестная команда. Справка: node tools/kit.js --help');return 2;}
 const result=spawnSync(process.execPath,[path.join(__dirname,commands[command].file),...rest],{stdio:'inherit'});
 if(result.error){console.error(result.error.message);return 1;}
 return result.status??1;
}
module.exports={commands,main};
if(require.main===module)process.exitCode=main(process.argv.slice(2));

#!/usr/bin/env node
'use strict';
// The only public CLI. Libraries under lib/ are not agent-facing tools.
const path=require('node:path'),{spawnSync}=require('node:child_process');
const commands={
 definition:{file:'lib/entities/process-release.js',usage:'<validate|test|publish|status> <spec.json>',purpose:'Проверить и допустить конкретную версию определения процесса',scope:'local-write'},
 action:{file:'lib/actions/invoke.js',usage:'<spec.json>',purpose:'Выполнить локальный экшен без создания процесса',scope:'local-write'},
 entities:{file:'lib/entities/entities.js',usage:'<process> [local|demo|live] [params.json]',purpose:'Разрешить сущности и подключения процесса',scope:'read-only'},
 skills:{file:'lib/entities/skills.js',usage:'',purpose:'Прочитать каталог скиллов без тел инструкций',scope:'read-only'},
 processes:{file:'lib/entities/process-catalog.js',usage:'[--level master|team|my] [--team <код>]',purpose:'Прочитать метаданные доступных процессов и состояние их публикации',scope:'read-only'},
 run:{file:'lib/integrations/gigacode-run.js',usage:'<start|next|choose|recover|retry|execute|begin|save|enter|leave|finish|publish|fail|diagnose> <spec.json>',purpose:'Получить допустимую операцию, сохранить или восстановить запуск',scope:'local-write'},
 config:{file:'lib/config/config.js',usage:'--json | --process <name> [--params <file>]',purpose:'Проверить настройки и выбор подключений',scope:'read-only'},
 'setup-status':{file:'lib/config/setup-state.js',usage:'',purpose:'Безопасно прочитать факты о личной настройке',scope:'read-only'},
 check:{file:'lib/validation/validate.js',usage:'[--process <name> [--demo] [--params <file>]] [--level master|team|my] [--team <code>] [--only <rule>] [--root <folder>] [--json]',purpose:'Проверить структуру или готовность процесса',scope:'read-only'},
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

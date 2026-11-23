#!/usr/bin/env node
'use strict';
// The only public CLI. Libraries under lib/ are not agent-facing tools.
const path=require('node:path'),{spawnSync}=require('node:child_process');
const commands={
 'mcp-check':{file:'lib/integrations/local-mcp-check.js',usage:'[--probe]',purpose:'Проверить файлы локальных MCP; --probe проверяет stdio без рабочих доступов',scope:'local-execution'},
 definition:{file:'lib/entities/process-release.js',usage:'<inspect|validate|test|publish|status> <spec.json>|--stdin|--process <name> [--output <run>] [--level <level>] [--team <code>]',purpose:'Безопасно прочитать факты (inspect); глубоко проверить (status/validate) и допустить версию',scope:'local-write',scopeNote:'inspect: read-only; status: глубокая проверка с загрузкой кода; validate/test/publish: локальная запись и загрузка кода'},
 action:{file:'lib/actions/invoke.js',usage:'<spec.json>|--stdin',purpose:'Выполнить локальный экшен без создания процесса',scope:'local-write'},
 entities:{file:'lib/entities/entities.js',usage:'<process> [local|demo|live] [params.json]',purpose:'Разрешить сущности и подключения процесса',scope:'definition-code',scopeNote:'Глубокая проверка может загрузить и выполнить код определения; только доверенные определения'},
 skills:{file:'lib/entities/skills.js',usage:'',purpose:'Прочитать каталог скиллов без тел инструкций',scope:'read-only'},
 processes:{file:'lib/entities/process-catalog.js',usage:'[--all] [--level master|team|my] [--team <код>]',purpose:'Прочитать рабочий каталог; --all включает учебные и устаревшие определения',scope:'read-only'},
 run:{file:'lib/integrations/gigacode-run.js',usage:'<start|next|choose|recover|retry|execute|begin|save|enter|leave|finish|publish|fail|diagnose> <spec.json>|--stdin|--output <run> [--step <step>] [--attempt-id <id>] [--result-name <file>] [--full]',purpose:'Получить допустимую операцию, сохранить или восстановить запуск; компактный JSON, --full — полный ответ',scope:'local-write'},
 config:{file:'lib/config/config.js',usage:'--json | --process <name> [--params <file>] | --migrate-process-settings [--apply] | --rollback-process-settings <id>',purpose:'Проверить настройки; явно перенести файлы параметров процесса или откатить перенос',scope:'local-write',scopeNote:'--json/--process и план миграции: чтение; --apply/--rollback-process-settings: локальная запись'},
 'setup-status':{file:'lib/config/setup-state.js',usage:'',purpose:'Безопасно прочитать факты о личной настройке',scope:'read-only'},
 check:{file:'lib/validation/validate.js',usage:'[--process <name> [--demo] [--params <file>]] [--level master|team|my] [--team <code>] [--only <rule>] [--root <folder>] [--json]',purpose:'Проверить структуру или готовность процесса',scope:'definition-code',scopeNote:'Проверка структуры читает файлы; проверка готовности может загрузить и выполнить код определения'},
 test:{file:'../tests/run.js',usage:'[--level master|team|my] [--team <код>]',purpose:'Запустить тесты разработки; не нужен для обычной задачи',scope:'temporary-files'},
 'hooks-install':{file:'lib/git/install-hooks.js',usage:'',purpose:'Установить локальную защиту Git при инициализации',scope:'git-local-write'},
 'promote-plan':{file:'lib/git/promotion-plan.js',usage:'--target <origin/master|origin/team-code>',purpose:'Рассчитать план переноса без копирования и отправки',scope:'read-only'}
};
function main(args){
 const [command,...rest]=args;
 if(!command||command==='--help'||command==='help'){
  if(rest.length){console.error('Использование: node tools/kit.js --help | --json | <command> [args]');return 2;}
  console.log('RocKit: node tools/kit.js <command> [args]\n');
  for(const [name,item]of Object.entries(commands))console.log(`${name.padEnd(15)} ${item.purpose}\n                ${item.usage}${item.scopeNote?'\n                '+item.scopeNote:''}`);
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

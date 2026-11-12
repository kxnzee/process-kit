# Пилотная установка без стабильного релиза

Эта процедура предназначена только для явно согласованного пилота без команды,
с локальным хранением. Она не выпускает стабильный тег и не подтверждает GigaCode E2E.
Обычная установка по стабильному `vX.Y.Z` сохраняется. Отсутствие тега само по себе
не разрешает установку с `master`: владелец поставки отдельно согласует репозиторий
и полный 40-символьный SHA кандидата. Согласование пилота не разрешает его merge.

Перед установкой дождитесь успешного CI Ubuntu/Windows для **того же SHA**, проверьте
PR и ограничения в отчёте приёмки. Node.js 22 или 24 и Git должны быть доступны.
Используйте новую пустую папку рядом с существующей установкой. Существующие my,
настройки, результаты и секреты эта процедура не переносит и не перезаписывает.
Профиль Git и локальное хранение должны быть заранее согласованы с человеком.

Сохраните следующий блок в `pilot-install.cjs` вне целевой папки. Выполните одной
командой в PowerShell, cmd или POSIX shell (значения передаются как отдельные аргументы):

```text
node pilot-install.cjs "<согласованный URL или локальный репозиторий>" "<полный SHA>" "<новая папка>" "<имя>" "<email>"
```

Блок ниже исполняется автоматическим приёмочным тестом как есть. Он не использует
shell-команды, сетевые API систем, глобальные настройки Git, теги или push.
Git clone обращается только к переданному и заранее согласованному источнику.

```javascript
'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const [origin,revision,target,name,email,...extra]=process.argv.slice(2);
if(extra.length||!origin||origin.startsWith('-')||!/^[a-f0-9]{40}$/.test(revision||'')||!target||!name||!email)throw new Error('Нужны источник, полный SHA, новая папка, имя и email');
const destination=path.resolve(target);
if(fs.existsSync(destination))throw new Error('Целевая папка уже существует; установка остановлена');
function git(...args){return execFileSync('git',args,{cwd:destination,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
fs.mkdirSync(destination);
execFileSync('git',['clone','--no-checkout','--no-tags','--',origin,destination],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const actual=git('rev-parse','--verify',revision+'^{commit}');
if(actual!==revision)throw new Error('Согласованный commit не найден; нельзя подменять его HEAD или master');
git('switch','-c','my','--no-track',revision);
git('config','--local','user.name',name);git('config','--local','user.email',email);
git('config','--local','branch.my.pushRemote','no_push');
const config={schemaVersion:2,teamId:null,profile:{name,email},storage:{mode:'local'},taskStores:[],codeStores:[],defaults:{},preferences:{}};
fs.writeFileSync(path.join(destination,'config/my/config.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
execFileSync(process.execPath,['tools/kit.js','hooks-install'],{cwd:destination,stdio:'pipe'});
const state=JSON.parse(execFileSync(process.execPath,['tools/kit.js','setup-status'],{cwd:destination,encoding:'utf8'}));
if(!state.personalReady)throw new Error('Установка не готова: '+state.issues.join(', '));
git('add','--','config/my/config.json');
git('-c','commit.gpgsign=false','commit','-m','Личная настройка пилота Process Kit','--only','--','config/my/config.json');
console.log(JSON.stringify({pilot:true,revision,personalReady:true,connectionsReady:false,destination}));
```

При ошибке сохраните папку для диагностики; не запускайте установку повторно поверх
неё и не удаляйте другие установки. Новый запуск требует другой новой папки.
Проверка source SHA выполняется до создания личных настроек. Отчёт `personalReady`
означает готовность локальной копии, а не доверие загруженному исходному коду,
подключения к внешним системам или успешную бизнес-задачу.

## Приёмка в настоящем GigaCode

Откройте установленную папку и проверьте обнаружение 10 Skills и условное чтение общих
references. Выполните локальный пример с сохранением результата, продолжение после
перезапуска, составной запрос и отказ отдельного агента до/после save. Сверьте Event,
Intent, выбранный Skill и результат. Подключения и секреты настраиваются отдельно.
Без доверенной интеграции user-checkpoint и `kind: act` должны оставаться blocked:
этот пилот не добавляет verifyApproval/verifyEffect и не разрешает обход receipts.

Для возврата откройте прежнюю папку. Стабильный тег, релиз и миграция пользовательской
копии требуют отдельного согласования и не выполняются этой процедурой.

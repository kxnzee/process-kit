// Помощник шага lookup-mail: опрос почтового справочника по адресатам рекомендаций из артефакта
// чтения (строки, где «Общий итог» ниже цели). Индексы сохраняются как в артефакте, поэтому
// прерванный опрос продолжается с того же места и выдачи совпадают с разбором.
// Файл НЕ запускается как обычная программа: его тело исполняет изолированный исполнитель
// (тул exec), у которого есть MCP-инструменты. Так выдачи справочника ложатся на диск папки
// прогона и не попадают в контекст шага — в ответе только счётчики.
//
// Как запускать (тело исполнителя):
//   const src = require('node:fs').readFileSync('actions/find-mail-contacts/scripts/poll-ldap.js', 'utf8');
//   const fn = new Function('tools', 'RUN', 'FROM', 'TO', 'BASEDN', src + '\nreturn run();');
//   return await fn(<объект инструментов исполнителя>, '<выпуск>', 0, 25, '');
//
// Аргументы:
//   RUN    — выпуск прогона (имя папки в outputs/ или путь к ней, можно с /.run);
//   FROM,TO — полуинтервал индексов людей из employees[] артефакта чтения;
//   BASEDN — пусто для общего запроса по ФИО целиком; непусто (например
//            'OU={OMEGA},OU=GAL,DC=sigma,DC=sbrf,DC=ru') — второй попыткой по одной фамилии
//            в службебном дереве, выдача пишется файлом <индекс>-n.txt (правило 5 рецепта).
// Выдачи: <папка прогона>/.run/inputs/mail-batches/raw/<индекс>.txt, уточнения — -s.txt (короткий
// фильтр, правило 7) и -n.txt (служебное дерево). Уже сохранённые имена пропускаются, поэтому
// прерванный опрос продолжается с того же места и не тратит квоту повторно.
const RAW = 'inputs/mail-batches/raw';
const strip = (r) => {
  const t = typeof r === 'string' ? r : String((r && (r.output !== undefined ? r.output : JSON.stringify(r))) || '');
  const a = t.indexOf('\nOutput: ');
  const b = t.lastIndexOf('\nError: ');
  return (a >= 0 ? t.slice(a + 9, b > a ? b : undefined) : t).replace(/^\r?\n/, '').replace(/^\r?\n/, '').replace(/\r?\n$/, '');
};
const replyText = value => typeof value === 'string' ? value : Array.isArray(value?.content) ? value.content.filter(part=>part.type==='text').map(part=>part.text||'').join('\n') : value?.output!==undefined ? String(value.output) : JSON.stringify(value||'');
const replyError = (value,text) => !!(value?.isError||value?.error)||/^\s*(?:Ошибка(?=\s|:|$)|Error\b|Request failed|HTTP(?:\/[\d.]+)?\s+[45]\d\d|401\b|403\b|429\b|Unauthorized\b|Forbidden\b)/i.test(text);

async function run() {
  const output=String(RUN).replace(/\\/g,'/').replace(/\/$/,'').replace(/\/\.run$/,'').replace(/^outputs\//,'');
  if(!/^\d{4}-\d{2}-\d{2}_[a-zа-яё0-9-]+$/i.test(output))throw new Error('Нужен точный output прогона');
  if(!Number.isInteger(FROM)||!Number.isInteger(TO)||FROM<0||TO<FROM)throw new Error('Неверный диапазон строк');
  const rawDir='outputs/'+output+'/.run/'+RAW,names=[],notRecipient=[];
  let goalRaw='',existing=[],states={};
  for(let at=FROM;at<TO;at+=40){
    const command='node actions/find-mail-contacts/scripts/build-map.js --poll-input "'+output+'" '+at+' '+Math.min(TO,at+40);
    const chunk=JSON.parse(strip(await tools.run_shell_command({command,description:'адресаты текущей попытки'})));
    goalRaw=String(chunk.goal??'').trim();existing=chunk.files||[];Object.assign(states,chunk.states||{});
    const goal=goalRaw?Number(goalRaw.replace(',','.')):NaN;
    for(const [index,who,total]of chunk.names){if(!Number.isFinite(goal)||typeof total==='number'&&Number.isFinite(total)&&total<goal)names.push([index,who]);else notRecipient.push(index);}
  }
  const have=new Set(existing);
  const ldapKeys=Object.keys(tools).filter(k=>/email/i.test(k)&&/search_ldap$/i.test(k)&&typeof tools[k]==='function');
  if(ldapKeys.length>1)throw new Error('Несколько почтовых серверов: передайте исполнителю только выбранный инструмент');
  const ldapKey=ldapKeys[0];
  if (!ldapKey) return JSON.stringify({ ошибка: 'в этом окружении нет инструмента поиска по почтовому справочнику; имена серверов: ' + [...new Set(Object.keys(tools).map((k) => k.split('__').slice(0, 2).join('__')))].join(', ') });
  const ldap = tools[ldapKey];
  const nap=sec=>tools.run_shell_command({command:'node -e "setTimeout(()=>{},'+Math.max(0,Math.floor(sec))*1000+')"',description:'пауза между запросами'});
  const ask = async (params) => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const r = await ldap(params);
        const text=replyText(r);if(replyError(r,text))throw new Error(text);return text;
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (!/лимит запросов|rate|429|too many/i.test(msg)) return 'Ошибка: запрос справочника завершился ошибкой';
        await nap(20);
        if (attempt === 6) return 'Ошибка: превышен лимит запросов';
      }
    }
  };
  const write = async (name, text) => tools.write_file({ file_path: rawDir + '/' + name, content: text, record_as_artifact: false });
  const tree = String(BASEDN || '').trim();
  const suffix = tree ? '-n' : '';
  const done = [], skipped = [], retried = [], truncated = [], failed = [];
  let sincePause = 0;
  for (const [i, who] of names) {
    if (i < FROM || i >= TO) continue;
    const name=String(i).padStart(3,'0'),saved=states[i]||{general:have.has(name+'.txt'),needsShort:false,short:have.has(name+'-s.txt'),narrow:have.has(name+'-n.txt')};
    if(tree?saved.narrow:saved.general&&(!saved.needsShort||saved.short)){skipped.push(i);continue;}
    if(!who.trim()){skipped.push(i+':пустое ФИО');continue;}
    if(++sincePause>=8){sincePause=0;await nap(6);}
    let text='',needsShort=!tree&&saved.needsShort;
    if(tree||!needsShort){
      const params=tree?{query:who.trim().split(/\s+/)[0],limit:100,baseDN:tree,scope:'sub'}:{query:who,limit:100};
      text=await ask(params);
      if(/превышен лимит запросов/i.test(text)){failed.push(i+': лимит запросов');continue;}
      await write(name+(tree?suffix:'')+'.txt',text);
      if(/^Ошибка:/m.test(text)){failed.push(i+': запрос справочника завершился ошибкой');continue;}
      needsShort=!tree&&(/0x3|TIMELIMIT/i.test(text)||!text.includes('👤'));
    }
    if(needsShort&&!saved.short){
      await nap(6);
      const shortQuery=await ask({query:who.trim().split(/\s+/)[0],limit:100});
      if(/превышен лимит запросов/i.test(shortQuery)){failed.push(i+': лимит запросов при коротком фильтре');continue;}
      await write(name+'-s.txt',shortQuery);retried.push(i);
      if(/^Ошибка:|TIMELIMIT|0x3/im.test(shortQuery)){failed.push(i+': короткая перепроверка не завершена');continue;}
    }
    if((text.match(/👤/g)||[]).length>=100)truncated.push(i);
    done.push(i);
  }
  return JSON.stringify({
    режим: tree ? 'служебное дерево' : 'общий запрос', диапазон: [FROM, TO], адресатовКуска: names.length,
    внеСпискаАдресатов: notRecipient.length, цель: goalRaw || 'не прочитана — опрошены все строки куска',
    опрощено: done.length, ужеБыло: skipped.length, перепровереноКороткимФильтром: retried,
    усечениеПоЛимиту: truncated, сорвалось: failed, папкаВыдач: rawDir
  });
}

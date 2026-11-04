'use strict';
const assert=require('node:assert/strict'),{validRunFolderName}=require('../../tools/lib/core/paths');
const check=(name,fn)=>{fn();console.log('✓ '+name);};
  check('неверная календарная дата', () => assert.equal(validRunFolderName('2026-02-30_отчёт'), false));
  check('не более четырёх слов', () => assert.equal(validRunFolderName('2026-11-02_раз-два-три-четыре-пять'), false));
  check('суффикс повтора не слово', () => assert.equal(validRunFolderName('2026-11-02_раз-два-три-четыре-2'), true));
  check('длина имени', () => assert.equal(validRunFolderName(`2026-11-02_${'я'.repeat(41)}`), false));

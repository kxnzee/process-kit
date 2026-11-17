'use strict';
const ctx=require('../fixture')(),{tmp,fs,path,assert,check}=ctx;
const zlib=require('node:zlib');
const read=require('../../actions/read-score-table/runtime');
// Build actual XLSX bytes so cell parsing and ZIP decompression are exercised together.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(entries,compressed){
 const chunks=[],central=[];let offset=0;
 for(const [name,text]of entries){
  const filename=Buffer.from(name),raw=Buffer.from(text),data=compressed?zlib.deflateRawSync(raw):raw,method=compressed?8:0,crc=crc32(raw);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);
  chunks.push(local,filename,data);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(method,10);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(raw.length,24);record.writeUInt16LE(filename.length,28);record.writeUInt32LE(offset,42);
  central.push(record,filename);offset+=local.length+filename.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...chunks,directory,end]);
}
const escape=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function column(index){let name='';for(index++;index;index=Math.floor((index-1)/26))name=String.fromCharCode(65+(index-1)%26)+name;return name;}
function xlsx(table,inline,compressed){
 const strings=[];
 const rows=[table.headers,...table.rows].map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>{
  const ref=column(j)+(i+1);
  if(value===null||value==='')return `<c r="${ref}"/>`;
  if(typeof value==='number')return `<c r="${ref}"><v>${value}</v></c>`;
  if(inline){const text=String(value),half=Math.floor(text.length/2);return `<c t="inlineStr" r="${ref}"><is><r><t xml:space="preserve">${escape(text.slice(0,half))}</t></r><r><t xml:space="preserve">${escape(text.slice(half))}</t></r></is></c>`;}
  strings.push(String(value));return `<c r="${ref}" t="s"><v>${strings.length-1}</v></c>`;
 }).join('')}</row>`).join('');
 const entries=[
  ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+(!inline?'<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>':'')+'</Types>'],
  ['_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Scores" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'+(!inline?'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>':'')+'</Relationships>'],
  ['xl/worksheets/sheet1.xml',`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`]
 ];
 if(!inline)entries.push(['xl/sharedStrings.xml',`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(text=>`<si><t>${escape(text)}</t></si>`).join('')}</sst>`]);
 return zip(entries,compressed);
}
try{
 const table={headers:['Номер сотрудника','Код Команды','Основная роль','Обучение и применение БАЛЛ','Навыки и токены БАЛЛ','Продуктивность и Story БАЛЛ','Общий итог','ФИО сотрудника'],rows:[['00123','T','Dev & <review>',1.5,1,0.5,3,'Иванов И. И.'],['00124','T','Dev',null,0,0,0,'']]};
 const context={cwd:tmp,processName:'gmi-cluster-report',actionName:'read-score-table'};
 fs.writeFileSync(path.join(tmp,'table.json'),JSON.stringify(table));
 const expected=read.execute({...context,params:{scoreFile:'table.json'}});
 for(const inline of [true,false])for(const compressed of [true,false])check(`XLSX ${inline?'inline rich strings':'shared strings'}, ${compressed?'deflated':'stored'} preserves rows, numbers and gaps`,()=>{
  fs.writeFileSync(path.join(tmp,'table.xlsx'),xlsx(table,inline,compressed));
  const actual=read.execute({...context,params:{scoreFile:'table.xlsx'}});
  assert.equal(actual.source.format,'xlsx');assert.equal(actual.source.sheet,'Scores');assert.equal(actual.source.columnCount,table.headers.length);
  assert.deepEqual(actual.employees,expected.employees);assert.deepEqual(actual.gaps,expected.gaps);assert.equal(actual.names.matched,1);
 });
}finally{ctx.close();}

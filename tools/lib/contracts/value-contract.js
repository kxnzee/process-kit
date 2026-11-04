'use strict';
// Small, explicit contract language; unsupported rules fail instead of being ignored.
const fs = require('node:fs');
const { inside } = require('../core/safe-path');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const KEYS = new Set(['type','required','properties','additionalProperties','items','minItems','minLength','minimum','enum','anyOf','description']);
function checkContract(schema) {
  if (!object(schema)) throw new Error('Контракт должен быть объектом');
  for (const key of Object.keys(schema)) if (!KEYS.has(key)) throw new Error(`Неизвестное правило контракта: ${key}`);
  const types = ['object','array','string','number','integer','boolean','null'];
  if (schema.type !== undefined && !types.includes(schema.type)) throw new Error('Неизвестный type контракта');
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(x=>typeof x!=='string') || new Set(schema.required).size!==schema.required.length)) throw new Error('required: нужен список уникальных имён');
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) throw new Error('enum: нужен непустой список');
  for (const key of ['minimum','minLength','minItems']) if (schema[key] !== undefined && (!Number.isFinite(schema[key]) || (key!=='minimum' && (!Number.isInteger(schema[key]) || schema[key]<0)))) throw new Error(`Некорректный ${key}`);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') throw new Error('additionalProperties: нужен boolean');
  if (schema.properties !== undefined) { if (!object(schema.properties)) throw new Error('properties: нужен объект'); for(const value of Object.values(schema.properties))checkContract(value); }
  if (schema.items !== undefined) checkContract(schema.items);
  if (schema.anyOf !== undefined) { if (!Array.isArray(schema.anyOf)||!schema.anyOf.length)throw new Error('anyOf: нужен непустой список');for(const value of schema.anyOf)checkContract(value); }
}
function errors(schema, value, at = '$') {
  const result = [], type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && (schema.type==='integer' ? !Number.isInteger(value) : type!==schema.type || (type==='number'&&!Number.isFinite(value)))) return [`${at}: нужен ${schema.type}`];
  if (schema.enum && !schema.enum.some(item=>JSON.stringify(item)===JSON.stringify(value))) result.push(`${at}: значение не входит в enum`);
  if (schema.anyOf && !schema.anyOf.some(item=>!errors(item,value,at).length)) result.push(`${at}: значение не соответствует ни одному варианту`);
  if (typeof value === 'string' && schema.minLength!==undefined && value.trim().length<schema.minLength) result.push(`${at}: пустой или слишком короткий текст`);
  if (typeof value === 'number' && schema.minimum!==undefined && value<schema.minimum) result.push(`${at}: меньше minimum`);
  if (Array.isArray(value)) {
    if (schema.minItems!==undefined && value.length<schema.minItems) result.push(`${at}: мало элементов`);
    if (schema.items) value.forEach((item,i)=>result.push(...errors(schema.items,item,`${at}[${i}]`)));
  }
  if (object(value)) {
    for(const key of schema.required||[])if(!Object.hasOwn(value,key))result.push(`${at}.${key}: обязательное поле`);
    for(const [key,item] of Object.entries(value)) {
      if(schema.properties?.[key])result.push(...errors(schema.properties[key],item,`${at}.${key}`));
      else if(schema.additionalProperties===false)result.push(`${at}.${key}: неизвестное поле`);
    }
  }
  return result;
}
function validateValue(schema, value) { checkContract(schema); const found=errors(schema,value);if(found.length)throw new Error(found.join('; '));return value; }
function loadContract(cwd, file) { const value=JSON.parse(fs.readFileSync(inside(cwd,file),'utf8'));checkContract(value);return value; }
module.exports={checkContract,validateValue,loadContract};

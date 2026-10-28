import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { GENERATED_ENGLISH_UI_PHRASES } from '../youle_desktop/src/renderer/app-language-en-generated.mjs';
import { GENERATED_TRADITIONAL_UI_PHRASES } from '../youle_desktop/src/renderer/app-language-zh-tw-generated.mjs';

const reviewed = JSON.parse(await readFile(new URL('windows-english-reviewed-r3.json', import.meta.url), 'utf8'));
const result = {...reviewed};
for (const [source, value] of Object.entries(reviewed)) {
  assert.ok(Object.hasOwn(GENERATED_ENGLISH_UI_PHRASES, source), `Unknown source: ${source}`);
  assert.ok(value.trim() && !/\p{Script=Han}/u.test(value), `Untranslated: ${source}`);
  assert.deepEqual(value.match(/\{\w+\}|%[sd]/g)||[], source.match(/\{\w+\}|%[sd]/g)||[], `Placeholder mismatch: ${source}`);
  const traditional = GENERATED_TRADITIONAL_UI_PHRASES[source];
  if (traditional && traditional !== source) result[traditional] = value;
}
const output = '// Generated from tools/windows-english-reviewed-r3.json. Human-reviewed copy.\nexport const REVIEWED_ENGLISH_COPY_R3 = Object.freeze('+JSON.stringify(result, null, 2)+');\n';
const target = new URL('../youle_desktop/src/renderer/app-language-en-review-r3.mjs', import.meta.url);
if (process.argv.includes('--check')) assert.equal((await readFile(target,'utf8')).replaceAll('\r\n','\n'), output);
else await writeFile(target, output);
console.log(`Reviewed English: ${Object.keys(reviewed).length} sources, ${Object.keys(result).length} including Traditional aliases.`);

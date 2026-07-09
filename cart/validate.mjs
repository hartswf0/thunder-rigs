// Cartridge contract test — validates every example against the schema, then
// proves the schema has teeth with a negative battery (each mutation must fail
// for the stated reason).
//
//   cd cart && npm install ajv ajv-formats && node validate.mjs
//
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const C = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(C, 'cartridge.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

let fails = 0;

// ── every example must PASS ──────────────────────────────────────────────────
let first = null;
for (const f of readdirSync(join(C, 'examples')).filter(n => n.endsWith('.trig.json'))) {
  const doc = JSON.parse(readFileSync(join(C, 'examples', f), 'utf8'));
  if (!first) first = doc;
  const ok = validate(doc);
  console.log(`${ok ? 'PASS' : 'FAIL'}  examples/${f}`);
  if (!ok) { fails++; console.log(validate.errors.slice(0, 6).map(e => `  ${e.instancePath} ${e.message}`).join('\n')); }
}

// ── negative battery: each mutation must be REJECTED ─────────────────────────
const mut = (fn, why) => {
  const d = JSON.parse(JSON.stringify(first));
  fn(d);
  const ok = validate(d);
  console.log(`${ok ? 'BAD: accepted' : 'REJECTS'}  ${why}`);
  if (ok) fails++;
};
mut(d => { d.world.atmosphere.fog = 'grey'; },                          'non-hex atmosphere color');
mut(d => { d.entities[0].at.x = 300; },                                 'entity placed outside the arena');
mut(d => { d.entities.push({ kind: 'fort', id: 'f2', anchor: { x: 0, z: 0 } }); }, 'fort with neither code nor objects');
mut(d => { d.entities.push({ kind: 'flag', id: 'f3', at: { x: 1, z: 1 } }); },     'flag without a team');
mut(d => { d.rules = { mode: 'custom' }; },                             'custom mode without mode code');
mut(d => { d.world.code = 'x'.repeat(40000); },                         'world code over the 32k budget');
mut(d => { d.cine = { shots: Array(30).fill({ p: [0,0,0], t: [0,0,0] }) }; }, 'more than 24 cine shots');
mut(d => { delete d.world.code; delete d.world.objects; },              'world with neither code nor objects');
mut(d => { d.format = 'thunder-rigs.cartridge/v2'; },                   'unknown format version');

process.exit(fails ? 1 : 0);

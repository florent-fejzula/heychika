// Checks the translations (npm run check:i18n):
//   - en.json and sq.json have exactly the same keys, none of them empty,
//   - every key the code names exists, and every {{ placeholder }} is in both languages,
//   - no key is left unused.
// A key the code builds from parts ('common.country.' + code) counts as a prefix:
// at least one key must start with it.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const en = flatten(JSON.parse(readFileSync(join(root, 'i18n/en.json'), 'utf8')));
const sq = flatten(JSON.parse(readFileSync(join(root, 'i18n/sq.json'), 'utf8')));
const problems = [];

for (const key of Object.keys(en)) {
  if (!(key in sq)) problems.push(`sq.json is missing ${key}`);
  else if (placeholders(en[key]) !== placeholders(sq[key])) problems.push(`${key} has different {{ }} placeholders in en and sq`);
  if (!en[key].trim()) problems.push(`en.json has an empty ${key}`);
}
for (const key of Object.keys(sq)) {
  if (!(key in en)) problems.push(`en.json is missing ${key}`);
  if (!sq[key].trim()) problems.push(`sq.json has an empty ${key}`);
}

// Quoted keys, attribute values (label="admin.scan.label"), and the start of `prefix.${name}`.
const KEY = /['`"]((?:common|titles|shop|admin|errors|xlsx)\.[\w.-]*)(?:['`"]|\$\{)/g;
const used = new Set();
const prefixes = new Set();
for (const file of walk(join(root, 'app'))) {
  if (!/\.(ts|html)$/.test(file) || file.endsWith('.spec.ts')) continue;
  const text = readFileSync(file, 'utf8');
  for (const [, key] of text.matchAll(KEY)) {
    if (key.endsWith('.')) prefixes.add(key);
    else if (key in en || `${key}_one` in en) used.add(key);
    else if (Object.keys(en).some((k) => k.startsWith(key + '.'))) prefixes.add(key + '.');
    else problems.push(`${file.slice(root.length)} uses ${key}, which isn't in en.json`);
  }
}
// Keys looked up with a prefix in code (xlsx.<name>, admin.movement.<type>, ...) count as used.
const dynamic = [...prefixes, 'xlsx.'];
for (const p of dynamic) {
  if (!Object.keys(en).some((k) => k.startsWith(p))) problems.push(`no key starts with ${p}`);
}
for (const key of Object.keys(en)) {
  const base = key.replace(/_one$/, '');
  if (!used.has(base) && !dynamic.some((p) => key.startsWith(p))) problems.push(`${key} is never used`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`${Object.keys(en).length} strings in each language, all used, all present.`);

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else flatten(v, `${prefix}${k}.`, out);
  }
  return out;
}

function placeholders(text) {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

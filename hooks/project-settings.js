#!/usr/bin/env node
// project-settings.js — the numbers a project's measurements are judged by, in one place (#740).
//
// WHAT IT IS FOR. Some numbers are rulings, not code: the forceable share below which refusal
// stops being the main lever (#700), the leave-one-out floor a placer must reach (#723), the
// weights the signature vectors use (#647). Kept as constants in each script they drift, one
// project cannot differ from another, and a figure cannot be traced to the numbers it was judged
// by. This module owns the schema for every such number; every tool reads them through it and
// nowhere else.
//
// WHERE THEY LIVE. One file per project, in that project's store folder:
//   ~/.anvideck/projects/<project>/settings.json
// next to the other per-project numbers the store keeps. `--settings <file>` names one directly.
//
// THE FILE.
//   { "about": "…", "settings": { "<key>": { "value": <number | "n/d">, "ruled": "YYYY-MM-DD",
//                                            "why": "…" }, … } }
// Every entry carries its ruling date and reason. A key absent from the file takes the schema's
// default and prints as "default, not ruled". A key with no default MUST be ruled: until it is,
// the tool that needs it prints NOT MEASURED with the key's name, and never uses a number it was
// not given. A fraction is written "1/3" so a boundary is exact.
//
// WHAT IT REFUSES. Unreadable JSON, an unknown key, a missing value, a wrong type, a value out of
// range, an entry without its date or reason. A file with any of these is not used at all: the
// reader says what is wrong and the tool stops, because a half-read file would judge by numbers
// nobody chose.
//
// THE SETTINGS ID. A short hash of the effective values of every key (unruled keys as null).
// Printed beside every figure judged by them; two figures compare only under the same id. The
// date and the reason do not move it; a value does.
//
// THE LEDGER KEEPS OWNERS AND JOBS; THIS KEEPS NUMBERS. No value lives in both.
//
// Usage (prints the effective table):
//   node hooks/project-settings.js --project <name> | --settings <file>
// Exit: 0 printed · 2 the file was refused or the arguments were wrong.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Every key, its type and range, its default (absent = must be ruled), and who reads it.
const SCHEMA = {
  'refusal.forceableShareFloor': {
    type: 'fraction', min: 0, max: 1,
    about: 'a forceable share of duplicated jobs below this ends refusal as the main lever',
    readBy: '#700 (forceable share)',
  },
  'placement.leaveOneOut.minRate': {
    type: 'fraction', min: 0, max: 1,
    about: 'the share of held-out ruled jobs the placer must return to their ruled home',
    readBy: '#723 (PLACE acceptance)',
  },
  'placement.leaveOneOut.minJobs': {
    type: 'integer', min: 1,
    about: 'below this many ruled jobs the floor is not judged; the result prints "underpowered, k of n"',
    readBy: '#723 (PLACE acceptance)',
  },
  'signatures.weight.direct': {
    type: 'number', min: 0, exclusiveMin: true, default: 1,
    about: 'weight of a resource the file touches itself',
    readBy: '#647 (signature vectors)',
  },
  'signatures.weight.viaDoor': {
    type: 'number', min: 0, default: 0.5,
    about: 'weight of a resource reached only through another file\'s export (so consumers do not drift toward providers)',
    readBy: '#647 (signature vectors)',
  },
  'signatures.nearTwoBand': {
    type: 'fraction', min: 0, max: 1, default: 0.1,
    about: 'a second owner within this fraction of the nearest distance makes the file "near two"',
    readBy: '#647 (signature vectors)',
  },
  'signatures.vocabulary.minTokenLength': {
    type: 'integer', min: 1, default: 3,
    about: 'identifier tokens shorter than this are dropped from the vocabulary view',
    readBy: '#647 (signature vectors)',
  },
};

const { storeProjectsRoot } = require('./anvi-paths.js');
const pathFor = project => path.join(storeProjectsRoot(), project, 'settings.json');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// "n/d" → its value; a number → itself; anything else → NaN (reported as a wrong type).
function numberOf(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(v);
    if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  }
  return NaN;
}

function checkValue(key, spec, raw) {
  const n = numberOf(raw);
  if (typeof raw === 'string' && spec.type !== 'fraction') return `${key}: a fraction string is only allowed for fractions, got ${JSON.stringify(raw)}`;
  if (!Number.isFinite(n)) return `${key}: value must be ${spec.type === 'fraction' ? 'a number or "n/d"' : 'a number'}, got ${JSON.stringify(raw)}`;
  if (spec.type === 'integer' && !Number.isInteger(n)) return `${key}: value must be a whole number, got ${raw}`;
  if (spec.min != null && (spec.exclusiveMin ? n <= spec.min : n < spec.min)) return `${key}: value ${raw} is below ${spec.exclusiveMin ? 'or equal to ' : ''}${spec.min}`;
  if (spec.max != null && n > spec.max) return `${key}: value ${raw} is above ${spec.max}`;
  return null;
}

// Effective settings from a file, or { refused } with every reason. A missing file is not an
// error: every key takes its default, and must-be-ruled keys stay unruled.
function load({ file, project } = {}) {
  const where = file || (project ? pathFor(project) : null);
  if (!where) return { refused: ['no project and no settings file named'] };
  let doc = null;
  if (fs.existsSync(where)) {
    let text;
    try { text = fs.readFileSync(where, 'utf8'); } catch (e) { return { refused: [`cannot read ${where}: ${e.code || e.message}`], file: where }; }
    try { doc = JSON.parse(text); } catch (e) { return { refused: [`${where} is not valid JSON: ${e.message}`], file: where }; }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { refused: [`${where}: the top level must be an object`], file: where };
  }
  const given = doc ? doc.settings : undefined;
  if (doc && given !== undefined && (!given || typeof given !== 'object' || Array.isArray(given))) {
    return { refused: [`${where}: "settings" must be an object of key → entry`], file: where };
  }
  const problems = [];
  if (doc) for (const k of Object.keys(doc)) if (k !== 'about' && k !== 'settings') problems.push(`${where}: unknown top-level field "${k}"`);
  const entries = {};
  for (const [key, entry] of Object.entries(given || {})) {
    const spec = SCHEMA[key];
    if (!spec) { problems.push(`${key}: not a known setting (known: ${Object.keys(SCHEMA).join(', ')})`); continue; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problems.push(`${key}: entry must be { value, ruled, why }`); continue; }
    if (!('value' in entry)) { problems.push(`${key}: no value`); continue; }
    const bad = checkValue(key, spec, entry.value);
    if (bad) { problems.push(bad); continue; }
    if (typeof entry.ruled !== 'string' || !DATE.test(entry.ruled)) problems.push(`${key}: "ruled" must be the ruling date, YYYY-MM-DD`);
    if (typeof entry.why !== 'string' || !entry.why.trim()) problems.push(`${key}: "why" must say why this value`);
    for (const f of Object.keys(entry)) if (!['value', 'ruled', 'why'].includes(f)) problems.push(`${key}: unknown field "${f}"`);
    entries[key] = { value: numberOf(entry.value), written: entry.value, source: 'ruled', ruled: entry.ruled, why: entry.why };
  }
  if (problems.length) return { refused: problems, file: where };
  for (const [key, spec] of Object.entries(SCHEMA)) {
    if (entries[key]) continue;
    entries[key] = 'default' in spec
      ? { value: spec.default, written: spec.default, source: 'default' }
      : { value: null, written: null, source: 'unruled' };
  }
  const values = Object.fromEntries(Object.keys(SCHEMA).sort().map(k => [k, entries[k].value]));
  const id = crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 12);
  return { file: where, exists: !!doc, entries, values, id };
}

// The value a tool needs, or the reason it may not judge. Never a silent fallback.
function need(settings, key) {
  if (!SCHEMA[key]) throw new Error(`project-settings: ${key} is not in the schema`);
  if (!settings || settings.refused) return { notMeasured: `settings refused: ${(settings && settings.refused || ['none loaded']).join('; ')}` };
  const e = settings.entries[key];
  if (e.source === 'unruled') return { notMeasured: `${key} is not ruled (${SCHEMA[key].about}) — set it in ${settings.file}` };
  return { value: e.value, source: e.source };
}

// One line for a report header: where the numbers came from, and the id that pins them.
const headline = s => s.refused ? `settings    REFUSED (${s.file || 'no file'}): ${s.refused.join('; ')}`
  : `settings    ${s.id} · ${s.exists ? s.file : `${s.file} (absent: defaults only)`} · ${Object.values(s.entries).filter(e => e.source === 'ruled').length} ruled, ${Object.values(s.entries).filter(e => e.source === 'default').length} default, ${Object.values(s.entries).filter(e => e.source === 'unruled').length} unruled`;

function main(argv) {
  const out = s => process.stdout.write(s + '\n');
  const arg = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const project = arg('--project'), file = arg('--settings');
  if (!project && !file) { process.stderr.write('usage: project-settings.js --project <name> | --settings <file>\n'); return 2; }
  const s = load({ project, file });
  out(headline(s));
  if (s.refused) return 2;
  for (const key of Object.keys(SCHEMA)) {
    const e = s.entries[key], spec = SCHEMA[key];
    const shown = e.source === 'unruled' ? 'NOT RULED' : (e.written !== e.value ? `${e.written} (${+e.value.toPrecision(6)})` : String(e.value));
    const tag = e.source === 'ruled' ? `ruled ${e.ruled}` : e.source === 'default' ? 'default, not ruled' : 'must be ruled before ' + spec.readBy + ' can judge';
    out(`  ${key.padEnd(40)} ${shown.padEnd(18)} ${tag}`);
    if (e.why) out(`  ${''.padEnd(40)} why: ${e.why}`);
  }
  return 0;
}

if (require.main === module) {
  process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  process.exitCode = main(process.argv.slice(2));
}
module.exports = { SCHEMA, load, need, headline, pathFor, main };

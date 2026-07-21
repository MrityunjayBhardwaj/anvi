#!/usr/bin/env node
// Unit test for the vendored-source freshness feature (#61) in hooks/currency.js.
// Covers: the STRICT manifest parser against hostile inputs, the manifest-path
// derivation for both ref spellings, and readVendorFor + computeCurrency end-to-end
// with an injected readVendor (no real store touched).
'use strict';
const {
  parseVendorManifest, vendorManifestRel, readVendorFor,
  computeCurrency, nudgeFor,
} = require('../hooks/currency.js');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

// --- parseVendorManifest: STRICT contract, hostile inputs -------------------
// The gate is "parse → plain object → has(version, versionSource) → surface, else
// absent". A broken manifest must read as ABSENT (null), never crash, never be
// dressed up as an honest null-version.
console.log('parseVendorManifest — valid');
const good = JSON.stringify({ source: 's', url: 'u', version: '4.6.0', versionSource: 'runtime.rb:1436', fetchDate: '2026-04-06' });
eq(parseVendorManifest(good).version, '4.6.0', 'valid manifest → version surfaced');
eq(parseVendorManifest(good).versionSource, 'runtime.rb:1436', 'versionSource surfaced');
eq(parseVendorManifest(good).fetchDate, '2026-04-06', 'fetchDate surfaced');
// A DELIBERATE null version WITH a citation is honest → surfaced with version:null.
const honestNull = JSON.stringify({ version: null, versionSource: 'NOT FOUND IN CODE' });
const hn = parseVendorManifest(honestNull);
ok(hn && hn.version === null, 'deliberate null version + citation → surfaced as null (honest)');
eq(hn.versionSource, 'NOT FOUND IN CODE', 'honest-null keeps its citation');

console.log('parseVendorManifest — hostile inputs all → null (absent)');
ok(parseVendorManifest('{not json') === null, 'unparseable JSON → null');
ok(parseVendorManifest('[1,2,3]') === null, 'JSON array → null (typeof-object trap)');
ok(parseVendorManifest('"a string"') === null, 'JSON scalar string → null');
ok(parseVendorManifest('42') === null, 'JSON number → null');
ok(parseVendorManifest('null') === null, 'literal null → null');
ok(parseVendorManifest('{}') === null, 'empty object (no version/versionSource) → null, NOT honest-null');
ok(parseVendorManifest(JSON.stringify({ version: '1.0' })) === null, 'missing versionSource → null (broken, not honest)');
ok(parseVendorManifest(JSON.stringify({ versionSource: 'x' })) === null, 'missing version key → null');
ok(parseVendorManifest(JSON.stringify({ version: '1.0', versionSource: '' })) === null, 'empty versionSource → null (no real citation)');
ok(parseVendorManifest(JSON.stringify({ version: '1.0', versionSource: '   ' })) === null, 'whitespace versionSource → null');
ok(parseVendorManifest(JSON.stringify({ version: 5, versionSource: 'x' })) === null, 'non-string non-null version → null');

// --- vendorManifestRel: both spellings the corpus uses ----------------------
console.log('vendorManifestRel — path shapes');
eq(vendorManifestRel('sources/desktop-sp/runtime.rb'), 'sources/desktop-sp/VENDOR.json', 'reference hit path → manifest');
eq(vendorManifestRel('ref/sources/desktop-sp/sound.rb'), 'sources/desktop-sp/VENDOR.json', 'raw ref/ spec → same manifest');
eq(vendorManifestRel('sources/desktop-sp/a/b/c.rb'), 'sources/desktop-sp/VENDOR.json', 'deep file → source-root manifest');
ok(vendorManifestRel('src/engine/App.ts') === null, 'a project file → null (not vendored)');
ok(vendorManifestRel('ref/GROUND_TRUTH_X.md') === null, 'a GT doc (not under sources/) → null');
ok(vendorManifestRel('sources') === null, 'too short → null');
ok(vendorManifestRel(null) === null, 'non-string → null');

// --- readVendorFor: keys on path shape, reads via injected reader -----------
console.log('readVendorFor — injected reader');
const store = { 'sources/desktop-sp/VENDOR.json': good };
const reader = (rel) => (rel in store ? store[rel] : null);
// a 'present' vendored file (spec ref/sources/...) with no reference classification
ok(readVendorFor([{ file: 'ref/sources/desktop-sp/sound.rb' }], reader).version === '4.6.0',
   'present vendored file (raw spec) → manifest found');
// a 'reference' hit (referencePath sources/...)
ok(readVendorFor([{ reference: true, area: 'ref/sources', referencePath: 'sources/desktop-sp/x.rb' }], reader).version === '4.6.0',
   'reference hit (referencePath) → manifest found');
ok(readVendorFor([{ file: 'src/engine/App.ts' }], reader) === undefined, 'non-vendored file → undefined');
ok(readVendorFor([{ file: 'ref/sources/other/x.rb' }], reader) === undefined, 'vendored dir with no manifest in store → undefined');
ok(readVendorFor([{ file: 'ref/sources/desktop-sp/x.rb' }], null) === undefined, 'no reader injected → undefined (non-store caller)');
ok(readVendorFor([{ file: 'ref/sources/desktop-sp/x.rb' }], () => { throw new Error('boom'); }) === undefined,
   'reader that throws → undefined (never crashes)');
// Multi-vendor: an entry citing a null-version source AND a versioned one prefers the
// versioned — surfacing a real version beats "un-captured".
const multiStore = {
  'sources/nullv/VENDOR.json': JSON.stringify({ version: null, versionSource: 'NOT FOUND IN CODE' }),
  'sources/desktop-sp/VENDOR.json': good,
};
const multiReader = (rel) => (rel in multiStore ? multiStore[rel] : null);
eq(readVendorFor([{ file: 'ref/sources/nullv/a.rb' }, { file: 'ref/sources/desktop-sp/b.rb' }], multiReader).version, '4.6.0',
   'versioned manifest preferred over a null-version one, regardless of citation order');
ok(readVendorFor([{ file: 'ref/sources/nullv/a.rb' }], multiReader).version === null,
   'a lone null-version manifest is still surfaced (honest fallback)');

// --- computeCurrency: vendor rides EVERY verdict color ----------------------
// Mock a repo where the project file is present + drifted (→ YELLOW) or clean (→ GREEN),
// and one ref is a vendored desktop-sp file. Confirm the vendor attaches regardless.
console.log('computeCurrency — vendor attaches across verdict colors');
const mkGit = (drift) => (args) => {
  if (args.startsWith('log') && args.includes('--format=%h') && args.includes('App.ts')) return drift ? 'aaa\nbbb' : '';
  if (args.startsWith('ls-files')) return '';           // no glob/shorthand resolution needed
  if (args.startsWith('log') && args.includes('-1')) return 'x';  // history exists
  return '';
};
const fileExists = (rel) => rel === 'src/engine/App.ts';  // the project file is present
const refResolver = (spec) => (spec.startsWith('sources/desktop-sp/') || spec.startsWith('ref/sources/desktop-sp/'))
  ? { path: spec.replace(/^ref\//, ''), area: 'ref/sources' } : null;
const baseOpts = (drift) => ({
  git: mkGit(drift), fileExists, refResolver, readVendor: reader,
  fileExt: /\.(ts|rb)$/i,   // fileExt is a RegExp (extensionsFrom returns one)
});
const mixedEntry = { id: 'X1', refField: 'src/engine/App.ts, ref/sources/desktop-sp/sound.rb', validatedField: 'v1 2026-01-01' };

// A mixed entry with a present+drifted project file and a vendored ref. Whatever
// status it lands on (GRAY without a resolvable anchor here — the mock keeps anchoring
// out of scope), the vendor MUST attach and its version tail MUST reach the nudge.
const yv = computeCurrency(mixedEntry, baseOpts(true));
ok(yv.vendor && yv.vendor.version === '4.6.0', `mixed entry carries vendor across colors (status ${yv.status})`);
const yn = nudgeFor(yv, { id: 'X1' });
ok(yn && /v4\.6\.0/.test(yn), `nudge for a vendored entry carries the version tail (status ${yv.status})`);

// A PURELY vendored entry (all refs in ref/sources, no project file) → 🔵 REFERENCE,
// deterministic (no anchor needed). Its message states the traced version.
const pureEntry = { id: 'X2', refField: 'ref/sources/desktop-sp/sound.rb, ref/sources/desktop-sp/core.rb' };
const rv = computeCurrency(pureEntry, baseOpts(false));
eq(rv.status, 'REFERENCE', 'purely-vendored entry → REFERENCE');
ok(rv.vendor && rv.vendor.version === '4.6.0', 'pure-reference entry carries vendor');
ok(/traced against `v4\.6\.0`/.test(nudgeFor(rv, { id: 'X2' })), 'REFERENCE nudge states the traced version');

// absent manifest → NO vendor, verdict otherwise identical (no regression)
const noManifest = () => null;
const yv2 = computeCurrency(mixedEntry, { ...baseOpts(true), readVendor: noManifest });
ok(yv2.vendor === undefined, 'absent manifest → no vendor attached');
eq(yv2.status, yv.status, 'absent manifest → same status (vendor is additive, no regression)');
const rv2 = computeCurrency(pureEntry, { ...baseOpts(false), readVendor: noManifest });
ok(rv2.vendor === undefined, 'absent manifest on pure entry → no vendor');
ok(!/v4\.6\.0/.test(nudgeFor(rv2, { id: 'X2' })), 'absent manifest → plain 🔵, no version (no regression)');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// Test: every git command the framework tells anyone to run against the knowledge store
// stages and commits by PATHSPEC, never the whole index (issue #621).
//
// WHY. `~/.anvideck` is one repository shared by every project and every session on the
// machine. `git add -A` there stages other sessions' work; a `git commit` without a pathspec
// takes everything already staged — another session's half-finished harvest included — into
// this commit, under this message. The checkpoint hook and the wrap were fixed for that long
// ago (#419/#420, #430); the debug and execute-phase workflows kept a hand-written
// `cd ~/.anvideck && git add -A && git commit`, and a doctor remedy printed a scoped add
// followed by a bare commit. Three doors, one shape.
//
// WHAT COUNTS AS A COMMAND. Not the fence: the execute-phase door was an INLINE code span,
// so a fence-only scan would have passed it. Candidates are inline spans, fenced lines and
// indented lines in Markdown, and every uncommented line in scripts. A candidate is a STORE
// command only when its own text targets the store — `git -C <store>`, or a `cd <store>`
// earlier in the same command — so prose that merely NAMES `git add -A` is not a command.
//
// WHAT IT DOES NOT SEE. Commits built as argv arrays (`spawnSync('git', [...])`) — the
// checkpoint hook's — have no shell text to read; they have their own tests.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const DIRS = ['workflows', 'agents', 'skills', 'commands', 'copilot-compat', 'cognitive-os', 'templates', 'scripts', 'hooks'];

// The store, however a command spells it.
const STORE = /(?:~|\$HOME|\$\{HOME\})\/\.anvideck\b|\$\{?STORE(?:_ROOT)?\}?(?![A-Za-z0-9_])|\$\{store\.root\}/;

// Sites allowed to stage or commit without a pathspec, each with the reason. Every entry
// must still match a site, so an exemption cannot outlive the code it excused.
const ALLOWED = [
  { file: 'scripts/ensure-store-durable.sh', match: /git -C "\$STORE" add -A\b/,
    why: 'first commit of a store that has none — `git init` or no HEAD — so there is no earlier staged work to sweep in' },
  { file: 'scripts/ensure-store-durable.sh', match: /commit -q -m "📦 Initialize anvi_artifacts store"/,
    why: 'the same bootstrap commit, called only from the two no-HEAD sites above' },
];

// Join continuation lines: a trailing `\`, `&&`, `||` or `|` hands on to the next line.
// Each joined command keeps the 1-based number of the line it starts on.
function logical(lines, first = 1) {
  const out = [];
  let cur = null, at = 0;
  lines.forEach((l, i) => {
    if (cur === null) { cur = l; at = first + i; } else cur = `${cur} ${l.trim()}`;
    if (/(\\|&&|\|\||\|)\s*$/.test(cur)) { cur = cur.replace(/\\\s*$/, ''); return; }
    out.push({ text: cur, line: at }); cur = null;
  });
  if (cur !== null) out.push({ text: cur, line: at });
  return out;
}

// Command candidates in one file, each with the line it starts on.
function candidates(rel, text) {
  const lines = text.split('\n');
  const out = [];
  if (!rel.endsWith('.md')) {
    // Scripts: whole lines, comments dropped — a comment that quotes a command is a mention.
    return logical(lines.map(l => (/^\s*(\/\/|\*|#)/.test(l) ? '' : l)));
  }
  let inFence = false, block = [], blockAt = 0;
  const flush = () => { out.push(...logical(block, blockAt)); block = []; };
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { if (inFence) flush(); inFence = !inFence; blockAt = i + 2; return; }
    if (inFence || /^( {4,}|\t)\S/.test(l)) { if (!block.length) blockAt = i + 1; block.push(l); return; }
    if (block.length) flush();
    for (const m of l.matchAll(/`([^`]+)`/g)) out.push({ text: m[1], line: i + 1 });
  });
  flush();
  return out;
}

// git's own subcommand: the first word after `git` and its global options. A word that
// only APPEARS later — `push    # the commit above printed your sha` — is not the verb.
function subcommand(args) {
  const t = args.trim().split(/\s+/);
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '-C' || t[i] === '-c') { i++; continue; }
    if (t[i].startsWith('-')) continue;
    return t[i];
  }
  return '';
}

// A shell comment starts at a `#` after whitespace, outside quotes — `"… PR #N …"` is not one.
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}

// The store git commands in one candidate that stage or commit without a pathspec.
// A segment is read from its first `cd` or `git` word, so a command embedded in a string
// (`{ remedy: \`cd … && git commit\` }`) or a substitution (`err="$(git …`) still counts.
function violations(text) {
  const found = [];
  let inStore = false;
  for (const seg of text.split(/&&|\|\||;|\|/)) {
    const at = seg.search(/(?:^|[\s`'"({$])(cd|git)\s/);
    if (at < 0) continue;
    const s = seg.slice(at).replace(/^[\s`'"({$]/, '').trim();
    const s2 = stripComment(s);
    if (/^cd\s/.test(s2)) { inStore = STORE.test(s2); continue; }
    const args = s2.slice(3);
    const verb = subcommand(args);
    if (verb !== 'add' && verb !== 'commit') continue;
    const before = args.slice(0, args.search(new RegExp(`\\s${verb}\\b`)));
    const targetsStore = /(^|\s)-C\s/.test(before) ? STORE.test(before) : inStore;
    if (targetsStore && !/\s--(\s|$)/.test(s2)) found.push(`${verb} without a pathspec: ${s2}`);
  }
  return found;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(md|js|cjs|sh)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

console.log('\nTHE MATCHER — fires on the whole-index shapes, quiet on the scoped ones and on mentions:');
const must = [
  'cd ~/.anvideck && git add -A && git commit -m "x" && git push',
  'git -C ~/.anvideck add -A',
  'git -C "$STORE" commit -q -m "x"',
  'cd "${store.root}" && git add -A -- "${rel}" && git commit && git push',
  'git -C $HOME/.anvideck commit -m "x"',
  '{ remedy: `cd "${store.root}" && git commit && git push` }',   // inside a JS string
  'if err="$(git -C "$STORE" commit -q -m "x" 2>&1)"; then',       // inside a substitution
];
const mustNot = [
  'git -C ~/.anvideck add -- projects/p/.anvi/ && git -C ~/.anvideck commit -m "x" -- projects/p/.anvi/',
  'git -C "$STORE_ROOT" add -A -- "$STORE_PM"',
  'git add -A',                                       // a mention: no store in the command
  'cd ~/.anvideck && git push',
  'git -C "$PROJ" commit -q -m "x"',                  // another repository
  'cd ~/.anvideck && cd ~/repo && git commit -m "x"', // left the store before committing
  'git -C ~/.anvideck push    # the commit above printed your sha', // `commit` in a comment
  'git -C ~/.anvideck commit -m "fixed in PR #N" -- projects/p/.anvi/', // `#` inside the message
];
for (const c of must) ok(violations(c).length > 0, `fires: ${c}`);
for (const c of mustNot) ok(violations(c).length === 0, `quiet: ${c}`);
ok(candidates('x.md', 'Run `cd ~/.anvideck && git add -A` now.').some(c => violations(c.text).length),
   'an INLINE code span is a candidate — the shape the execute-phase door was written in');
ok(candidates('x.md', '    git -C ~/.anvideck add -A &&\n      git -C ~/.anvideck commit -m "x"\n').length === 1,
   'an indented block joins its continuation lines into one command');
ok(candidates('x.js', '// `git -C ~/.anvideck commit …` is what we guard\n').every(c => !violations(c.text).length),
   'a comment that quotes a command is not a command');

console.log('\nTHE CORPUS — every store command in the shipped text:');
const files = DIRS.flatMap(d => walk(path.join(ROOT, d))).concat([path.join(ROOT, 'install.sh')]);
let storeCommands = 0;
const bad = [];
const used = new Set();
for (const f of files) {
  const rel = path.relative(ROOT, f);
  for (const c of candidates(rel, fs.readFileSync(f, 'utf8'))) {
    if (STORE.test(c.text) && /\bgit\b/.test(c.text)) storeCommands++;
    for (const v of violations(c.text)) {
      const a = ALLOWED.findIndex(x => x.file === rel && x.match.test(c.text));
      if (a >= 0) { used.add(a); continue; }
      bad.push(`${rel}:${c.line} — ${v}`);
    }
  }
}
ok(files.length > 50 && storeCommands >= 4, `CONTROL — the walk read ${files.length} files and found ${storeCommands} store git commands`);
ok(bad.length === 0, `no store command stages or commits the whole index (${bad.length} found)${bad.map(b => '\n      ' + b).join('')}`);
ALLOWED.forEach((x, i) => ok(used.has(i), `the exemption still names a real site: ${x.file} — ${x.why}`));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

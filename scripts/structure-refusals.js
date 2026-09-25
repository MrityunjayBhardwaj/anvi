#!/usr/bin/env node
// Count what the structure guard actually said to real sessions in an armed package (issue #547).
//
// WHY THIS EXISTS. An armed package's trial is ruled on its refusals: the first wrong one
// disarms it. But the hook logs only its own crashes — a refusal leaves no record of its own, and
// one the agent routes around (a different import, or the same change through Bash) never
// reaches the user. Without this, "no wrong refusal" cannot be told from "no refusal noticed".
//
// WHAT IT READS — the shapes OBSERVED on Claude Code 2.1.282, not guessed:
//   · a REFUSAL is the tool call's `tool_result` with `is_error: true` whose content begins
//     `PreToolUse:<Tool> hook error: BLOCKED: this edit to ` — the hook's reason, verbatim.
//     The record's `toolDenialKind` is `permission-rule`, but that also marks ordinary
//     permission rules, so the content is what identifies the guard.
//   · a NOTICE (said, not refused) is an `attachment` of type `hook_success`, hookName
//     `PreToolUse:<Tool>`, whose `stdout` is the hook's JSON with `additionalContext`
//     beginning `structure guard:`.
// Every Write/Edit/MultiEdit call whose file is under the package, in the window, is counted,
// so a zero is printed as 0 OF N edits the guard judged or passed — never as a bare zero.
//
// THE SHAPE HAS ALREADY CHANGED ONCE — measured over every `permission-rule` record on this
// machine: a hook's refusal was recorded BARE (`BLOCKED: …`) on 2.1.260–2.1.277 (123 records)
// and WRAPPED (`PreToolUse:<Tool> hook error: BLOCKED: …`) from 2.1.278. Both are read.
// A CHANGED SHAPE IS SAID, NEVER READ AS ZERO (#549): the guard's own words survive a change of
// wrapper, so on every errored call in the package, those words outside both known shapes are
// UNRECOGNISED, and while any exist no clean zero is printed. That fires on the first drifted
// refusal and never on a version that did not drift, so no per-version capture is kept. A
// denial WITHOUT the guard's words is another hook's or a permission rule's — the two cannot
// be told apart from the record (2.1.281 recorded a settings rule the same way) — so it is
// counted where it can be seen, not called drift.
//
// Usage:
//   node scripts/structure-refusals.js --package <dir> --since <ISO time>
//        [--until <ISO time>] [--transcripts <dir>] [--json <out.json>]
//   --transcripts defaults to ~/.claude/projects: the guard runs in EVERY session on the machine,
//   so a session started in another project that edits the package is read too.
//
// Exit: 0 read, no refusal · 1 read, at least one refusal (each needs a person's ruling: right
//       or wrong) · 2 not measured (no transcripts, no edit in the package in the window, or no refusal
//       recognised while some denial was recorded in a shape this reader does not know)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
// The guard's opening words, bare or in Claude Code's wrapper.
const REFUSAL = /^(?:PreToolUse:(?:Write|Edit|MultiEdit) hook error: )?BLOCKED: this edit to /;
// The guard's own words: they survive a change of wrapper, so finding them outside the known
// shape means the shape moved, not that the guard went quiet.
const GUARD_WORDS = /BLOCKED: this edit to .* adds \d+ import/;
const VIOLATION = /^\s*·\s*(layer|cycle):\s*(\S+ -> \S+)\s*$/gm;
// What each notice says, by its own opening words (hooks/structure-guard-hook.js).
const NOTICE_KINDS = [
  ['on disk', /already on disk but not in its baseline/],
  ['fixed', /fixed since its baseline/],
  ['not measured', /NOT MEASURED/],
  ['failed', /FAILED and allowed the edit/],
];

function listTranscripts(dir) {
  const out = [];
  const walk = d => {
    let names;
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map(b => (b && typeof b.text === 'string') ? b.text : '').join('') : '';

// The package's directory as the transcripts may spell it: as given, and through symlinks.
function spellings(dir) {
  const out = new Set([path.resolve(dir)]);
  try { out.add(fs.realpathSync(dir)); } catch { /* a package that is gone is still read by name */ }
  return [...out].map(d => d.replace(/\/+$/, '') + '/');
}

// One transcript: every package edit in the window, and what the guard said about each.
function readTranscript(file, prefixes, since, until) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { unreadable: true, calls: [] }; }
  if (!prefixes.some(p => raw.includes(p))) return { calls: [] };
  const calls = new Map();
  const results = [], attachments = [];
  let badLines = 0;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { badLines++; continue; }
    if (r.type === 'attachment' && r.attachment) { attachments.push(r.attachment); continue; }
    const content = r.message && r.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use' && TOOLS.has(b.name)) {
        const fp = b.input && b.input.file_path;
        const ts = r.timestamp || '';
        if (typeof fp !== 'string' || ts < since || (until && ts >= until)) continue;
        const pre = prefixes.find(p => fp.startsWith(p));
        if (!pre) continue;
        calls.set(b.id, { id: b.id, tool: b.name, file: fp.slice(pre.length), at: ts, version: r.version || null,
          session: r.sessionId || r.session_id || path.basename(file, '.jsonl'), transcript: file,
          outcome: 'no result', violations: [], notices: [] });
      } else if (b.type === 'tool_result') {
        results.push({ block: b, denialKind: r.toolDenialKind || null });
      }
    }
  }
  for (const { block: b, denialKind } of results) {
    const c = calls.get(b.tool_use_id);
    if (!c) continue;
    const text = textOf(b.content);
    if (!b.is_error) { c.outcome = 'applied'; continue; }
    if (REFUSAL.test(text)) {
      c.outcome = 'refused';
      c.reason = text;
      c.violations = [...text.matchAll(VIOLATION)].map(m => ({ rule: m[1], key: m[2] }));
    } else if (GUARD_WORDS.test(text)) { c.outcome = 'unrecognised'; c.reason = text; }
    // A user's rejection is its own kind, and is not this.
    else if (denialKind === 'permission-rule' || /^PreToolUse:\w+ hook error: /.test(text)) c.outcome = 'denied otherwise';
    else c.outcome = 'errored';
  }
  for (const a of attachments) {
    const c = calls.get(a.toolUseID);
    if (!c || a.type !== 'hook_success' || !/^PreToolUse:/.test(a.hookName || '')) continue;
    let ctx = '';
    try { ctx = ((JSON.parse(a.stdout || '{}').hookSpecificOutput) || {}).additionalContext || ''; } catch { continue; }
    if (!/^structure guard:/.test(ctx)) continue;
    // One output may join several notices (#544), so every kind it names is counted.
    for (const [kind, re] of NOTICE_KINDS) if (re.test(ctx)) c.notices.push(kind);
  }
  return { calls: [...calls.values()], badLines };
}

const FLAGS = new Set(['package', 'since', 'until', 'transcripts', 'json']);

function main(argv) {
  const args = {};
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { unknown.push(a); continue; }
    const name = a.slice(2);
    if (FLAGS.has(name) && i + 1 < argv.length) args[name] = argv[++i]; else unknown.push(a);
  }
  const print = s => console.log(s);
  const stop = why => { print(`structure-refusals: NOT MEASURED — ${why}`); return 2; };
  if (unknown.length) return stop(`unrecognised argument(s): ${unknown.join(' ')}`);
  for (const k of ['package', 'since']) if (!args[k]) return stop(`--${k} is required`);
  const iso = s => { const d = new Date(s); return isNaN(d) ? null : d.toISOString(); };
  const since = iso(args.since), until = args.until ? iso(args.until) : null;
  if (!since) return stop(`--since is not a time: ${args.since}`);
  if (args.until && !until) return stop(`--until is not a time: ${args.until}`);

  const dir = path.resolve(args.transcripts || path.join(os.homedir(), '.claude', 'projects'));
  const files = listTranscripts(dir);
  if (!files.length) return stop(`no transcripts under ${dir}`);
  const prefixes = spellings(args.package);
  const read = files.map(f => readTranscript(f, prefixes, since, until));
  const calls = read.flatMap(r => r.calls).sort((a, b) => a.at.localeCompare(b.at));
  const unreadable = read.filter(r => r.unreadable).length;
  const badLines = read.reduce((n, r) => n + (r.badLines || 0), 0);

  const count = k => calls.filter(c => c.outcome === k).length;
  const refused = calls.filter(c => c.outcome === 'refused');
  const notices = {};
  for (const c of calls) for (const k of c.notices) notices[k] = (notices[k] || 0) + 1;
  const sessions = new Set(calls.map(c => c.session));

  print(`structure-refusals: ${prefixes[0].replace(/\/$/, '')} · ${since}${until ? ` → ${until}` : ' → now'}`);
  print(`  read: ${files.length} transcripts under ${dir}` + (unreadable ? ` (${unreadable} unreadable)` : '') +
        (badLines ? ` · ${badLines} unparseable lines skipped` : ''));
  print(`  edits in the package: ${calls.length} Write/Edit/MultiEdit calls in ${sessions.size} sessions — ` +
        `${count('applied')} applied · ${refused.length} REFUSED by the guard · ${count('denied otherwise')} denied by another hook or a permission rule · ` +
        `${count('errored')} errored otherwise · ${count('no result')} with no result`);
  print(`  notices said (not refused): ` + NOTICE_KINDS.map(([k]) => `${k} ${notices[k] || 0}`).join(' · '));
  const unrecognised = calls.filter(c => c.outcome === 'unrecognised');
  const byVersion = {};
  for (const c of calls) { const v = c.version || 'unknown'; byVersion[v] = (byVersion[v] || 0) + 1; }
  if (calls.length) print(`  Claude Code versions among these edits: ` + Object.entries(byVersion).sort().map(([v, k]) => `${v} ×${k}`).join(' · '));
  print(`  denials in an UNRECOGNISED shape: ${unrecognised.length}`);
  if (!calls.length) {
    print('');
    return stop('no edit in the package in this window — a zero here is not evidence of anything');
  }
  // Said beside every outcome it qualifies, including a refusal: a shape that moved can hide
  // further refusals behind the ones that were recognised.
  const unrecognisedText = `${unrecognised.length} of ${calls.length} edits were denied in a shape this reader does not know ` +
    `(${unrecognised.slice(0, 3).map(c => `${c.at} ${c.file} on ${c.version || 'unknown'}: "${String(c.reason).slice(0, 70)}"`).join('; ')}) — ` +
    'Claude Code has likely changed how it records a hook denial. Read those calls, then update the shape here before reading this as zero.';
  if (refused.length) {
    print(`\n  REFUSALS — ${refused.length} of ${calls.length} edits; each needs a ruling, right or wrong:`);
    refused.forEach((c, i) => {
      print(`    ${i + 1}. ${c.at} ${c.session.slice(0, 8)} ${c.tool} ${c.file}`);
      for (const v of c.violations) print(`         ${v.rule.padEnd(6)} ${v.key}`);
      if (!c.violations.length) print('         (no violation line could be read from the reason — read the transcript)');
    });
    if (unrecognised.length) print(`  UNRECOGNISED: ${unrecognisedText}`);
  } else if (unrecognised.length) {
    print(`\n  no refusal RECOGNISED — but UNRECOGNISED: ${unrecognisedText}`);
  } else print(`\n  no refusal in ${calls.length} edits.`);

  if (args.json) {
    fs.writeFileSync(path.resolve(args.json), JSON.stringify({ package: prefixes[0], since, until, transcripts: files.length,
      unreadable, badLines, calls: calls.map(({ reason, ...c }) => c) }, null, 1) + '\n');
    print(`  report: ${path.resolve(args.json)}`);
  }
  // Refused → a ruling is owed · nothing recognised but denials unread → not measured, not clean.
  return refused.length ? 1 : unrecognised.length ? 2 : 0;
}

module.exports = { readTranscript, spellings, REFUSAL, GUARD_WORDS, VIOLATION, NOTICE_KINDS };

if (require.main === module) process.exit(main(process.argv.slice(2)));

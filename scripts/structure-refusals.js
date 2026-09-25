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
// Usage:
//   node scripts/structure-refusals.js --package <dir> --since <ISO time>
//        [--until <ISO time>] [--transcripts <dir>] [--json <out.json>]
//   --transcripts defaults to ~/.claude/projects: the guard runs in EVERY session on the machine,
//   so a session started in another project that edits the package is read too.
//
// Exit: 0 read, no refusal · 1 read, at least one refusal (each needs a person's ruling: right
//       or wrong) · 2 not measured (no transcripts, or no edit in the package in the window)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const REFUSAL = /^PreToolUse:(Write|Edit|MultiEdit) hook error: BLOCKED: this edit to /;
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
        calls.set(b.id, { id: b.id, tool: b.name, file: fp.slice(pre.length), at: ts,
          session: r.sessionId || r.session_id || path.basename(file, '.jsonl'), transcript: file,
          outcome: 'no result', violations: [], notices: [] });
      } else if (b.type === 'tool_result') {
        results.push(b);
      }
    }
  }
  for (const b of results) {
    const c = calls.get(b.tool_use_id);
    if (!c) continue;
    const text = textOf(b.content);
    if (b.is_error && REFUSAL.test(text)) {
      c.outcome = 'refused';
      c.reason = text;
      c.violations = [...text.matchAll(VIOLATION)].map(m => ({ rule: m[1], key: m[2] }));
    } else c.outcome = b.is_error ? 'errored' : 'applied';
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
        `${count('applied')} applied · ${refused.length} REFUSED by the guard · ${count('errored')} errored otherwise · ${count('no result')} with no result`);
  print(`  notices said (not refused): ` + NOTICE_KINDS.map(([k]) => `${k} ${notices[k] || 0}`).join(' · '));
  if (!calls.length) {
    print('');
    return stop('no edit in the package in this window — a zero here is not evidence of anything');
  }
  if (refused.length) {
    print(`\n  REFUSALS — ${refused.length} of ${calls.length} edits; each needs a ruling, right or wrong:`);
    refused.forEach((c, i) => {
      print(`    ${i + 1}. ${c.at} ${c.session.slice(0, 8)} ${c.tool} ${c.file}`);
      for (const v of c.violations) print(`         ${v.rule.padEnd(6)} ${v.key}`);
      if (!c.violations.length) print('         (no violation line could be read from the reason — read the transcript)');
    });
  } else print(`\n  no refusal in ${calls.length} edits.`);

  if (args.json) {
    fs.writeFileSync(path.resolve(args.json), JSON.stringify({ package: prefixes[0], since, until, transcripts: files.length,
      unreadable, badLines, calls: calls.map(({ reason, ...c }) => c) }, null, 1) + '\n');
    print(`  report: ${path.resolve(args.json)}`);
  }
  return refused.length ? 1 : 0;
}

module.exports = { readTranscript, spellings, REFUSAL, VIOLATION, NOTICE_KINDS };

if (require.main === module) process.exit(main(process.argv.slice(2)));

#!/usr/bin/env node
// task-telemetry.js — what one task did, read from the record of a real session (#712).
//
// WHY THIS EXISTS. The judge of a design is the agent's path on real work (design document
// `architecture-ownership-2026-11-02.md` §5.3, "live telemetry"): which files a task read and
// edited, which components it touched, whether it edited outside its blast radius, and what was
// refused. The live test (#711) gets those figures from fixed replayed tasks; this report gets the
// same figures from sessions that happened, so the two can be read side by side.
//
// WHERE EACH FIGURE COMES FROM — observed, not assumed (Claude Code 2.1.316–2.1.318, 2026-11-05):
//   · Files read and edited come from the SESSION TRANSCRIPTS, never the hook meter. The meter's
//     row is { ts, sid, hook, event, bytes, ms, outcome }: it names no tool and no file, so it
//     cannot say what was read or edited. The route logger records only reads of anvi's own spec
//     files and workflows. Each file is the tool call's OPERATED FIELD — `file_path` for Read,
//     Edit, Write and MultiEdit, `notebook_path` (else `file_path`) for NotebookEdit — never prose.
//     A call counts only when its `tool_result` came back without `is_error`.
//   · Refusals come from the transcript too: a tool_result with `is_error` whose content is the
//     structure guard's refusal (its words, matched by the patterns `structure-refusals.js`
//     exports), or another hook's `PreToolUse:<Tool> hook error:`, or a permission rule
//     (`toolDenialKind: permission-rule`, or `Permission to use <Tool> has been denied`). A user's
//     rejection and an interruption are counted apart: neither is a refusal.
//   · The hook meter gives the cross-check: its rows for the session with outcome `refused`, per
//     hook. A permission rule in settings is not a hook and leaves no meter row, so the two counts
//     are printed side by side, never reconciled by arithmetic.
//   · Components come from the design (`componentOf` in hooks/structure-rules.js) and its id from
//     `designId` — the design given with --design, else the structure guard's registry entry for
//     --package. Files are matched to the package in any checkout of its repository by the
//     guard's own rule (`checkoutMatch`), so work done in a worktree is counted.
//
// WHAT A TASK IS HERE. One session: its main transcript and every subagent transcript that
// carries the same `sessionId`, optionally narrowed to a time span with --since/--until. Why not a
// branch or an issue: the hook meter and the refusal records key on the session id, so a session
// is the finest unit every source can be cut by. The record's `gitBranch` is the branch of the
// session's working directory, not of the checkout being edited: a session started on `main` that
// does all its work in a worktree records `main` on every line. An issue number appears only in
// prose, which this report never reads. So a span inside a session is given explicitly, by time,
// and the definition in force is printed on every report.
//
// THE RADIUS. Until the proposer places a task (#723) and the write-scope check reads that radius
// (#716), the radius is what the caller gives: --radius with component names of the design and/or
// file paths (relative to the package, or absolute). It is NEVER defaulted: without one the report
// says "radius: none given — out-of-radius NOT MEASURED". A radius can be widened during a task
// (--widen <ISO time>=<items>); each edit is judged against the radius in force at its own time,
// and the radius size and the number of widenings print beside the out-of-radius count, because
// that count reaches zero by widening as easily as by better placement (design §7.4a rule 16).
//
// COLUMNS AND UNITS — the contract the live test (#711) reuses, so its figures and these compare:
//   files_read         distinct files (absolute path through symlinks) with ≥1 Read that succeeded
//   files_edited       distinct files with ≥1 Edit/Write/MultiEdit/NotebookEdit that succeeded
//   components_touched distinct design components among files_edited inside the package
//                      (a file under the design root in no component is counted as `unmapped`,
//                      and a package file outside the design root as `outside_root`, each apart)
//   outside_radius     distinct files inside the package edited (successfully) while outside the
//                      radius in force; beside it the applied edit calls that made them
//   radius_size        components + files in the radius at the end of the task (and at its start)
//   widenings          how many times the radius was widened during the task
//   refusals           tool calls refused, split: structure guard · another hook or permission rule
//   design_id          the 12-character id of the design the components were read from
// #711 adds placement (share of edits in the ledger's home; out-of-home edits) and attempts; those
// are not this report's columns.
//
// What the record cannot contain, said on every report: a file changed through Bash (sed, a
// script, git) names no operated file, so it is never counted as edited — the count of Bash calls
// in the task prints beside the figures as the door this report cannot see through.
//
// Usage:
//   node scripts/task-telemetry.js --session <id> [--since <ISO>] [--until <ISO>]
//        [--package <dir>] [--design <design.json>] [--radius <item,...>] [--widen <ISO>=<item,...>]...
//        [--transcripts <dir>] [--meter <dir>] [--json <out.json>]
//   node scripts/task-telemetry.js --since <ISO> [--until <ISO>] [--package <dir>] ...
//        every session with a tool call in the window is one task; --radius needs --session.
// Exit: 0 measured, nothing outside the radius · 1 an edit outside the radius (a person reads it) ·
//       2 NOT MEASURED (bad arguments, no transcript, no tool call in scope) ·
//       3 reported, but out-of-radius NOT MEASURED because no radius was given.
// It never prompts and never reads stdin, so it runs unattended.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadFromCandidates(name, dirs) {
  const candidates = dirs.map(d => path.join(d, name));
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}
const HOOKS = [path.join(__dirname, '..', 'hooks'), path.join(os.homedir(), '.claude', 'hooks')];
const RULES = loadFromCandidates('structure-rules.js', HOOKS);
const GUARD = loadFromCandidates('structure-guard-hook.js', HOOKS);
const METER = loadFromCandidates('hook-meter.js', HOOKS);
// A sibling script, installed beside this one wherever scripts are installed — not a hook module.
const REFUSALS = require('./structure-refusals.js');

const COLUMNS = [
  ['files_read', 'distinct files with at least one successful Read'],
  ['files_edited', 'distinct files with at least one successful Edit/Write/MultiEdit/NotebookEdit'],
  ['components_touched', 'distinct design components among edited files inside the package'],
  ['outside_radius', 'distinct package files edited while outside the radius in force (applied edit calls beside)'],
  ['radius_size', 'components + files in the radius at the end of the task (start beside)'],
  ['widenings', 'times the radius was widened during the task'],
  ['refusals', 'tool calls refused: structure guard + another hook or permission rule'],
  ['design_id', '12-character id of the design components were read from'],
];

const READ_TOOLS = new Set(['Read']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const operatedFile = (name, input) => {
  if (!input || typeof input !== 'object') return null;
  const f = name === 'NotebookEdit' ? (input.notebook_path || input.file_path) : input.file_path;
  return typeof f === 'string' && f ? f : null;
};
const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map(b => (b && typeof b.text === 'string') ? b.text : '').join('') : '';

// What an errored tool_result was. Refusals only by a hook or a rule; the user's own "no" is not one.
function denialOf(text, kind) {
  if (REFUSALS.REFUSAL.test(text) || REFUSALS.CHECK_REFUSAL.test(text)) return 'guard';
  if (kind === 'user-rejected' || /^The user doesn't want to proceed/.test(text)) return 'user';
  if (kind === 'interrupted') return 'interrupted';
  if (kind === 'permission-rule' || /^PreToolUse:\w+ hook error: /.test(text) || /^Permission to use \S+ has been denied/.test(text)) return 'other';
  return 'errored';
}

function listTranscripts(dir) {
  const out = [];
  const walk = d => {
    let names;
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'tool-results') walk(p); }
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

// Every tool call in the span, per session, with its outcome. `want(sid)` picks the sessions.
function readCalls(files, want, since, until, needle) {
  const sessions = new Map();
  const stats = { transcripts: 0, unreadable: 0, badLines: 0, records: 0 };
  for (const file of files) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { stats.unreadable++; continue; }
    // One session's id appears verbatim on every one of its records: a file without it is not parsed.
    if (needle && !raw.includes(needle)) continue;
    let counted = false;
    const results = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let r;
      try { r = JSON.parse(line); } catch { stats.badLines++; continue; }
      const sid = r.sessionId || r.session_id;
      if (!sid || !want(sid)) continue;
      if (!counted) { stats.transcripts++; counted = true; }
      stats.records++;
      // Only the conversation's own records. Claude Code 2.1.317+ also writes `api-request-blob`
      // records whose `message` repeats tool_use and tool_result blocks with no timestamp; read as
      // calls they would re-date a call to "" (observed on the scratch session of 2026-11-05).
      if (r.type !== 'assistant' && r.type !== 'user') continue;
      const content = r.message && r.message.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_use' && r.type === 'assistant') {
          const ts = r.timestamp || '';
          if (ts < since || (until && ts >= until)) continue;
          if (!sessions.has(sid)) sessions.set(sid, { sid, calls: new Map(), transcripts: new Set(), versions: new Set(), branches: new Set() });
          const s = sessions.get(sid);
          s.transcripts.add(file);
          if (r.version) s.versions.add(r.version);
          if (r.gitBranch) s.branches.add(r.gitBranch);
          s.calls.set(b.id, { id: b.id, tool: b.name, file: operatedFile(b.name, b.input), at: ts, outcome: 'no result' });
        } else if (b.type === 'tool_result' && r.type === 'user') {
          results.push({ sid, b, kind: r.toolDenialKind || null });
        }
      }
    }
    for (const { sid, b, kind } of results) {
      const c = sessions.has(sid) && sessions.get(sid).calls.get(b.tool_use_id);
      if (!c) continue;
      c.outcome = b.is_error ? denialOf(textOf(b.content), kind) : 'applied';
    }
  }
  return { sessions, stats };
}

// The meter's rows for one session in the span: runs and refusals per hook.
function meterFor(dir, sid, since, until) {
  const file = path.join(dir, METER.fileFor(sid));
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { notMeasured: `no meter rows for this session in ${dir}` }; }
  const out = { file, runs: 0, refused: 0, byHook: {}, bad: 0 };
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { out.bad++; continue; }
    if (!r.ts || r.ts < since || (until && r.ts >= until)) continue;
    out.runs++;
    if (r.outcome === 'refused') { out.refused++; out.byHook[r.hook] = (out.byHook[r.hook] || 0) + 1; }
  }
  return out;
}

// The radius: items are component names of the design, or file paths. A bare word that names no
// component is refused rather than read as a file, so a misspelt component cannot quietly become a
// file nothing matches.
function parseItems(list, design, pkgDir) {
  const comps = new Set(Object.keys((design && design.components) || {}));
  const out = { components: new Set(), files: new Set() };
  for (const raw of String(list).split(',').map(s => s.trim()).filter(Boolean)) {
    if (comps.has(raw)) { out.components.add(raw); continue; }
    if (!raw.includes('/') && !raw.includes('.')) {
      return { error: `"${raw}" names no component of the design${design ? '' : ' (no design was found)'} and is not a file path` };
    }
    const abs = path.isAbsolute(raw) ? GUARD.realNear(raw) : (pkgDir ? GUARD.realNear(path.join(pkgDir, raw)) : null);
    if (!abs) return { error: `"${raw}" is a relative file path, which needs --package` };
    const hit = pkgDir && GUARD.checkoutMatch(abs, pkgDir);
    out.files.add(hit ? `pkg:${hit.rel}` : `abs:${abs}`);
  }
  return out;
}

function main(argv) {
  const single = new Set(['session', 'since', 'until', 'package', 'design', 'radius', 'transcripts', 'meter', 'json']);
  const args = { widen: [] };
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    const v = argv[i + 1];
    if (name && (single.has(name) || name === 'widen') && v !== undefined && v !== '' && !v.startsWith('--')) {
      if (name === 'widen') args.widen.push(v); else args[name] = v;
      i++;
    } else unknown.push(argv[i]);
  }
  const print = s => console.log(s);
  const stop = why => { print(`task-telemetry: NOT MEASURED — ${why}`); return 2; };
  if (unknown.length) return stop(`unrecognised or valueless argument(s): ${unknown.join(' ')}`);
  if (!args.session && !args.since) return stop('give --session <id> (one task), or --since <ISO> (every session in a window)');
  if ((args.radius || args.widen.length) && !args.session) return stop('a radius belongs to one task: --radius and --widen need --session');
  if (args.widen.length && !args.radius) return stop('--widen widens a radius; give the starting one with --radius');
  const iso = s => { const d = new Date(s); return isNaN(d) ? null : d.toISOString(); };
  const since = args.since ? iso(args.since) : '';
  const until = args.until ? iso(args.until) : null;
  if (args.since && !since) return stop(`--since is not a time: ${args.since}`);
  if (args.until && !until) return stop(`--until is not a time: ${args.until}`);

  // The package and its design.
  let pkgDir = null, frame = null, designNote;
  if (args.package) {
    pkgDir = path.resolve(args.package);
    try { pkgDir = fs.realpathSync(pkgDir); } catch { return stop(`--package does not exist: ${args.package}`); }
    const f = REFUSALS.frameFor(pkgDir, { design: args.design });
    if (f.frame) frame = f.frame; else designNote = f.notMeasured;
  } else if (args.design) return stop('--design maps files of a package: give --package too');
  else designNote = 'no --package given';
  const root = frame && frame.design.root ? String(frame.design.root).replace(/\/+$/, '') + '/' : '';

  // The radius and its widenings, each item checked against the design before anything is read.
  let radius = null;
  if (args.radius) {
    const start = parseItems(args.radius, frame && frame.design, pkgDir);
    if (start.error) return stop(`--radius: ${start.error}`);
    if (!start.components.size && !start.files.size) return stop('--radius names nothing');
    if (start.components.size && !frame) return stop(`--radius names components, but there is no design to map files to them (${designNote})`);
    const widenings = [];
    for (const w of args.widen) {
      const m = /^([^=]+)=(.+)$/.exec(w);
      const at = m && iso(m[1]);
      if (!at) return stop(`--widen must be <ISO time>=<item,...>, got "${w}"`);
      const items = parseItems(m[2], frame && frame.design, pkgDir);
      if (items.error) return stop(`--widen: ${items.error}`);
      if (items.components.size && !frame) return stop('--widen names components, but there is no design');
      widenings.push({ at, ...items });
    }
    widenings.sort((a, b) => a.at.localeCompare(b.at));
    radius = { start, widenings };
  }
  const radiusAt = ts => {
    const comps = new Set(radius.start.components), files = new Set(radius.start.files);
    for (const w of radius.widenings) if (w.at <= ts) { w.components.forEach(x => comps.add(x)); w.files.forEach(x => files.add(x)); }
    return { comps, files };
  };
  const sizeOf = r => r.comps.size + r.files.size;

  const tdir = path.resolve(args.transcripts || path.join(os.homedir(), '.claude', 'projects'));
  let files = listTranscripts(tdir);
  if (!files.length) return stop(`no transcripts under ${tdir}`);
  // A window's prefilter: a transcript last written before the window began holds nothing in it.
  const total = files.length;
  if (!args.session && since) files = files.filter(f => { try { return fs.statSync(f).mtime.toISOString() >= since; } catch { return false; } });
  // One session's transcripts are named for it: `<id>.jsonl` and `<id>/subagents/*.jsonl`. Measured
  // 2026-11-05 over all 4318 transcript files on this machine: 0 held a sessionId absent from their
  // path. So only those files are read; the id is still checked on every record.
  if (args.session) files = files.filter(f => f.includes(args.session));
  const want = args.session ? (sid => sid === args.session) : (() => true);
  const { sessions, stats } = readCalls(files, want, since, until, args.session ? `"${args.session}"` : null);
  const mdir = args.meter || METER.meterDir();
  const span = `${since || 'start'} → ${until || 'end'}`;

  print(`task-telemetry: ${args.session ? `session ${args.session}` : `every session with a tool call, ${span}`}`);
  print(`  task = one session (its transcript and every subagent transcript with the same sessionId)` +
        (args.since || args.until ? `, narrowed to ${span} by tool-call time` : ', whole') +
        '; not a branch (the record\'s gitBranch is the session\'s working directory, not the checkout edited) and not an issue (only prose names one)');
  print(`  read: ${stats.transcripts} transcripts holding these sessions, ${stats.records} records; examined ${files.length} of ${total} transcript files under ${tdir}` +
        (args.session ? ' (those named for the session)' : since ? ' (those written to since the window began)' : '') +
        (stats.unreadable ? ` · ${stats.unreadable} unreadable` : '') + (stats.badLines ? ` · ${stats.badLines} unparseable lines skipped` : ''));
  print(`  design: ${frame ? `${frame.id} (${frame.source}) · package ${pkgDir}` : `none — components NOT MEASURED (${designNote})`}`);
  if (!sessions.size) return stop(`no tool call in ${args.session ? 'this session' : 'any session'} in ${span}` +
    (args.session ? ` (no record carries sessionId "${args.session}" with a tool call there; the full id is needed)` : ''));

  print(`  columns: ${COLUMNS.map(c => c[0]).join(' · ')} (units in the script header)`);
  const report = [];
  let anyOutside = false;
  for (const s of [...sessions.values()].sort((a, b) => a.sid.localeCompare(b.sid))) {
    const calls = [...s.calls.values()];
    const by = (set, outcome) => calls.filter(c => set.has(c.tool) && (!outcome || c.outcome === outcome));
    const reads = by(READ_TOOLS), edits = by(EDIT_TOOLS);
    const readFiles = new Set(by(READ_TOOLS, 'applied').filter(c => c.file).map(c => GUARD.realNear(c.file)));
    const applied = by(EDIT_TOOLS, 'applied').filter(c => c.file);
    const editFiles = new Set(applied.map(c => GUARD.realNear(c.file)));
    // Which package file an edit is, in any checkout of the package's repository. A path in a
    // checkout that no longer exists cannot be confirmed to be this repository: the guard's rule
    // accepts it by its path inside the repository alone, and on this machine that matched another
    // project's removed checkout that also has `packages/editor/` (2026-11-05). Such files are
    // counted apart, never given a component or judged against the radius.
    const located = new Map();
    const locate = abs => {
      if (!located.has(abs)) {
        const hit = pkgDir && GUARD.checkoutMatch(abs, pkgDir, { gone: true });
        located.set(abs, !pkgDir ? { rel: null } : !hit ? { outside: true } : hit.checkout === 'gone' ? { unconfirmed: true, rel: hit.rel } : { rel: hit.rel });
      }
      return located.get(abs);
    };
    const where = c => { const abs = GUARD.realNear(c.file); return { abs, ...locate(abs) }; };
    const components = new Map();
    const unmapped = [], outsideRoot = [], outsidePkg = new Set(), unconfirmed = new Set();
    const comp = rel => (frame && rel.startsWith(root) ? frame.of(rel) : undefined);
    for (const f of editFiles) {
      const hit = locate(f);
      if (hit.outside) { outsidePkg.add(f); continue; }
      if (hit.unconfirmed) { unconfirmed.add(f); continue; }
      if (!frame || !pkgDir) continue;
      if (!hit.rel.startsWith(root)) { outsideRoot.push(hit.rel); continue; }
      const k = comp(hit.rel);
      if (k === undefined) unmapped.push(hit.rel); else components.set(k, (components.get(k) || 0) + 1);
    }
    // Out-of-radius: every applied edit judged at its own time against the radius then in force.
    let outside = null;
    if (radius) {
      const files = new Set(), list = [];
      let calls = 0;
      for (const c of applied) {
        const { abs, rel, outside: out, unconfirmed: gone } = where(c);
        if (out || gone) continue;                          // outside the package, or unconfirmed: printed apart
        const r = radiusAt(c.at);
        const inside = (rel !== null && r.files.has(`pkg:${rel}`)) || r.files.has(`abs:${abs}`) ||
          (rel !== null && r.comps.size && r.comps.has(comp(rel)));
        if (!inside) { calls++; if (!files.has(abs)) list.push({ file: rel || abs, at: c.at, component: rel === null ? null : !rel.startsWith(root) ? 'outside the design root' : (comp(rel) || 'in no component') }); files.add(abs); }
      }
      const startSize = sizeOf(radiusAt(''));
      const endSize = sizeOf(radiusAt('9999'));
      outside = { files: files.size, calls, list, startSize, endSize, widenings: radius.widenings.length,
        judged: applied.filter(c => { const w = where(c); return !w.outside && !w.unconfirmed; }).length };
      if (files.size) anyOutside = true;
    }
    const refusals = { guard: 0, other: 0, user: 0, interrupted: 0, errored: 0, noResult: 0 };
    for (const c of calls) {
      if (c.outcome === 'no result') refusals.noResult++;
      else if (c.outcome in refusals) refusals[c.outcome]++;
    }
    const bash = calls.filter(c => c.tool === 'Bash').length;
    const meter = meterFor(mdir, s.sid, since, until);
    const row = {
      task: { session: s.sid, since: since || null, until, transcripts: s.transcripts.size, versions: [...s.versions].sort(), branches: [...s.branches].sort() },
      design_id: frame ? frame.id : null,
      files_read: readFiles.size, read_calls: reads.length,
      files_read_in_package: pkgDir ? [...readFiles].filter(f => { const h = locate(f); return !h.outside && !h.unconfirmed; }).length : null,
      files_edited: editFiles.size, edit_calls: edits.length, edit_calls_applied: applied.length,
      components_touched: frame ? components.size : null, components: Object.fromEntries([...components].sort()), unmapped_files: frame ? unmapped.length : null, outside_root_files: frame ? outsideRoot.length : null,
      unmapped_list: frame ? unmapped.sort() : null, outside_root_list: frame ? outsideRoot.sort() : null,
      edited_outside_package: pkgDir ? outsidePkg.size : null, edited_unconfirmed_checkout: pkgDir ? unconfirmed.size : null,
      outside_radius: outside ? outside.files : null, outside_radius_edit_calls: outside ? outside.calls : null,
      outside_radius_list: outside ? outside.list : null,
      radius_size: outside ? outside.endSize : null, radius_size_at_start: outside ? outside.startSize : null,
      widenings: outside ? outside.widenings : null,
      refusals: refusals.guard + refusals.other, refusals_by: refusals,
      tool_calls: calls.length, bash_calls: bash,
      meter: meter.notMeasured ? { notMeasured: meter.notMeasured } : { runs: meter.runs, refused: meter.refused, byHook: meter.byHook },
    };
    report.push(row);

    print(`\n  task ${s.sid}${since || until ? ` [${span}]` : ''} · ${s.transcripts.size} transcript(s) · ${calls.length} tool calls · ` +
          `Claude Code ${row.task.versions.join(', ') || 'unknown'} · gitBranch on records: ${row.task.branches.join(', ') || 'none'}`);
    print(`    files_read: ${row.files_read} (of ${reads.length} Read calls, ${reads.length - by(READ_TOOLS, 'applied').length} not applied)` +
          (pkgDir ? ` · ${row.files_read_in_package} of them in the package` : ''));
    print(`    files_edited: ${row.files_edited} (of ${edits.length} edit calls, ${applied.length} applied)` +
          (pkgDir ? ` · ${outsidePkg.size} of them outside the package · ${unconfirmed.size} in a checkout that no longer exists (repository unconfirmed; not counted as the package)` : ''));
    print(frame
      ? `    components_touched: ${components.size}` + (components.size ? ` (${[...components].sort().map(([k, n]) => `${k} ${n}`).join(', ')})` : '') + ` · in no component ${unmapped.length} · outside the design root (${root || 'none'}) ${outsideRoot.length}`
      : `    components_touched: NOT MEASURED — no design (${designNote})`);
    if (!radius) print('    radius: none given — out-of-radius NOT MEASURED');
    else {
      print(`    outside_radius: ${outside.files} files (${outside.calls} applied edit calls) of ${outside.judged} applied edits judged` +
            ` · radius_size ${outside.endSize} (${outside.startSize} at start) · widenings ${outside.widenings}`);
      for (const o of outside.list) print(`      · ${o.at} ${o.file}${o.component ? ` [${o.component}]` : ''}`);
    }
    print(`    refusals: ${row.refusals} (structure guard ${refusals.guard} · another hook or permission rule ${refusals.other})` +
          ` · not refusals: user rejected ${refusals.user} · interrupted ${refusals.interrupted} · errored ${refusals.errored} · no result ${refusals.noResult}`);
    print(meter.notMeasured ? `    meter: NOT MEASURED — ${meter.notMeasured}`
      : `    meter: ${meter.runs} hook runs, ${meter.refused} refused` +
        (meter.refused ? ` (${Object.entries(meter.byHook).sort().map(([h, n]) => `${h} ${n}`).join(', ')})` : '') +
        ' — a permission rule leaves no meter row, so this need not equal the transcript\'s count');
    print(`    not seen: ${bash} Bash calls — a file changed through the shell names no operated file and is not counted as edited`);
  }

  if (args.json) {
    try {
      fs.writeFileSync(path.resolve(args.json), JSON.stringify({
        instrument: 'scripts/task-telemetry.js', at: new Date().toISOString(), columns: Object.fromEntries(COLUMNS),
        transcripts: tdir, meter: mdir, span: { since: since || null, until }, design: frame ? { id: frame.id, source: frame.source, package: pkgDir } : null,
        tasks: report,
      }, null, 2) + '\n');
    } catch (e) { return stop(`cannot write --json: ${e.message}`); }
  }
  if (!radius) return 3;
  return anyOutside ? 1 : 0;
}

module.exports = { COLUMNS, readCalls, denialOf, operatedFile, parseItems, meterFor, main };
if (require.main === module) process.exit(main(process.argv.slice(2)));

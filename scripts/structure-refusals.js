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
//   · a TIMEOUT is an `attachment` of type `hook_cancelled` naming the guard's command, with
//     `timedOut: true` (observed on 2.1.283 with a hook made to overrun): the hook was killed,
//     the edit went through, and the model was told nothing. That edit was NEVER JUDGED, so it is
//     counted apart from the applied ones (#550) — never folded into a clean zero.
// Every Write/Edit/MultiEdit call whose file is under the package, in the window, is counted,
// so a zero is printed as 0 OF N edits the guard judged or passed — never as a bare zero.
// "Under the package" includes the same package in any git worktree of its repository, matched
// by the hook's own rule (#546), and each edit says which checkout it was in.
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
//        [--design <design.json>] [--baseline <baseline.json>] [--extractor <module>]
//   --transcripts defaults to ~/.claude/projects: the guard runs in EVERY session on the machine,
//   so a session started in another project that edits the package is read too. The design,
//   baseline and extractor default to the package's entry in the guard's registry.
//
// EXPOSURE — A ZERO IS READ AGAINST THE CHANCES, NOT THE EDITS (#603). A trial is ruled on its
// refusals, and "0 refused of 50 edits" said nothing when almost none of the 50 could have been
// refused (a replay of that window found 0 chances in 66 edits). So for every applied edit in the
// corpus, the imports of the file just before it (the tool result's recorded `originalFile`) are
// compared with the imports of the proposed content, resolved by the guard's own extractor, and
// each ADDED edge is classed: within one component · across, allowed · across, already in the
// baseline · across, NOT allowed · unresolved. A chance to refuse is a refusal, or a not-allowed
// edge that landed — the second kind is MISSED and listed, because each one is a guard that did
// not judge, a guard defect, or a design that changed inside the window. A window with no chance
// is UNTESTED: neither a pass nor a failure. A new cycle inside one component is not counted as a
// chance (that needs the whole graph at that moment), and imports are resolved against the
// checkout as it is when the report runs — both said in the output.
//
// Exit: 1 a person must read something: a refusal (right or wrong?), a missed chance (why was it
//       not refused?), or a possible chance (is it real?) · 2 not measured (no transcripts, no edit in the package in the window, a
//       denial in a shape this reader does not know, or no design to compute exposure with) ·
//       3 UNTESTED: no chance to refuse in the window. There is no clean exit: a trial passes by
//       a person's rulings on its refusals, never by a window's count.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
// The hook's own package rule, so the report counts exactly the edits the hook judges (#546).
function loadFromCandidates(name) {
  const candidates = [path.join(__dirname, '..', 'hooks', name), path.join(os.homedir(), '.claude', 'hooks', name)];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}
const HOOK = loadFromCandidates('structure-guard-hook.js');
const GUARD_COMMAND = /structure-guard-hook\.js/;
// The guard's opening words, bare or in Claude Code's wrapper.
const REFUSAL = /^(?:PreToolUse:(?:Write|Edit|MultiEdit) hook error: )?BLOCKED: this edit to /;
// The guard's own words: they survive a change of wrapper, so finding them outside the known
// shape means the shape moved, not that the guard went quiet.
const GUARD_WORDS = /BLOCKED: this edit to .* adds \d+ import/;
// `layer` stays readable: transcripts written before the component graph (#554) carry it.
const VIOLATION = /^\s*·\s*(divergence|layer|cycle):\s*(\S+ -> \S+)\s*$/gm;
// What each notice says, by its own opening words (hooks/structure-guard-hook.js).
const NOTICE_KINDS = [
  ['on disk', /already on disk but not in its baseline/],
  ['fixed', /fixed since its baseline/],
  ['not measured', /NOT MEASURED/],
  ['failed', /FAILED and allowed the edit/],
  ['unmapped', /belongs to no component of/],
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

// What a transcript must contain to hold an edit of the package in some checkout: the package's
// spellings, or its path inside its repository (every worktree shares that). A cheap pre-filter
// only — each edit is then matched by the hook's rule.
function needles(dir) {
  const out = spellings(dir);
  const home = HOOK.checkoutOf(dir);
  const inRepo = home && path.relative(home.root, dir);
  if (inRepo) out.push(path.sep + inRepo + path.sep);
  return { needles: out, repo: home };
}

// One transcript: every package edit in the window, and what the guard said about each.
function readTranscript(file, pkgDir, filter, since, until) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { unreadable: true, calls: [] }; }
  if (!filter.some(p => raw.includes(p))) return { calls: [] };
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
        const hit = HOOK.checkoutMatch(HOOK.realNear(fp), pkgDir, { gone: true });
        if (!hit) continue;
        calls.set(b.id, { id: b.id, tool: b.name, file: hit.rel, checkout: hit.checkout, checkoutDir: hit.dir, at: ts, version: r.version || null,
          session: r.sessionId || r.session_id || path.basename(file, '.jsonl'), transcript: file,
          outcome: 'no result', violations: [], notices: [], input: b.input });
      } else if (b.type === 'tool_result') {
        results.push({ block: b, denialKind: r.toolDenialKind || null, toolResult: r.toolUseResult });
      }
    }
  }
  for (const { block: b, denialKind, toolResult } of results) {
    const c = calls.get(b.tool_use_id);
    if (!c) continue;
    // The file as it was just before the edit: a string, null for a file the edit created, or
    // undefined when the result recorded neither (then exposure is not computed for it).
    if (toolResult && typeof toolResult === 'object' && 'originalFile' in toolResult)
      c.prior = typeof toolResult.originalFile === 'string' ? toolResult.originalFile : null;
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
    // Killed before it answered: the edit landed unjudged (#550). A cancel of ANOTHER hook on the
    // same edit says nothing about this one.
    if (c && a.type === 'hook_cancelled' && GUARD_COMMAND.test(a.command || '')) {
      if (c.outcome === 'applied') c.outcome = a.timedOut === true ? 'timed out' : 'cancelled';
      continue;
    }
    if (!c || a.type !== 'hook_success' || !/^PreToolUse:/.test(a.hookName || '')) continue;
    let ctx = '';
    try { ctx = ((JSON.parse(a.stdout || '{}').hookSpecificOutput) || {}).additionalContext || ''; } catch { continue; }
    if (!/^structure guard:/.test(ctx)) continue;
    // One output may join several notices (#544), so every kind it names is counted.
    for (const [kind, re] of NOTICE_KINDS) if (re.test(ctx)) c.notices.push(kind);
  }
  return { calls: [...calls.values()], badLines };
}

const count2 = (calls, where) => calls.filter(c => c.checkout === where).length;

// ── exposure (#603) ──────────────────────────────────────────────────────────────────────
const RULES = loadFromCandidates('structure-rules.js');
const GRAPH = loadFromCandidates('structure-graph.js');

// Module specifiers written in a piece of source text — lexical, so it works on the fragment an
// Edit replaces. Type-only imports are included (the guard's compiled view drops them).
const SPECIFIER = /(?:\bimport|\bexport)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;
const specifiersIn = text => new Set([...String(text || '').matchAll(SPECIFIER)].map(m => m[1] || m[2] || m[3] || m[4]));

// What one edit added, or why that could not be told. `extractorFor(dir)` gives the extractor
// for the checkout the edit was made in; `frame` holds the design, its component lookup, the
// allowed pairs and the baseline's divergence keys.
function exposureOf(c, frame, extractorFor) {
  if (!GRAPH.inCorpus(c.file, frame.design)) return { kind: 'outside the corpus' };
  if (c.tool === 'MultiEdit') return { kind: 'not computed', why: 'MultiEdit' };
  const ex = extractorFor(c.checkoutDir);
  if (ex.notMeasured) return { kind: 'not computed', why: ex.notMeasured };
  // EXACT when the prior content is known: a Write, or an Edit whose result recorded
  // `originalFile`. ESTIMATED from the edit's own text when it did not — Claude Code records
  // `originalFile: null` on most Edits (measured on stave, 2.1.278–2.1.287). Every import an Edit
  // adds is in its new text, so "in the new text, not in the old" is an UPPER BOUND: a zero is
  // firm, a hit is only possible (a type-only import, or one the file already had elsewhere).
  let before, after, method;
  try {
    if (c.tool === 'Write' || typeof c.prior === 'string') {
      const post = HOOK.proposedContent(c.tool, c.input, () => { if (typeof c.prior !== 'string') throw new Error('no file'); return c.prior; });
      if (post == null) return { kind: 'not computed', why: c.prior === undefined ? 'no prior content recorded'
        : 'the proposal does not apply to the recorded content' };
      method = 'exact';
      before = typeof c.prior === 'string' ? ex.edges(c.file, c.prior) : { edges: [], unresolved: 0 };
      after = ex.edges(c.file, post);
    } else if (c.tool === 'Edit' && c.input && typeof c.input.new_string === 'string') {
      method = 'estimated';
      const old = specifiersIn(c.input.old_string);
      const added = [...specifiersIn(c.input.new_string)].filter(x => !old.has(x));
      // A side-effect import is never dropped by compilation, so the extractor resolves each one.
      before = { edges: [], unresolved: 0 };
      after = added.length ? ex.edges(c.file, added.map(x => `import ${JSON.stringify(x)};`).join('\n') + '\n') : { edges: [], unresolved: 0 };
    } else return { kind: 'not computed', why: 'no prior content recorded' };
  } catch (e) { return { kind: 'not computed', why: `the extractor failed: ${String(e.message).split('\n')[0]}` }; }
  const had = new Set(before.edges.map(([t]) => t));
  const added = after.edges.map(([t]) => t).filter(t => !had.has(t) && t !== c.file);
  const from = frame.of(c.file);
  const edges = added.map(t => {
    const to = GRAPH.inCorpus(t, frame.design) ? frame.of(t) : undefined;
    const key = RULES.edgeKey(c.file, t);
    const kind = from === undefined || to === undefined ? 'unmapped'
      : from === to ? 'within'
      : frame.allowed.has(RULES.edgeKey(from, to)) ? 'allowed'
      : frame.baselined.has(key) ? 'baselined' : 'NOT allowed';
    return { key, pair: from && to ? RULES.edgeKey(from, to) : null, kind };
  });
  const unresolved = Math.max(0, (after.unresolved || 0) - (before.unresolved || 0));
  const kind = edges.some(e => e.kind === 'NOT allowed') ? 'chance'
    : edges.some(e => e.kind === 'allowed' || e.kind === 'baselined') ? 'allowed crossing' : 'no crossing';
  return { kind, method, edges, unresolved };
}

// The design, baseline and extractor the exposure is computed with: flags first, else the guard's
// registry entry for the package. Returns { frame } or { notMeasured }.
function frameFor(pkgDir, args) {
  let entry = null;
  try {
    const registry = JSON.parse(fs.readFileSync(HOOK.REGISTRY, 'utf8'));
    entry = (registry.packages || []).find(p => { try { return fs.realpathSync(p.dir) === pkgDir; } catch { return false; } }) || null;
  } catch { /* no registry: flags only */ }
  const designPath = args.design || (entry && entry.design);
  if (!designPath) return { notMeasured: 'the package has no design: it is not in the guard\'s registry and no --design was given' };
  let design, baseline = null;
  try { design = JSON.parse(fs.readFileSync(path.resolve(designPath), 'utf8')); }
  catch (e) { return { notMeasured: `cannot read the design ${designPath}: ${e.message}` }; }
  const problem = RULES.designProblem(design);
  if (problem) return { notMeasured: `the design cannot be judged against: ${problem}` };
  const baselinePath = args.baseline || (entry && entry.baseline);
  if (baselinePath) {
    try { baseline = JSON.parse(fs.readFileSync(path.resolve(baselinePath), 'utf8')); }
    catch (e) { return { notMeasured: `cannot read the baseline ${baselinePath}: ${e.message}` }; }
  }
  const root = design.root ? String(design.root).replace(/\/+$/, '') + '/' : '';
  const extractorEntry = args.extractor ? { extractor: path.resolve(args.extractor) } : (entry || {});
  return { frame: {
    design, id: RULES.designId(design), source: args.design ? 'given' : 'registry',
    of: RULES.componentOf(design, root),
    allowed: new Set((design.allowed || []).map(([a, b]) => RULES.edgeKey(a, b))),
    baselined: new Set(((baseline && baseline.rules && baseline.rules.divergence) || [])),
    baselineCount: baseline ? ((baseline.rules && baseline.rules.divergence) || []).length : null,
    extractorEntry,
  } };
}

const FLAGS = new Set(['package', 'since', 'until', 'transcripts', 'json', 'design', 'baseline', 'extractor']);

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
  let pkgDir = path.resolve(args.package);
  try { pkgDir = fs.realpathSync(pkgDir); } catch { /* a package that is gone is still read by name */ }
  const { needles: filter, repo } = needles(pkgDir);
  const read = files.map(f => readTranscript(f, pkgDir, filter, since, until));
  const calls = read.flatMap(r => r.calls).sort((a, b) => a.at.localeCompare(b.at));
  const unreadable = read.filter(r => r.unreadable).length;
  const badLines = read.reduce((n, r) => n + (r.badLines || 0), 0);

  const count = k => calls.filter(c => c.outcome === k).length;
  const refused = calls.filter(c => c.outcome === 'refused');
  const notices = {};
  for (const c of calls) for (const k of c.notices) notices[k] = (notices[k] || 0) + 1;
  const sessions = new Set(calls.map(c => c.session));

  print(`structure-refusals: ${pkgDir} · ${since}${until ? ` → ${until}` : ' → now'}`);
  print(`  read: ${files.length} transcripts under ${dir}` + (unreadable ? ` (${unreadable} unreadable)` : '') +
        (badLines ? ` · ${badLines} unparseable lines skipped` : ''));
  print(`  edits in the package: ${calls.length} Write/Edit/MultiEdit calls in ${sessions.size} sessions — ` +
        `${count('applied')} applied · ${refused.length} REFUSED by the guard · ${count('denied otherwise')} denied by another hook or a permission rule · ` +
        `${count('errored')} errored otherwise · ${count('no result')} with no result`);
  // Said every time, zero included: an edit the guard never judged is not an edit it passed.
  const unjudged = count('timed out') + count('cancelled');
  print(`  applied WITHOUT being judged: ${unjudged} — the guard timed out on ${count('timed out')}, was cancelled on ${count('cancelled')}`);
  const where = {};
  for (const c of calls) if (c.checkout !== 'registered') (where[c.checkout] = where[c.checkout] || new Set()).add(c.checkoutDir);
  print(!repo ? `  checkouts: worktrees NOT looked for — ${pkgDir} is not inside a git checkout`
    : `  checkouts: registered ${count2(calls, 'registered')} · worktrees ${count2(calls, 'worktree')}` +
      (where.worktree ? ` (${[...where.worktree].join(', ')})` : '') +
      ` · ${count2(calls, 'gone')} in a checkout that no longer exists, so its repository cannot be confirmed` +
      (where.gone ? ` (${[...where.gone].join(', ')})` : ''));
  // A silent allow leaves no record, so an edit in another checkout that no hook looked at reads
  // exactly like one it passed. Hooks before #546 did not look there — said whenever such edits
  // are counted, because the transcript cannot say which hook was installed at the time.
  if (count2(calls, 'worktree') + count2(calls, 'gone'))
    print(`  CAUTION: edits in another checkout were judged only by a hook that guards worktrees (anvi #546); ` +
          'before it was installed they passed unseen, and a transcript cannot tell the two apart. Read a trial only from --since after it.');
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
  if (unjudged === calls.length) {
    print('');
    return stop(`the guard judged none of the ${calls.length} edits in the package — every one landed after it timed out or was cancelled`);
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
  } else print(`\n  no refusal in ${calls.length} edits` +
    (unjudged ? ` — but ${unjudged} of them landed WITHOUT being judged, so this zero covers only the other ${calls.length - unjudged}.` : '.'));

  // ── exposure: what the refusal count is OF (#603) ──
  const { frame, notMeasured: noFrame } = frameFor(pkgDir, args);
  let toRead = 0, exposure = null;
  if (noFrame) {
    print(`\n  exposure: NOT COMPUTED — ${noFrame}.`);
    print(`  TRIAL READING: NOT MEASURED — without exposure, a window with no chance to refuse cannot be told from one that passed.`);
  } else {
    const extractors = new Map();
    const extractorFor = dir => {
      const d = dir && fs.existsSync(dir) ? dir : pkgDir;
      if (!extractors.has(d)) { try { extractors.set(d, GRAPH.loadExtractor(frame.extractorEntry, d)); } catch (e) { extractors.set(d, { notMeasured: e.message }); } }
      return extractors.get(d);
    };
    const landed = new Set(['applied', 'timed out', 'cancelled']);
    for (const c of calls) if (landed.has(c.outcome)) c.exposure = exposureOf(c, frame, extractorFor);
    const ex = calls.filter(c => c.exposure);
    const by = k => ex.filter(c => c.exposure.kind === k);
    const computed = ex.filter(c => !['outside the corpus', 'not computed'].includes(c.exposure.kind));
    const allEdges = computed.flatMap(c => c.exposure.edges);
    const edgeCount = k => allEdges.filter(e => e.kind === k).length;
    const whyNot = {};
    for (const c of by('not computed')) whyNot[c.exposure.why] = (whyNot[c.exposure.why] || 0) + 1;
    const unresolved = computed.reduce((n, c) => n + c.exposure.unresolved, 0);
    const exactMissed = by('chance').filter(c => c.exposure.method === 'exact');
    const possible = by('chance').filter(c => c.exposure.method === 'estimated');
    toRead = exactMissed.length + possible.length;
    const chances = refused.length + exactMissed.length;
    const methods = { exact: computed.filter(c => c.exposure.method === 'exact').length, estimated: computed.filter(c => c.exposure.method === 'estimated').length };
    exposure = { design: frame.id, chances, refused: refused.length, missed: exactMissed.length, possible: possible.length, computed: computed.length, methods,
      crossingAllowed: by('allowed crossing').length, noCrossing: by('no crossing').length,
      notComputed: by('not computed').length, outside: by('outside the corpus').length, unresolved };
    print(`\n  exposure (design ${frame.id} from the ${frame.source}` +
          (frame.baselineCount === null ? ', no baseline' : `, baseline ${frame.baselineCount} divergence`) + `):`);
    print(`    landed edits ${ex.length} — ${by('outside the corpus').length} outside the corpus (tests, excluded) · ` +
          `${by('not computed').length} exposure not computed` +
          (Object.keys(whyNot).length ? ` (${Object.entries(whyNot).map(([w, n]) => `${w} ×${n}`).join('; ')})` : '') +
          ` · ${computed.length} computed (${methods.exact} exactly from the recorded content, ${methods.estimated} estimated from the edit's own text — ` +
          'Claude Code did not record the file before those; the estimate is an upper bound)');
    print(`    of the ${computed.length} computed: ${exactMissed.length} added an import across components that is NOT allowed` +
          (possible.length ? ` (and ${possible.length} possibly, estimated from the edit's text)` : '') + ' · ' +
          `${by('allowed crossing').length} crossed only where allowed or baselined · ${by('no crossing').length} crossed nothing`);
    print(`    imports added: ${allEdges.length} — within a component ${edgeCount('within')} · across, allowed ${edgeCount('allowed')} · ` +
          `across, baselined ${edgeCount('baselined')} · across, NOT allowed ${edgeCount('NOT allowed')} · to an unmapped file ${edgeCount('unmapped')} · ` +
          `unresolved now ${unresolved}`);
    print('    not counted as chances: a new cycle inside one component (needs the whole graph), and edits made through Bash.');
    const list = (title, rows) => {
      if (!rows.length) return;
      print(title);
      rows.forEach((c, i) => {
        print(`    ${i + 1}. ${c.at} ${c.session.slice(0, 8)} ${c.tool} ${c.file} · ${c.outcome}` + (c.checkout !== 'registered' ? ` · in a ${c.checkout} checkout` : '') +
              // What the guard said on that edit tells the reasons apart: "not measured" is a guard
              // that was not judging (a design mismatch, no TypeScript), silence is a guard that judged.
              ` · the guard said: ${c.notices.length ? c.notices.join(', ') : 'nothing'}`);
        for (const e of c.exposure.edges.filter(x => x.kind === 'NOT allowed')) print(`         ${e.key}   (${e.pair})`);
      });
    };
    list(`\n  MISSED CHANCES — ${exactMissed.length}: a not-allowed import landed without a refusal. Each needs a reason ` +
         '(the guard did not judge it, a guard defect, or the design changed inside the window):', exactMissed);
    list(`\n  POSSIBLE CHANCES — ${possible.length}: the edit's text adds a not-allowed import, but the file before it was not recorded, ` +
         'so whether the guard would see it is not known (a type-only import is invisible to it). Read each edit:', possible);
    const tail = possible.length ? ` · ${possible.length} possible chance${possible.length === 1 ? '' : 's'} to read` : '';
    print(chances === 0
      ? `\n  TRIAL READING: ${possible.length ? 'UNTESTED unless a possible chance is real' : 'UNTESTED'} — 0 chances to refuse in this window ` +
        `(${computed.length} edits computed, ${by('not computed').length} not${tail}). This is neither a pass nor a failure.`
      : `\n  TRIAL READING: ${chances} chance${chances === 1 ? '' : 's'} to refuse — ${refused.length} refused (each needs a ruling, right or wrong) · ` +
        `${exactMissed.length} missed (each needs a reason)${tail}.`);
  }

  if (args.json) {
    fs.writeFileSync(path.resolve(args.json), JSON.stringify({ package: pkgDir, since, until, transcripts: files.length,
      unreadable, badLines, exposure, calls: calls.map(({ reason, input, prior, ...c }) => c) }, null, 1) + '\n');
    print(`  report: ${path.resolve(args.json)}`);
  }
  // A ruling owed (refused, or a missed chance) · not measured (a denial unread, or no exposure)
  // · untested (no chance). Never a clean exit: see the header.
  if (refused.length || toRead) return 1;
  if (unrecognised.length || noFrame) return 2;
  return 3;
}

module.exports = { readTranscript, spellings, needles, exposureOf, frameFor, REFUSAL, GUARD_WORDS, VIOLATION, NOTICE_KINDS };

if (require.main === module) process.exit(main(process.argv.slice(2)));

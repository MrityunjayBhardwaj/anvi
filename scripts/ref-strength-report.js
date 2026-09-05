#!/usr/bin/env node
// ref-strength-report.js — does a catalogue citation RESOLVE where the entry says it does?
//
// The gap it fills (anvi #392). The session banner prints `GROUNDING: N/N entries grounded
// (100%)`, and the predicate behind it is literally `body.includes('**REF:**') &&
// !body.includes('UNGROUNDED')`. That asks whether somebody TYPED the field. It never asks
// whether the citation resolves, points at the file it names, or supports the claim. So the
// metric that reads best is the one measuring least, and 100% has sat beside an
// independently measured 0 for weeks.
//
// THREE QUESTIONS, THREE ANSWERS, NEVER ONE NUMBER:
//
//   presence      does the entry carry a citation?          — free, and already reported
//   resolution    does the citation land where it says?     — MECHANICAL. this file.
//   support       does what it lands on back the claim?     — a RULING. deliberately absent.
//
// Support is staged out on purpose. Whether a citation SUPPORTS its claim is adjudication,
// not computation, and belongs in a sampled manual pass once these numbers exist. Any
// similarity score here would be a judgement wearing a computation's clothes, and would
// produce a confident number for the hardest question in the chain.
//
// ⚠ WHAT IT MUST NOT DO, each bought by a failure in this repo:
//
//   NEVER FOLD `unanchorable` INTO `resolved`. An entry whose REF cites no target at all is
//   not a passing citation — it is the absence of one. Same rule ref-span-check.js states for
//   its own `unanchored`, and for the same reason: folding them produces a green run over a
//   corpus that was never checked.
//
//   NEVER PRINT A ZERO WITHOUT ITS DENOMINATOR. A zero with no denominator cannot be told
//   apart from a loop that never ran, which is the exact shape this area keeps rebuilding.
//
//   NEVER PRINT A FIGURE WITHOUT ITS WINDOW. The commit resolution was computed at, and the
//   newest validation stamp per catalogue. An undated figure reads as current whatever its age.
//
//   ONE CITATION PARSER, AND IT IS NOT HERE. `hooks/currency.js` already owns the grammar of
//   a citation — `citedSymbols`, `extractRefFiles`, `lineAnchoredRefs`, `classifySpec`,
//   `symbolInText`, `parseEntries`. A fourth reader of the same field is precisely how the
//   last matcher in this repo went wrong: right corpus, wrong field, four successive
//   corrections before the count settled.
//
// ⚠ EXIT CODE IS A COUNT, NOT A VERDICT, and the reserved codes are stated once here:
//   0-250  that many citations do not resolve where they are named
//   251    more than 250 do
//   254    the report's own classes do not sum to their totals — refuses to be read
//   255    it could not report at all (no catalogue, or a repo that is not a checkout)
//
// It is the number of citations that do not resolve
// where they are named — symbol pairs found elsewhere or nowhere, plus cited paths that
// resolve nowhere. Everything else — ambiguity, tail-only matches, unanchorable entries,
// delegated classes — is reported with its own denominator and explicitly kept OUT of that
// count, because a number that silently absorbs the cases it cannot judge is the defect this
// instrument exists to measure.
//
// This is an AUDIT, not a lint and not a hook. ~1% mis-pointing makes a good audit and a
// noisy gate (#272 says so directly). It flags; a person repairs. Nothing here writes.
//
// Offline by default: reads local files and local git only. `--online` additionally asks
// `gh` whether cited issues exist.
//
// Usage:
//   node scripts/ref-strength-report.js
//   node scripts/ref-strength-report.js --catalogues <dir> --repo <dir> [--all] [--json] [--online]

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// --- shared modules, from either install tree (same resolution currency-report uses) ---
function loadFromCandidates(name) {
  const candidates = [
    path.join(__dirname, '..', 'hooks', name),
    path.join(os.homedir(), '.claude', 'hooks', name),
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}
const {
  parseEntries, citedSymbols, extractRefFiles, lineAnchoredRefs,
  classifySpec, makeRefResolver, matchedTracked, citedNameIsTrackedPath, symbolInText,
} = loadFromCandidates('currency.js');

// --- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const showAll = args.includes('--all');
const online = args.includes('--online');
const argOf = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const HOME = os.homedir();

// ⚠ THE LOCAL DAY, NOT THE UTC ONE. `toISOString().slice(0,10)` is UTC, and east of
// Greenwich it prints YESTERDAY for most of the working day — this report's first run
// stamped itself 2026-09-04 on 2026-09-05. A window line that is silently a day stale is
// the exact defect this instrument exists to measure, printed by the instrument.
function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const CAT_DIR = path.resolve(argOf('--catalogues') || path.join(HOME, '.anvideck', 'projects', 'anvi', '.anvi'));
// The project name is the store directory the catalogues sit in, exactly as ref-span-check
// derives its roots. Hardcoding anvi's own path would make every other project's citations
// report as missing — a wrong answer that looks like a finding.
const PROJECT = path.basename(path.dirname(CAT_DIR));
const REPO = path.resolve(argOf('--repo') || path.join(HOME, 'Documents', 'projects', PROJECT));
const CATALOGUES = ['hetvabhasa.md', 'vyapti.md', 'krama.md', 'dharana.md'];

// Universal entries carry no project citation by construction. EXCLUDED, and COUNTED —
// matching the grounding check's own rule (`/^U[A-Z]?\d+$/`), so the denominator cannot
// quietly shrink by a population nobody named.
const UNIVERSAL = /^U[A-Z]?\d+$/;

// --- the repo the citations are about ----------------------------------------
const git = (a) => execSync(`git ${a}`, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// The repo the CATALOGUES live in, which is a different repo from the project whenever
// `.anvi` is the symlink-to-central layout. Resolved through realpath: the symlink's path
// is in the project, the git dir it belongs to is not.
let storeRoot = null;
try {
  storeRoot = execSync('git rev-parse --show-toplevel',
    { cwd: fs.realpathSync(CAT_DIR), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch { storeRoot = null; }
const storeGit = (a) => {
  if (!storeRoot) { const e = new Error('no store repo'); e.status = 1; throw e; }
  return execSync(`git ${a}`, { cwd: storeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
};
const fileExists = (rel) => { try { return fs.statSync(path.join(REPO, rel)).isFile(); } catch { return false; } };

// The store's reference areas — vendored upstream source, Ground Truth docs,
// investigations. A REF naming one of those is grounded elsewhere, not dangling, and
// classifySpec is the one place that distinction is drawn. Areas are named once and both
// the resolver's index and the read-back path derive from that list.
const STORE = path.join(HOME, '.anvideck', 'projects', PROJECT);
const AREA_SPECS = [
  { area: 'ref/sources', dir: path.join(STORE, 'ref'), sub: 'sources/', strip: /^ref\// },
  { area: 'ref', dir: path.join(STORE, 'ref'), strip: /^ref\// },
  { area: 'investigations', dir: path.join(STORE, 'artifacts', 'investigations'), strip: /^(artifacts\/)?investigations\// },
  // ⚠ THE CATALOGUES THEMSELVES. Entries cite each other's documents — `vyapti.md`,
  // `projects/anvi/.anvi/dharana.md` — and those files are real, sitting in the store,
  // while the project repo has never tracked them. Without this area they classify as
  // `external` and land in the failure count: six of the first run's thirteen failures
  // were the catalogue naming itself. A checker that reports the corpus it is reading as
  // missing is measuring its own blind spot and calling it a finding.
  { area: '.anvi', dir: CAT_DIR, strip: /^(projects\/[^/]+\/)?\.anvi\// },
];
const AREA_DIR = new Map(AREA_SPECS.map(a => [a.area, a.dir]));
const refResolver = makeRefResolver(AREA_SPECS, { readdir: (d) => fs.readdirSync(d, { withFileTypes: true }) });

// --- reading a cited file ----------------------------------------------------
const textCache = new Map();
/** The text a cited path resolves to, or null. `kind` comes from classifySpec, so a
 *  reference-area hit is read from the area it was found in rather than from the repo —
 *  otherwise every vendored citation reads as unresolvable and the finding is about our
 *  layout, not about the citation. */
function textOf(res) {
  let abs = null;
  if (res.kind === 'present') abs = path.join(REPO, res.path);
  else if (res.kind === 'reference') abs = path.join(AREA_DIR.get(res.area) || '', res.path);
  if (!abs) return null;
  if (textCache.has(abs)) return textCache.get(abs);
  let v = null;
  try { v = fs.readFileSync(abs, 'utf8'); } catch { v = null; }
  textCache.set(abs, v);
  return v;
}

const specCache = new Map();
function classify(spec) {
  if (specCache.has(spec)) return specCache.get(spec);
  let res;
  try { res = classifySpec(spec, fileExists, git, refResolver); }
  catch { res = { kind: 'unknown', path: spec }; }   // a refusal is not an absence
  specCache.set(spec, res);
  return res;
}

// --- the repo-wide question, asked ONLY when the per-file one says no --------
// This is the distinction #272 asks for and #272's own guard could not draw: "this name is
// gone" and "this name is not where you said" are different repairs, and collapsing them
// makes the second inherit the first's confidence. The catalogues are excluded from the
// search — the entry that CITES a name contains that name, so a repo that tracks its own
// catalogues finds every citation alive in the document making the claim and reports
// nothing, forever. A check switched off looks exactly like a corpus with no defects.
const anviRel = path.relative(REPO, CAT_DIR);
const CATALOGUE_EXCLUDE = (anviRel && !anviRel.startsWith('..') && !path.isAbsolute(anviRel))
  ? ` -- ${JSON.stringify(`:(exclude,glob)${anviRel}/**`)} ${JSON.stringify(`:(exclude)${anviRel}`)}`
  : '';
const repoWide = new Map();
function existsAnywhere(name) {
  if (repoWide.has(name)) return repoWide.get(name);
  let v;
  try { v = git(`grep -l -w -F -e ${JSON.stringify(name)}${CATALOGUE_EXCLUDE}`).trim().length > 0; }
  // git grep exits 1 for "no match" — that IS the answer, and it arrives as a thrown error.
  // Any other failure is git being unable to answer, and must stay silent: a broken index
  // reported as a repo full of dead citations is the loudest possible way to be wrong.
  catch (e) { v = (e && e.status === 1) ? false : null; }
  repoWide.set(name, v);
  return v;
}

// --- the other citation kinds ------------------------------------------------
// Counted so the denominator is the whole bibliography, never the part this tool judges.
// Section anchors and line spans are DELEGATED — each already has an instrument that owns
// it, and a second reader of either would grade a different corpus under the same name.
const SECTION_RE = /(\S+\.md)\s*§/g;
const ISSUE_RE = /(?:^|[\s(])#(\d{1,6})\b/g;
const SHA_RE = /\b([0-9a-f]{7,40})\b/g;

// ⚠ A REPO THAT IS NOT A CHECKOUT MUST REFUSE, NOT REPORT. Every path question here goes
// through git, and git's answer from a plain directory is "never tracked" for everything —
// so the run comes back with the whole bibliography marked broken. Measured while building
// this: pointing --repo at an empty directory produced `0 of 590 cited paths (0%)` and 576
// failures, each one well-formed and false. It is the same defect as the quiet version the
// issue warned about, in the other direction: the number describes where the question was
// asked, not the corpus it names. A refusal is the only honest output, so it exits 255 with
// the rest of the refusals rather than joining the failure counts it cannot be told apart from.
function repoIsCheckout() {
  try { return git('rev-parse --is-inside-work-tree').trim() === 'true'; } catch { return false; }
}

function scan() {
  let files;
  try { files = fs.readdirSync(CAT_DIR).filter(f => CATALOGUES.includes(f)); }
  catch { return null; }
  if (!files.length) return null;

  const rows = [];          // one per (file, symbol) citation
  const fileRows = [];      // one per (entry, cited path)
  const other = { spans: 0, sections: 0, issues: [], shas: [] };
  const entries = { total: 0, universal: 0, noRef: 0, unanchorable: 0, judged: 0 };
  const stamps = {};

  for (const f of files.sort()) {
    const md = fs.readFileSync(path.join(CAT_DIR, f), 'utf8');
    let newest = '';
    for (const e of parseEntries(md)) {
      const stamp = (String(e.validatedField || '').match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || '';
      if (stamp > newest) newest = stamp;

      entries.total++;
      if (UNIVERSAL.test(e.id)) { entries.universal++; continue; }
      const ref = e.refField || '';
      if (!ref) { entries.noRef++; continue; }

      const pairs = citedSymbols(ref);
      const spans = lineAnchoredRefs(ref);
      const sections = [...ref.matchAll(SECTION_RE)].length;
      const issues = [...ref.matchAll(ISSUE_RE)].map(m => m[1]);
      // A sha is only a sha once it is not part of a longer word and not a hex-looking
      // extension-bearing token. Cheap and deliberately conservative: over-counting shas
      // would put resolvable-looking noise in a denominator.
      const shas = [...ref.matchAll(SHA_RE)].map(m => m[1]).filter(s => /[0-9]/.test(s) && /[a-f]/.test(s));
      // The path population is the UNION of the two readers currency already has:
      // extractRefFiles (whitelisted extensions, what the currency gate itself computes on)
      // and the paths citedSymbols hangs its parentheticals off (no whitelist). Taking
      // either alone drops a real population — `.cc` and `.rb` refs from the first, bare
      // bibliographic paths from the second — and a dropped population is a shrunk
      // denominator.
      const paths = [...new Set([...extractRefFiles(ref), ...pairs.map(p => p.file)])];

      other.spans += spans.length;
      other.sections += sections;
      other.issues.push(...issues.map(n => ({ entry: e.id, cat: f, n })));
      other.shas.push(...shas.map(s => ({ entry: e.id, cat: f, sha: s })));

      if (!paths.length && !spans.length && !sections && !issues.length && !shas.length) {
        // ⚠ NOT A FAILURE, AND NEVER FOLDED INTO `resolved`. The entry carries a REF that
        // names no checkable target — a cross-reference to another entry, prose, a
        // "n/a". It is the absence of a citation, which is a grounding gap of its own
        // kind and is reported as one.
        entries.unanchorable++;
        continue;
      }
      entries.judged++;

      for (const p of paths) {
        const res = classify(p);
        fileRows.push({ cat: f, entry: e.id, spec: p, kind: res.kind, resolved: res.path });
      }

      for (const pr of pairs) {
        const row = { cat: f, entry: e.id, file: pr.file, name: pr.name };
        // ⚠ #272's documented false-positive mode, and the reason this cannot simply be a
        // stricter version of the repo-wide check. A note may legitimately MENTION a name
        // while attributing it to another file in the same breath — "`foo` — now in
        // `bar.js`" — which reads as a mis-point to a per-file checker and as correct prose
        // to a human. Counted, NOT judged: it leaves the headline denominator entirely
        // rather than being scored either way.
        if ((pr.otherPaths || []).length) {
          rows.push({ ...row, status: 'ambiguous-attribution', detail: `parenthetical also names ${pr.otherPaths.join(', ')}` });
          continue;
        }
        // A cited name that names a tracked FILE is not a symbol, whatever its extension.
        if (citedNameIsTrackedPath(pr.name, git)) {
          rows.push({ ...row, status: 'names-a-file', detail: 'the cited name is a tracked path, not a symbol' });
          continue;
        }
        const res = classify(pr.file);
        const txt = textOf(res);
        if (txt === null) {
          // The file the pair hangs off does not resolve, so the per-file question CANNOT BE
          // ASKED. Reported as its own outcome — never as the symbol failing, which would
          // charge a path defect to a name.
          rows.push({ ...row, status: 'file-unresolved', detail: `${pr.file} → ${res.kind}` });
          continue;
        }
        const where = symbolInText(txt, pr.name);
        if (where === 'present') { rows.push({ ...row, status: 'in-file' }); continue; }
        if (where === 'tail-only') {
          // A dotted name whose TAIL is in the file but whose full form is not. Evidence
          // that stops one step short of the claim — reported as scope, never folded into
          // a resolution.
          rows.push({ ...row, status: 'tail-only', detail: `only \`${pr.name.split('.').pop()}\` is in ${pr.file}` });
          continue;
        }
        const anywhere = existsAnywhere(pr.name);
        if (anywhere === null) { rows.push({ ...row, status: 'unknown', detail: 'the repo-wide search could not answer' }); continue; }
        rows.push(anywhere
          ? { ...row, status: 'elsewhere', detail: `not in ${pr.file}, but present in the repo` }
          : { ...row, status: 'gone', detail: 'not in the named file, and nowhere in the repo' });
      }
    }
    stamps[f] = newest || '(none)';
  }
  return { rows, fileRows, other, entries, stamps };
}

// --- issues and shas ---------------------------------------------------------
// ⚠ RESOLUTION IS TALLIED OVER DISTINCT TARGETS, NEVER OVER CITATIONS, and the two are
// printed as two figures. The first version of the sha line read `45 resolve (20 in the
// repo, 4 in the store)` — 45 counting citations and 20+4 counting distinct shas, so the
// parenthetical did not sum to the number in front of it and only the source said why. A
// sha cited nine times is one resolution question, not nine.
//
// ONE tally for both resolvers, because the defect was found in the sha half and the issue
// half had it too, in the same sentence shape, one function away. A fix applied to one
// instance of a class and not its twin is how the twin survives.
function tally(seen, citations) {
  const vals = [...seen.values()];
  return {
    ok: vals.filter(v => v !== false && v !== null).length,
    bad: vals.filter(v => v === false).length,
    unknown: vals.filter(v => v === null).length,
    distinct: seen.size,
    citations,
    unresolved: [...seen.entries()].filter(([, v]) => v === false).map(([k]) => k),
  };
}

// A catalogue records shas from BOTH repos — the project's commits and the store commits
// that carried the harvest. Asking only the project repo reports every store sha as
// unresolvable, which is a fact about where the question was asked, not about the
// citation. So both are asked, and WHICH one answered is kept, because "resolves in the
// store" and "resolves nowhere" are different states and only one of them is a finding.
function resolveShas(list) {
  const seen = new Map();
  for (const s of list) {
    if (!seen.has(s.sha)) {
      let v;
      try { git(`cat-file -e ${s.sha}^{commit}`); v = 'repo'; }
      catch (e) {
        if (e && e.status === 128) {
          try { storeGit(`cat-file -e ${s.sha}^{commit}`); v = 'store'; }
          catch (e2) { v = (e2 && e2.status === 128) ? false : null; }
        } else v = null;
      }
      seen.set(s.sha, v);
    }
  }
  const vals = [...seen.values()];
  return {
    ...tally(seen, list.length),
    inRepo: vals.filter(v => v === 'repo').length,
    inStore: vals.filter(v => v === 'store').length,
  };
}

function resolveIssues(list) {
  const seen = new Map();
  for (const it of list) {
    if (!seen.has(it.n)) {
      let v;
      try {
        const out = execSync(`gh issue view ${it.n} --json number -q .number 2>/dev/null || gh pr view ${it.n} --json number -q .number 2>/dev/null`,
          { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        v = out ? true : false;
      } catch { v = null; }
      seen.set(it.n, v);
    }
  }
  return tally(seen, list.length);
}

// --- report ------------------------------------------------------------------
main();
function main() {
  if (!repoIsCheckout()) {
    console.error(`REFUSING: ${REPO} is not a git working tree, and every path question here is`);
    console.error('answered by git. From a plain directory git says "never tracked" about everything,');
    console.error('so the report would mark the entire bibliography broken. Point --repo at the checkout.');
    process.exitCode = 255;
    return;
  }
  const scanned = scan();
  if (scanned === null) {
    // Printing zeros here is indistinguishable from a catalogue with no citations, which is
    // the failure this whole report exists to catch.
    console.error(`REFUSING: no catalogue could be read at ${CAT_DIR}.`);
    process.exitCode = 255;
    return;
  }
  const { rows, fileRows, other, entries, stamps } = scanned;

  let head = '(unknown)', headDate = '(unknown)';
  try { head = git('rev-parse --short HEAD').trim(); } catch { /* not a checkout */ }
  try { headDate = git('log -1 --format=%cs').trim(); } catch { /* ditto */ }

  const by = (s) => rows.filter(r => r.status === s).length;
  const kindOf = (k) => fileRows.filter(r => r.kind === k).length;

  // The headline denominator, stated as a subtraction so the reader can see what left it.
  const askable = rows.filter(r => ['in-file', 'tail-only', 'elsewhere', 'gone'].includes(r.status));
  const inFile = by('in-file');
  const misPointing = by('elsewhere') + by('gone');
  const deadPaths = kindOf('deleted') + kindOf('external');
  const failures = misPointing + deadPaths;

  // ⚠ THE PRINTED CLASSES MUST SUM TO THEIR TOTALS, AND THIS IS THE ONLY THING THAT ASKS.
  // Every number in this report is a partition of a population, and a partition that has
  // silently stopped covering its population still prints a full page of plausible figures —
  // the failure is invisible in exactly the way the metric this tool was built to replace
  // was invisible. A mismatch is not a finding about the corpus, it is a refusal to be read.
  const sums = [
    ['entries', entries.universal + entries.noRef + entries.unanchorable + entries.judged, entries.total],
    ['symbol pairs', askable.length + by('ambiguous-attribution') + by('names-a-file') + by('file-unresolved') + by('unknown'), rows.length],
    ['askable pairs', inFile + by('tail-only') + by('elsewhere') + by('gone'), askable.length],
    ['cited paths', kindOf('present') + kindOf('reference') + kindOf('ambiguous') + kindOf('deleted') + kindOf('external') + kindOf('unknown'), fileRows.length],
  ].filter(([, got, want]) => got !== want);

  const shas = resolveShas(other.shas);
  const issues = online ? resolveIssues(other.issues) : null;

  const payload = {
    window: { head, headCommitDate: headDate, computedAt: localDay(), repo: REPO, catalogues: CAT_DIR, newestValidated: stamps },
    entries,
    symbolPairs: {
      total: rows.length,
      askable: askable.length,
      inFile, tailOnly: by('tail-only'), elsewhere: by('elsewhere'), gone: by('gone'),
      ambiguousAttribution: by('ambiguous-attribution'), namesAFile: by('names-a-file'),
      fileUnresolved: by('file-unresolved'), unknown: by('unknown'),
    },
    citedPaths: {
      total: fileRows.length,
      present: kindOf('present'), reference: kindOf('reference'), ambiguous: kindOf('ambiguous'),
      deleted: kindOf('deleted'), external: kindOf('external'), unknown: kindOf('unknown'),
    },
    delegated: { lineSpans: other.spans, sectionAnchors: other.sections },
    issues: { cited: other.issues.length, ...(issues || { checked: false }) },
    shas: { cited: other.shas.length, ...shas },
    failures,
    rows: showAll || jsonOut ? rows : undefined,
    fileRows: showAll || jsonOut ? fileRows : undefined,
  };

  if (sums.length) {
    for (const [what, got, want] of sums) {
      console.error(`✗ INTERNAL: the ${what} classes sum to ${got}, not ${want} — a class is missing or double-counted.`);
    }
    console.error('Do not trust this run. The figures below would each be well-formed and none of them complete.');
    process.exitCode = 254;
    return;
  }

  if (jsonOut) {
    console.log(JSON.stringify(payload, null, 1));
    // ⚠ `process.exitCode`, NEVER `process.exit()`. Node's stdout is asynchronous when it is
    // a pipe, and exiting kills the process before the buffer drains — measured in this repo
    // at 65,536 bytes through a pipe against the whole document to a file, cut mid-string
    // with no error and no non-zero status.
    process.exitCode = Math.min(failures, 251);
    return;
  }

  const pct = (n, d) => d ? ` (${Math.round((n / d) * 1000) / 10}%)` : ' (no denominator — nothing was examined)';

  console.log(`REF strength — ${PROJECT}: does a citation RESOLVE where the entry names it?`);
  console.log(`  window: repo ${REPO} at ${head} (committed ${headDate}); computed ${payload.window.computedAt}`);
  console.log(`  catalogues: ${CAT_DIR}`);
  console.log(`  newest VALIDATED stamp per catalogue: ${Object.entries(stamps).map(([k, v]) => `${k.replace('.md', '')} ${v}`).join('   ')}`);
  console.log('');
  // The banner's grounding count reads three catalogues and this reads four (dharana is a
  // catalogue and its entries cite code), so the two denominators differ BY DESIGN. Said
  // here rather than left for someone to discover by subtracting.
  console.log(`  entries ${entries.total} across ${CATALOGUES.length} catalogues — universal (excluded by the grounding check's own rule) ${entries.universal}   no REF ${entries.noRef}   REF with no checkable target ${entries.unanchorable}   judged here ${entries.judged}`);
  console.log('  ⚠ "REF with no checkable target" is NOT a pass. It is the absence of a citation,');
  console.log('    and it is never folded into anything below.');
  console.log('');
  console.log(`  ── (file, symbol) — THE HEADLINE ─────────────────────────────────────────`);
  console.log(`  ${inFile} of ${askable.length} pairs resolve IN THE FILE THE ENTRY NAMES${pct(inFile, askable.length)}`);
  console.log(`     not where you said (present elsewhere in the repo)  ${by('elsewhere')}`);
  console.log(`     nowhere in the repo                                 ${by('gone')}`);
  console.log(`     tail-only (dotted name, only its tail is present)   ${by('tail-only')}  — not a resolution`);
  console.log(`  ${rows.length} pairs cited in total; ${rows.length - askable.length} could not be asked and are NOT in the denominator above:`);
  console.log(`     ambiguous attribution (parenthetical names another file — counted, not judged)  ${by('ambiguous-attribution')}`);
  console.log(`     the cited name is itself a tracked path, not a symbol                           ${by('names-a-file')}`);
  console.log(`     the cited FILE does not resolve, so the question cannot be asked                ${by('file-unresolved')}`);
  console.log(`     the repo-wide search could not answer                                           ${by('unknown')}`);
  console.log('');
  console.log(`  ── cited paths ───────────────────────────────────────────────────────────`);
  console.log(`  ${kindOf('present')} of ${fileRows.length} cited paths are files in this repo${pct(kindOf('present'), fileRows.length)}`);
  console.log(`     resolve into the store's reference area  ${kindOf('reference')}`);
  console.log(`     ambiguous (a shorthand matching several)  ${kindOf('ambiguous')}  — resolves to several, not to none`);
  console.log(`     tracked once, since deleted               ${kindOf('deleted')}`);
  console.log(`     never tracked here                        ${kindOf('external')}`);
  console.log(`     git could not answer                      ${kindOf('unknown')}`);
  console.log('');
  console.log(`  ── delegated, counted here so the bibliography's denominator is whole ─────`);
  console.log(`  line spans      ${other.spans}  → scripts/ref-span-check.js owns this class`);
  console.log(`  section anchors ${other.sections}  → scripts/citation-anchors.js owns this class`);
  console.log(`  shas            ${shas.ok} of ${shas.distinct} distinct shas resolve (${shas.inRepo} in the repo, ${shas.inStore} in the store); ${shas.bad} do not, ${shas.unknown} unanswerable — cited ${shas.citations} times`);
  if (shas.unresolved.length) console.log(`                  unresolved: ${shas.unresolved.join(', ')}`);
  console.log(issues
    ? `  issues/PRs      ${issues.ok} of ${issues.distinct} distinct issues/PRs resolve; ${issues.bad} do not, ${issues.unknown} unanswerable — cited ${issues.citations} times`
    : `  issues/PRs      ${other.issues.length} cited — NOT CHECKED (needs the network; pass --online)`);
  console.log('');
  console.log(`  FAILURES (citations that do not resolve where named): ${failures}`);
  console.log(`     = ${misPointing} symbol pairs (elsewhere ${by('elsewhere')} + gone ${by('gone')}) + ${deadPaths} paths (deleted ${kindOf('deleted')} + external ${kindOf('external')})`);
  console.log('  ⚠ this is a PROVENANCE measurement — whether a pointer lands where it says.');
  console.log('    It is NOT a measure of whether the citation SUPPORTS the claim. That is a');
  console.log('    ruling, not a computation, and is deliberately not attempted here.');

  if (!rows.length && !fileRows.length) {
    console.log('');
    console.log('⚠ NO CITATIONS FOUND AT ALL. That is not a clean sweep — it is a matcher that');
    console.log('  matched nothing, or a catalogue that cites nothing. Which one has to be settled by looking.');
  }

  const bad = rows.filter(r => ['elsewhere', 'gone'].includes(r.status));
  const badPaths = fileRows.filter(r => ['deleted', 'external'].includes(r.kind));
  if (bad.length || badPaths.length) console.log('');
  for (const r of bad) console.log(`  ✗ [${r.cat} ${r.entry}] \`${r.file}\` (\`${r.name}\`) — ${r.status}: ${r.detail}`);
  for (const r of badPaths) console.log(`  ✗ [${r.cat} ${r.entry}] ${r.spec} — path ${r.kind}`);
  if (showAll) {
    for (const r of rows) if (!['elsewhere', 'gone'].includes(r.status)) console.log(`  · [${r.cat} ${r.entry}] \`${r.file}\` (\`${r.name}\`) — ${r.status}${r.detail ? `: ${r.detail}` : ''}`);
  }

  process.exitCode = Math.min(failures, 251);
}

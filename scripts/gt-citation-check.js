#!/usr/bin/env node
// gt-citation-check.js — does every section of a Ground Truth doc cite code, or say why it cannot? (anvi #414)
//
// The session banner counts Ground Truth docs by PRESENCE, and every catalogue entry reads as
// grounded. The docs' own generator asks for more: no stage without a `file:line` citation.
// Measured 2026-09-29 against that bar, the three docs carried 24 citations across 38 sections
// and 25 sections had none. Some of those are right to have none — a preamble, the OPAQUE list,
// a method note, a re-validation log, and every OBSERVED claim about a closed-source system.
// The rest were behavioural claims about source we had vendored and never cited; one of them
// (the gh doc's "no board-related input on the create path") was simply false, and citing it
// is what found that out.
//
// THE BAR (ruled on #414): no section with zero `file:line` citations UNLESS it declares why,
// in a line of its own:
//
//   **UNCITABLE:** <the reason — non-empty>
//
// The declaration is the author's, and it is visible: a reviewer reads the reason instead of a
// number. There is deliberately no list of exempt HEADINGS here — "OPAQUE" or "Method" in a
// title is a classification, and a section keyed on its title escapes the check the day it is
// renamed or the day a behavioural claim is filed under it.
//
// The one structural exemption is the PREAMBLE (text before the first `##`): the title and the
// framing paragraph, which every doc has and no doc can cite.
//
// What counts as a citation: `<path>.<ext>:<line>` or `:<line>-<line>`, any extension — the
// vendored sources here are C and Go, and a counter that knows only `.js|.rb|.ts|.py` reads
// both docs about them as uncited (the old `ground.md` grep did exactly that).
//
// Exit 0: every section cites or declares. 1: a section does neither (each is named).
// 2: NOT MEASURED — no Ground Truth doc was found or one could not be read. "Found nothing to
// check" must never print as "nothing wrong".
//
// Usage: node scripts/gt-citation-check.js <ref-dir | GROUND_TRUTH_*.md>... [--json]

'use strict';
const fs = require('fs');
const path = require('path');

const CITE = /[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,5}:\d+(?:-\d+)?/g;
const DECLARED = /^\*\*UNCITABLE:\*\*(.*)$/;
const HEADING = /^(#{2,3}) (.*)$/;

// A section runs from its `##` or `###` heading to the next one. Lines inside ``` fences are
// still read for citations (a quoted snippet's header comment may carry one) but a `#` line
// inside a fence is code, not a heading.
function sections(text) {
  const out = [];
  let cur = { heading: null, line: 1, citations: 0, declared: null };
  let fenced = false;
  text.split('\n').forEach((l, i) => {
    if (/^\s*```/.test(l)) fenced = !fenced;
    const h = !fenced && l.match(HEADING);
    if (h) {
      out.push(cur);
      cur = { heading: h[2].trim(), line: i + 1, citations: 0, declared: null };
      return;
    }
    cur.citations += (l.match(CITE) || []).length;
    const d = !fenced && l.match(DECLARED);
    if (d && cur.declared === null) cur.declared = d[1].trim();
  });
  out.push(cur);
  return out;
}

function judge(text) {
  return sections(text).map((s) => {
    if (s.heading === null) return { ...s, verdict: 'preamble' };
    if (s.citations > 0) return { ...s, verdict: 'cited' };
    if (s.declared) return { ...s, verdict: 'uncitable' };
    return { ...s, verdict: 'missing', why: s.declared === '' ? 'UNCITABLE is declared with no reason' : 'no citation and no UNCITABLE line' };
  });
}

function docsFrom(args) {
  const docs = [];
  for (const a of args) {
    let st;
    try { st = fs.statSync(a); } catch { return { error: `cannot read ${a}` }; }
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(a).sort()) if (/^GROUND_TRUTH_.*\.md$/.test(f)) docs.push(path.join(a, f));
    } else docs.push(a);
  }
  return { docs };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const { docs, error } = docsFrom(args.filter((a) => a !== '--json'));
  if (error || !docs.length) {
    console.log(`gt-citation-check: NOT MEASURED — ${error || 'no GROUND_TRUTH_*.md found in ' + (args.filter((a) => a !== '--json').join(' ') || '(no path given)')}`);
    process.exit(2);
  }
  const report = [];
  for (const d of docs) {
    let text;
    try { text = fs.readFileSync(d, 'utf8'); } catch { console.log(`gt-citation-check: NOT MEASURED — cannot read ${d}`); process.exit(2); }
    report.push({ doc: d, sections: judge(text) });
  }
  let missing = 0;
  if (json) {
    for (const r of report) missing += r.sections.filter((s) => s.verdict === 'missing').length;
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const r of report) {
      const n = (v) => r.sections.filter((s) => s.verdict === v).length;
      const judged = r.sections.length - n('preamble');
      const cites = r.sections.reduce((a, s) => a + s.citations, 0);
      console.log(`${path.basename(r.doc)}: ${judged} sections — ${n('cited')} cited, ${n('uncitable')} declared UNCITABLE, ${n('missing')} MISSING · ${cites} citations`);
      for (const s of r.sections) {
        if (s.verdict === 'missing') console.log(`  ✗ L${s.line} ${s.heading} — ${s.why}`);
        if (s.verdict === 'uncitable') console.log(`  · L${s.line} ${s.heading} — UNCITABLE: ${s.declared.slice(0, 100)}`);
      }
      missing += n('missing');
    }
    console.log(missing ? `\n${missing} section(s) neither cite code nor say why they cannot.` : '\nevery section cites code or says why it cannot.');
  }
  process.exit(missing ? 1 : 0);
}

module.exports = { sections, judge };

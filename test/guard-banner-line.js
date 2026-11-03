// guard-banner-line.js — what a "says nothing" banner control may still hear (#703).
//
// The session-start banner names the locked guard's installed copy on every machine that has
// one (#682): one machine-wide line, `🔒 GUARD: installed copy <sha12> (<date>) · on node vX`.
// A test cannot switch it off. hooks/structure-lock.js lockDir lets a real lock directory win
// over ANVI_LOCK_DIR on purpose — settings can set a hook's environment, so any override a test
// could use is one an agent could use to hide or forge the line. That rule stays as it is.
//
// So a control that expects silence asks a narrower question: is the banner EXACTLY the guard
// line this machine's lock says it should be, and nothing else? Where no guard is installed the
// answer must be the empty string; where one is, the whole banner must be one line of the pinned
// shape naming the commit and date the lock itself records. Any other text — a second segment, a
// stray separator, a guard line on a machine with no lock, a line naming another commit — fails.
//
// The expectation is read from the lock through the same module the hook uses (installedGuard),
// not from the hook, so a hook that prints the wrong copy cannot agree with itself.
'use strict';
const L = require('../hooks/structure-lock.js');

// The only three forms the node segment takes (hooks/ground-truth-session-start.js guardText).
const NODE = "(?:on node v\\d+\\.\\d+\\.\\d+|on node \\(version unrecorded\\)|NO root-owned node of its own, so the owner's commands cannot run)";
const NOTE = '(?: — NOT root-owned, so it holds nothing)?';

/** The guard this machine's lock records, or null where none is installed. */
function installed() {
  const v = L.installedGuard();
  return v && typeof v.commit === 'string' ? { commit12: v.commit.slice(0, 12), date: String(v.installed).slice(0, 10) } : null;
}

/**
 * Whether `banner` says nothing except this machine's guard line.
 * Returns { ok, expected, why } — `why` names the mismatch for the test message.
 */
function onlyGuardLine(banner) {
  const g = installed();
  const b = String(banner);
  if (!g) return { ok: b === '', expected: 'nothing at all (no guard installed here)', why: b === '' ? '' : `got ${JSON.stringify(b.slice(0, 200))}` };
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shape = new RegExp(`^🔒 GUARD: installed copy ${esc(g.commit12)} \\(${esc(g.date)}\\)${NOTE} · ${NODE}$`);
  const ok = shape.test(b);
  return { ok, expected: `nothing but the guard line for ${g.commit12} (${g.date})`, why: ok ? '' : `got ${JSON.stringify(b.slice(0, 200))}` };
}

module.exports = { onlyGuardLine, installed };

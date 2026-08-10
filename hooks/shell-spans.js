#!/usr/bin/env node
// shell-spans: which parts of a command string the shell treats as TEXT rather than
// as code. Shared by the PreToolUse:Bash guards; not a hook itself.
//
// WHY THIS IS A MODULE AND NOT A COPY (#242). It began inside shell-rewrite-guard.js
// as the answer to one question: which characters may a rewrite rule ask about? Then
// the catalogue-ID leak guard needed the same spans to answer a DIFFERENT question:
// which characters could be a publishing command? The decision recorded when the
// second need was first anticipated was to leave the code where it was until fixing
// the second guard meant COPYING this scanner — because the two guards need different
// POLICIES over the same spans, so what they share is the span-finding, not the
// verdict. That is exactly what happened, so the span-finding moved here and each
// guard keeps its own policy:
//
//   shell-rewrite-guard  a quoted body is inert for every rule; an unquoted one is
//                        inert only for splitting and globbing, because parameter
//                        expansion still happens there
//   catalogue-id-leak-guard
//                        a quoted body cannot be a command at all, so it is removed
//                        before classification; an unquoted body is left alone
//
// Duplicating it would have meant two copies of a parser whose policy was settled by
// measuring two shells — and the copies would drift on exactly the question that took
// the measuring to answer.

// ── Quote-state scanner ──────────────────────────────────────────────────────
// Whether a `$` is quoted decides whether the shell rewrites it, so the question
// cannot be asked with a bare regex — `'$VAR'` and `$VAR` differ only in context.
// Returns an array of quote states, one per character: 0 unquoted, 1 single, 2 double.
function quoteStates(s) {
  const st = new Array(s.length).fill(0);
  let mode = 0; // 0 none, 1 single, 2 double
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (mode === 0 && c === '\\') { st[i] = 0; i++; if (i < s.length) st[i] = 0; continue; }
    if (mode === 2 && c === '\\') { st[i] = 2; i++; if (i < s.length) st[i] = 2; continue; }
    if (mode === 0 && c === "'") { mode = 1; st[i] = 1; continue; }
    if (mode === 1 && c === "'") { mode = 0; st[i] = 1; continue; }
    if (mode === 0 && c === '"') { mode = 2; st[i] = 2; continue; }
    if (mode === 2 && c === '"') { mode = 0; st[i] = 2; continue; }
    st[i] = mode;
  }
  return st;
}

// ── Heredoc-body scanner ─────────────────────────────────────────────────────
// A heredoc body is DATA — the shell hands it to a program — so most of what a guard
// looks for cannot happen there. But NOT all of it, and the intuitive version of this
// is wrong in the dangerous direction, so the policy below was measured in both shells
// rather than reasoned about (#253):
//
//   <<'EOF'   $var[1] → literal `$var[1]`      --include=*.js → literal
//   <<EOF     $var[1] → `h` in zsh             --include=*.js → literal
//                     → `hello[1]` in bash
//
// Two facts fall out. Pathname expansion NEVER happens in a heredoc body, either
// form, either shell. But an UNQUOTED body does perform parameter expansion, and zsh
// genuinely applies SUBSCRIPTING inside it. Excluding both bodies wholesale — which
// is what "heredoc bodies are data" suggests, and what this was first written to do —
// would put a false negative in a guard whose whole purpose is catching failures that
// fall silent. Hence two distinct states rather than a boolean: the seam is the point.
//
// Returns a parallel array: 0 outside any body, 1 inside a QUOTED body (inert for
// every rule), 2 inside an UNQUOTED one (inert for splitting and globbing only).
//
// `<<<` is a herestring, not a heredoc, and is left alone by construction rather than
// by a special case: the pattern requires a delimiter name after the `<<`, and `<`
// is not a name character. That matters because `<<< "$list"` is the rewrite guard's
// own recommended remedy — a case asserts a risky loop AFTER one is still reported, so
// nothing silently swallows the rest of the command.
//
// KNOWN LIMIT, pinned by a test on the rewrite guard's side: two heredocs introduced
// on ONE line (`cmd <<A <<B`) is legal shell, and only the first body is recognised
// here. The second is left as ordinary text, which is the over-scanning direction for
// both callers — it can produce a false positive, never a false negative.
function heredocStates(s, states) {
  const hd = new Array(s.length).fill(0);
  const re = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (states[m.index] !== 0) continue;        // an introducer inside quotes is text
    const stripTabs = m[1] === '-';
    const kind = m[2] !== '' ? 1 : 2;           // quoted delimiter → fully inert body
    const delim = m[3];
    const nl = s.indexOf('\n', m.index + m[0].length);
    if (nl === -1) break;                       // introducer with no body at all
    let i = nl + 1, end = s.length;
    while (i <= s.length) {
      const eol = s.indexOf('\n', i);
      const lineEnd = eol === -1 ? s.length : eol;
      const line = stripTabs ? s.slice(i, lineEnd).replace(/^\t+/, '') : s.slice(i, lineEnd);
      if (line === delim) { end = i; break; }
      if (eol === -1) { end = s.length; break; } // unterminated: body runs to the end
      i = eol + 1;
    }
    for (let k = nl + 1; k < end; k++) hd[k] = kind;
    re.lastIndex = Math.max(re.lastIndex, end);
  }
  return hd;
}

// Blank out QUOTED heredoc bodies — the spans that cannot be a command under any
// reading — preserving LENGTH and newlines so offsets, line structure and any
// subsequent splitting are unchanged. A caller that DROPPED the characters instead
// would glue neighbouring tokens together and could manufacture a match the original
// text does not contain.
//
// Deliberately not parameterised over which states to blank. Only one caller wants
// this and it wants exactly this; a `kinds` option was written first and removed,
// because its second value had no caller — an unreachable branch in a guard's
// support code is indistinguishable from a dead one, and neither verdict is
// available while nothing exercises it. A caller needing the other policy can use
// `heredocStates` directly, which is what the rewrite guard does.
function blankQuotedHeredocs(s) {
  const hd = heredocStates(s, quoteStates(s));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += hd[i] === 1 ? (s[i] === '\n' ? '\n' : ' ') : s[i];
  }
  return out;
}

module.exports = { quoteStates, heredocStates, blankQuotedHeredocs };

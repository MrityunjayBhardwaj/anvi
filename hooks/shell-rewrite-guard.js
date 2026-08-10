#!/usr/bin/env node
// shell-rewrite-guard: PreToolUse:Bash hook
//
// Warns when a command uses an idiom that THIS shell (zsh, the macOS default)
// rewrites before the command ever sees it.
//
// Why this exists (#245). The catalogue has carried this error pattern since
// 2026-07-29 with NINE recorded instances across three sessions, and its remedy has
// been restated three times, each time stronger — ending at "write probes in
// `bash -c` whenever the probe's answer is going to be believed." Instance 10
// happened anyway, in a throwaway verification command written at the end of a
// session. That is the point: these commands are written last, when attention is
// spent, and a habit is exactly the wrong mechanism for them. Two PreToolUse:Bash
// guards already exist for other known-bad things; this is the third.
//
// What makes the class expensive is the DIRECTION of failure. Almost every recorded
// instance failed toward the answer that required no action — a loop that runs once
// under-reports, so a gate says "nothing found" and an audit says "no findings".
// Recorded consequences: a pre-merge safety gate reporting 0 orphan risk when the
// real count was 27; a probe reporting FILE MISSING for eleven refs that all exist;
// a "NO LIVE DIR" verdict that a correct loop turned into two found directories.
// The two instances that failed LOUDLY (git rejecting a pathspec, zsh aborting on
// nomatch) cost nothing at all.
//
// Every rule below was MEASURED in both shells rather than reasoned about, because
// the intuitions here are wrong in both directions:
//
//   for x in $VAR      zsh 1 iteration   bash 3   → FLAGGED (silent under-report)
//   for x in ${VAR}    zsh 1 iteration   bash 3   → FLAGGED. Bracing does NOT
//                                                    restore splitting; the
//                                                    catalogue's brace advice is
//                                                    about subscripting, not this.
//   for x in $(cmd)    zsh 3 iterations  bash 3   → NOT flagged. zsh splits
//                                                    command substitution even
//                                                    though it does not split
//                                                    parameter expansion. Flagging
//                                                    it would fire on nearly every
//                                                    command and train the reader
//                                                    to ignore the guard.
//   for x in $arr      zsh 3 iterations           → NOT flagged when the same
//                                                    command assigns arr=(…);
//                                                    zsh arrays do expand to
//                                                    multiple words.
//   set -- $VAR        zsh $#=1          bash 3   → FLAGGED (same mechanism)
//   "^## $pre[0-9]+"   becomes "^## +"            → FLAGGED ($var[…] is array
//                                                    subscripting, not
//                                                    interpolation)
//   --include=*.js     aborts: no matches found   → FLAGGED (loud, but cheap)
//
// Non-blocking: emits a reminder, never refuses. A false positive must cost a line
// of text, not a blocked command — and the remedy is always cheap to apply.
//
// CLAUDE_DIR / no state: this guard is pure text analysis of the command. It reads
// nothing from disk, so it cannot go stale against an install.
'use strict';

// The pure predicates are exported and the runtime runs only when this file is
// INVOKED, mirroring hooks/anvi-harvest-lease.js. Without that seam the refusal in
// isArrayLike could not be tested at all — the scan cannot produce a name that
// reaches it — and an untested guard clause is the exact thing #249 cleared out of
// this file. The stdin timeout lives inside the runtime block for the same reason:
// at module scope it would arm a process-exiting timer inside any test that requires
// this file.

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
// A heredoc body is DATA — the shell hands it to a program — so most of what this
// guard looks for cannot happen there. But NOT all of it, and the intuitive version
// of this fix is wrong in the dangerous direction, so the policy below was measured
// in both shells rather than reasoned about (#253):
//
//   <<'EOF'   $var[1] → literal `$var[1]`      --include=*.js → literal
//   <<EOF     $var[1] → `h` in zsh             --include=*.js → literal
//                     → `hello[1]` in bash
//
// Two facts fall out. Pathname expansion NEVER happens in a heredoc body, either
// form, either shell — so the glob rule is always a false positive there. But an
// UNQUOTED body does perform parameter expansion, and zsh genuinely applies
// SUBSCRIPTING inside it, so the `$var[` rule is correct there and must keep firing.
// Excluding both bodies wholesale — which is what "heredoc bodies are data" suggests,
// and what this was first written to do — would put a false negative in a guard whose
// whole purpose is catching failures that fall silent.
//
// Returns a parallel array: 0 outside any body, 1 inside a QUOTED body (inert for
// every rule), 2 inside an UNQUOTED one (inert for splitting and globbing only).
//
// `<<<` is a herestring, not a heredoc, and is left alone by construction rather than
// by a special case: the pattern requires a delimiter name after the `<<`, and `<`
// is not a name character. That matters because `<<< "$list"` is this guard's own
// recommended remedy — a case asserts a risky loop AFTER one is still reported, so
// nothing silently swallows the rest of the command.
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

// There is deliberately NO `bash -c` exemption, and the reason is worth recording
// because writing one was the first instinct. The documented remedy is to wrap a probe
// in `bash -c '…'`, and it looked like the guard would have to special-case that — but
// the body of a `bash -c` invocation is necessarily SINGLE-QUOTED (it has to be, or the
// outer shell expands it first), so the quote-state scan below already produces silence
// for it, for the right reason. An explicit exemption was written, and mutation testing
// showed removing it changed no result: it was dead code, sitting in front of a
// predicate that already answered.
//
// It was also actively harmful. Matching `bash -c` at the START of the command exempted
// everything AFTER it too, so `bash -c 'echo hi'` followed by a genuinely risky zsh loop
// went unreported — a false negative, on the permissive side, introduced by a guard
// against permissive failures. Deleted rather than narrowed: the case it was written for
// is covered, and the case it created was not.

// Names that DO expand to multiple words unquoted in zsh, so flagging them is wrong.
// `$argv` is zsh's positional array; a name the same command assigns as `name=(…)` is
// an array too. Everything else is assumed scalar, which is the common case for a value
// captured from `$(…)` — and the case every recorded instance was.
//
// `@` and `*` were listed here too and have been REMOVED as unreachable (#249): the
// scan below requires `[A-Za-z_]` after the `$`, so it can never hand this function
// those names, and `$@`/`$*` are already silent for that reason. They are asserted
// silent in the suite so that widening the scan reddens a case and brings whoever
// widens it back here — which a comment alone would not do.
function isArrayLike(name, cmd) {
  if (name === 'argv') return true;
  // A name that is not a plain identifier is not one this function can answer about,
  // so it is REFUSED rather than repaired (#254). The previous line stripped the
  // offending characters, which reads as the careful option and is the opposite:
  // stripping SHORTENS the name, and a shorter name is a BROADER pattern — in the
  // limit `\b=\(`, which matches any array assignment anywhere, returns "array-like",
  // and makes the guard go SILENT. Returning false keeps the detection rules live,
  // which is the reporting direction and the safe one here. Unreachable today (the
  // only call site passes a capture constrained to this same shape); it exists
  // because the edit that would make it reachable — widening that scan — is exactly
  // the one this file's comments invite.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  return new RegExp(`\\b${name}=\\(`).test(cmd);
}

// A bare parameter expansion — `$NAME` or `${NAME}` — that is not quoted, not a
// command substitution, and not array-like. `$(` is excluded by construction: the
// scan requires a name character (or `{`) after the `$`.
function bareScalarExpansions(text, offset, states, hd, cmd) {
  const found = [];
  const re = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (states[offset + m.index] !== 0) continue;      // quoted → shell leaves it alone
    if (hd[offset + m.index] !== 0) continue;          // heredoc body → no loop this shell runs
    if (isArrayLike(m[1], cmd)) continue;              // arrays do split
    found.push(m[0]);
  }
  return found;
}

module.exports = { quoteStates, heredocStates, isArrayLike, bareScalarExpansions };

if (require.main !== module) return;

const stdinTimeout = setTimeout(() => process.exit(0), 5000);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const cmd = (data.tool_input && data.tool_input.command) || '';
    if (!cmd) process.exit(0);

    const states = quoteStates(cmd);
    const hd = heredocStates(cmd, states);
    const findings = [];

    // (1) `for NAME in <list>` — the nine-instance mechanism. The list ends at the
    // first `;`, newline, or `do`, whichever comes first.
    for (const m of cmd.matchAll(/\bfor\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s/g)) {
      const start = m.index + m[0].length;
      const rest = cmd.slice(start);
      const end = rest.search(/;|\n|\bdo\b/);
      const list = end === -1 ? rest : rest.slice(0, end);
      const bare = bareScalarExpansions(list, start, states, hd, cmd);
      if (bare.length) {
        findings.push(`\`for … in ${bare[0]}\` iterates ONCE here (bash: once per line). ` +
                      `The loop body runs with the whole newline-joined string as the variable.`);
      }
    }

    // (2) `set -- $VAR` — same mechanism, different idiom; recorded as instance 9,
    // where it produced a uniform FILE MISSING table for eleven files that exist.
    for (const m of cmd.matchAll(/\bset\s+--\s/g)) {
      const start = m.index + m[0].length;
      const rest = cmd.slice(start);
      const end = rest.search(/;|\n/);
      const list = end === -1 ? rest : rest.slice(0, end);
      const bare = bareScalarExpansions(list, start, states, hd, cmd);
      if (bare.length) {
        findings.push(`\`set -- ${bare[0]}\` sets \$# to 1 here, so \$1…\$n never populate.`);
      }
    }

    // (3) `$var[` inside a double-quoted string is array SUBSCRIPTING, not
    // interpolation followed by a bracket: `"^## $pre[0-9]+"` becomes `"^## +"`.
    // Only inside double quotes — unquoted it would also glob, and single quotes are
    // literal. Bracing (`${pre}[0-9]`) is the fix for this one, unlike (1).
    // The state check is the ONLY thing keeping a single-quoted `'$re[0-9]'` — an
    // ordinary literal — from being reported; nothing else in the guard answers it,
    // so it carries its own silence case (#249).
    for (const m of cmd.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\[/g)) {
      if (states[m.index] !== 2) continue;
      if (hd[m.index] === 1) continue;                 // quoted body is literal; an UNQUOTED one really does subscript
      findings.push(`\`$${m[1]}[…]\` is parsed as an array subscript, not as \`$${m[1]}\` ` +
                    `followed by \`[…]\` — the pattern silently becomes something else. ` +
                    `Brace it: \`\${${m[1]}}[…]\`.`);
    }

    // (4) A glob character reaching a flag's value unquoted. zsh expands it against
    // the cwd and, finding nothing, aborts the command under `nomatch` before the
    // program runs. Loud, so cheap — included because the near-miss it caused sat one
    // command away from a label asserting a conclusion.
    // What the state check actually covers is narrower than it looks (#249). The
    // single-quoted REMEDY `--include='*.js'` is already answered by the value pattern,
    // which excludes quote characters, so the check cannot be what protects it. Its only
    // real work is the DOUBLE-quoted `"--include=*.js"`, where the value pattern does
    // match and only the state distinguishes it — and that is the case it carries.
    for (const m of cmd.matchAll(/(--?[A-Za-z][A-Za-z0-9-]*=)([^\s'"]*[*?][^\s'"]*)/g)) {
      if (states[m.index] !== 0) continue;
      if (hd[m.index] !== 0) continue;                 // no pathname expansion in any heredoc body
      findings.push(`\`${m[1]}${m[2]}\` is glob-expanded against the current directory; ` +
                    `with no match zsh aborts the command before it runs. Quote it: ` +
                    `\`${m[1]}'${m[2]}'\`.`);
    }

    if (!findings.length) process.exit(0);

    const message =
      `⚠ This shell rewrites part of this command before it runs (zsh, not bash):\n` +
      findings.map(f => `  • ${f}`).join('\n') +
      // No instance COUNT here on purpose (#249). A number in shipped text has to be
      // re-synced by hand every time the catalogue moves, and it had already drifted by
      // one before anybody read it. What makes the warning worth reading is the
      // direction of the failure, which does not change.
      `\n\nWhy this is worth a line of text: this pattern recurs, and almost every ` +
      `recorded instance failed toward the answer that required no action — a loop ` +
      `that runs once under-reports, so the gate says "nothing found".\n` +
      `Remedies, in order of preference: \`while IFS= read -r x; do … done <<< "$list"\`, ` +
      `which splits on newlines in BOTH shells; wrap the whole probe in \`bash -c '…'\`; ` +
      `or write the items literally.\n` +
      `And report the denominator: print \`examined=N\` beside any \`found=0\`, because ` +
      `a zero with no denominator cannot be told from a loop that never ran.`;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message }
    }));
    process.exit(0);
  } catch {
    process.exit(0); // never block the session
  }
});

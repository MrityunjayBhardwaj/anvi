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

// Exit paths are all silent-and-zero: a guard that breaks must never block a
// session. Mirrors the other PreToolUse guards.
const stdinTimeout = setTimeout(() => process.exit(0), 5000);

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
// `$@`/`$*`/`$argv` are arrays; a name the same command assigns as `name=(…)` is an
// array too. Everything else is assumed scalar, which is the common case for a value
// captured from `$(…)` — and the case all nine recorded instances were.
function isArrayLike(name, cmd) {
  if (name === '@' || name === '*' || name === 'argv') return true;
  return new RegExp(`\\b${name.replace(/[^A-Za-z0-9_]/g, '')}=\\(`).test(cmd);
}

// A bare parameter expansion — `$NAME` or `${NAME}` — that is not quoted, not a
// command substitution, and not array-like. `$(` is excluded by construction: the
// scan requires a name character (or `{`) after the `$`.
function bareScalarExpansions(text, offset, states, cmd) {
  const found = [];
  const re = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (states[offset + m.index] !== 0) continue;      // quoted → shell leaves it alone
    if (isArrayLike(m[1], cmd)) continue;              // arrays do split
    found.push(m[0]);
  }
  return found;
}

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
    const findings = [];

    // (1) `for NAME in <list>` — the nine-instance mechanism. The list ends at the
    // first `;`, newline, or `do`, whichever comes first.
    for (const m of cmd.matchAll(/\bfor\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s/g)) {
      const start = m.index + m[0].length;
      const rest = cmd.slice(start);
      const end = rest.search(/;|\n|\bdo\b/);
      const list = end === -1 ? rest : rest.slice(0, end);
      const bare = bareScalarExpansions(list, start, states, cmd);
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
      const bare = bareScalarExpansions(list, start, states, cmd);
      if (bare.length) {
        findings.push(`\`set -- ${bare[0]}\` sets \$# to 1 here, so \$1…\$n never populate.`);
      }
    }

    // (3) `$var[` inside a double-quoted string is array SUBSCRIPTING, not
    // interpolation followed by a bracket: `"^## $pre[0-9]+"` becomes `"^## +"`.
    // Only inside double quotes — unquoted it would also glob, and single quotes are
    // literal. Bracing (`${pre}[0-9]`) is the fix for this one, unlike (1).
    for (const m of cmd.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\[/g)) {
      if (states[m.index] !== 2) continue;
      findings.push(`\`$${m[1]}[…]\` is parsed as an array subscript, not as \`$${m[1]}\` ` +
                    `followed by \`[…]\` — the pattern silently becomes something else. ` +
                    `Brace it: \`\${${m[1]}}[…]\`.`);
    }

    // (4) A glob character reaching a flag's value unquoted. zsh expands it against
    // the cwd and, finding nothing, aborts the command under `nomatch` before the
    // program runs. Loud, so cheap — included because the near-miss it caused sat one
    // command away from a label asserting a conclusion.
    for (const m of cmd.matchAll(/(--?[A-Za-z][A-Za-z0-9-]*=)([^\s'"]*[*?][^\s'"]*)/g)) {
      if (states[m.index] !== 0) continue;
      findings.push(`\`${m[1]}${m[2]}\` is glob-expanded against the current directory; ` +
                    `with no match zsh aborts the command before it runs. Quote it: ` +
                    `\`${m[1]}'${m[2]}'\`.`);
    }

    if (!findings.length) process.exit(0);

    const message =
      `⚠ This shell rewrites part of this command before it runs (zsh, not bash):\n` +
      findings.map(f => `  • ${f}`).join('\n') +
      `\n\nWhy this is worth a line of text: nine instances of this class are ` +
      `catalogued, and almost every one failed toward the answer that required no ` +
      `action — a loop that runs once under-reports, so the gate says "nothing found".\n` +
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

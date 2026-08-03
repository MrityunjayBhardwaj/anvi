#!/usr/bin/env node
// debug-grounding-gate: UserPromptSubmit hook
//
// Detects debugging-shaped user messages and injects Ground Truth context
// BEFORE Claude starts thinking about the problem. This is the earliest
// enforcement point — it fires before any tool use, before any reasoning.
//
// What it does:
// 1. Scans user message for debugging keywords
// 2. If detected, reads project dharana for boundaries + Ground Truth inventory
// 3. Injects: "DEBUGGING DETECTED. Read these Ground Truth docs first: [list]"
//
// What it does NOT do:
// - Block the prompt (that would be too disruptive)
// - Fire on non-debugging messages (keyword gating)

const fs = require('fs');
const path = require('path');
const { resolveDirForRead, adoptSession } = require('./anvi-paths.js');

const stdinTimeout = setTimeout(() => process.exit(0), 5000);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    // A hook is a process per event, so the resolver dedupes its explanations
    // against a Set that is always empty unless it knows the session. Guarded:
    // an install whose resolver predates this export must degrade to
    // per-process, not die silently inside a hook — the catch below exits 0
    // either way, which would read as a hook with nothing to say.
    if (adoptSession) adoptSession(data.session_id);
    const cwd = data.cwd || process.cwd();
    // `prompt` is the field the harness actually sends on UserPromptSubmit. This
    // read used to name only `user_message`/`message` — fields no payload carries —
    // so the scan below ran on an empty string and this gate never fired once.
    // Nothing reported it: a hook whose only job is to inject a reminder dies
    // looking exactly like a hook with nothing to say. The older names are kept as
    // a fallback because they cost nothing and cover an older harness.
    const userMessage = (data.prompt || data.user_message || data.message || '').toLowerCase();

    // Debugging keyword detection
    const debugKeywords = [
      'fix', 'broken', 'bug', 'silent', 'failing', 'not working',
      'why isn\'t', 'why doesn\'t', 'why is it', 'debug', 'investigate',
      'wrong output', 'no sound', 'no audio', 'crash', 'error',
      'doesn\'t work', 'stopped working', 'regression',
    ];

    const isDebugging = debugKeywords.some(kw => userMessage.includes(kw));
    if (!isDebugging) process.exit(0);

    // Find project catalogues — shared resolver spans both layouts
    const anvi = resolveDirForRead(cwd, '.anvi');
    const anviDir = anvi.dir;

    // Find Ground Truth docs — shared resolver spans both layouts
    const ref = resolveDirForRead(cwd, 'ref');
    const refDir = ref.dir;
    let gtDocs = [];
    if (refDir) {
      gtDocs = fs.readdirSync(refDir)
        .filter(f => f.startsWith('GROUND_TRUTH_') && f.endsWith('.md'))
        .map(f => path.join(refDir, f)); // full path — unambiguous in either layout
    }

    // Read dharana for boundary context
    let boundaryContext = '';
    if (anviDir) {
      const dharanaPath = path.join(anviDir, 'dharana.md');
      if (fs.existsSync(dharanaPath)) {
        const dharana = fs.readFileSync(dharanaPath, 'utf8');

        // Extract boundary names and their REFs
        const boundaryRefs = [];
        const sections = dharana.split(/^### (B\d+)/m);
        for (let i = 1; i < sections.length; i += 2) {
          const id = sections[i];
          const content = (sections[i + 1] || '').split(/\n---\n|\n## \d/)[0];
          const titleMatch = content.match(/^[:\s](.+?)$/m);
          const title = titleMatch ? titleMatch[1].trim() : '';
          const refMatch = content.match(/\*\*REF:\*\*\s*(.+)/);
          const ref = refMatch ? refMatch[1].trim() : 'NO GROUND TRUTH';

          // Check for NOT YET IMPLEMENTED invariants at this boundary
          const hasUnimplemented = content.includes('NOT YET IMPLEMENTED');

          boundaryRefs.push({ id, title, ref, hasUnimplemented });
        }

        if (boundaryRefs.length > 0) {
          boundaryContext = '\n\nProject boundaries:\n' +
            boundaryRefs.map(b =>
              `  ${b.id}: ${b.title}${b.hasUnimplemented ? ' [HAS UNIMPLEMENTED INVARIANTS]' : ''}\n    → ${b.ref}`
            ).join('\n');
        }
      }

      // Check for MISALIGNED invariants
      const vyaptiPath = path.join(anviDir, 'vyapti.md');
      if (fs.existsSync(vyaptiPath)) {
        const vyapti = fs.readFileSync(vyaptiPath, 'utf8');
        // Entry IDs are per-project: some use a plain `V1`, others a prefix like
        // `SV1`. Hardcoding one project's prefix made this scan a silent no-op
        // everywhere else — the same "written against one project's shape and
        // assumed universal" mistake as the payload field above, and just as
        // invisible. Match any prefix, and gather both flags in one pass so a
        // MISALIGNED entry can't hide an unimplemented one.
        const misaligned = vyapti.match(/^##\s+[A-Z]{1,3}\d+:[^\n]*(?:MISALIGNED|NOT YET IMPLEMENTED)/gm);
        if (misaligned && misaligned.length > 0) {
          boundaryContext += '\n\nMisaligned/unimplemented invariants: ' +
            misaligned.map(m => m.replace(/^## /, '')).join('; ');
        }
      }
    }

    // Build the injection
    let message = 'DEBUGGING DETECTED. Ground Truth enforcement active.';
    message += '\n\nBEFORE forming any hypothesis:';
    message += '\n1. Read the relevant Ground Truth doc for the affected system boundary';
    message += '\n2. Cite file:line for your hypothesis (or state UNGROUNDED)';
    message += '\n3. Write experiment protocol BEFORE running diagnostic tools';

    if (gtDocs.length > 0) {
      message += '\n\nGround Truth docs available:';
      for (const doc of gtDocs) {
        message += `\n  - ${doc}`;
      }
    } else if (ref.refused || anvi.refused) {
      // Emphatically NOT "none found, run /anvi:ground". That command creates
      // ref/sources/ under the store project this directory's NAME selects —
      // the write the refusal exists to stop. Advising it here would walk the
      // reader around the guard while sounding helpful, and this is the channel
      // the reader acts on: the true reason goes to stderr, which nothing reads.
      //
      // Keyed on ANY refusal, not on `ref` alone. The danger is not whether a
      // reference directory happens to exist — it is whether this caller may
      // write to that store project at all, and a refusal on any kind already
      // answers that no. Observed against the real store, where the project has
      // catalogues and no ref/ yet: the narrower test read NONE for `ref`, took
      // the honest-absence branch, and printed the advice verbatim to a caller
      // that had just been refused. A more precise condition that answers on a
      // smaller domain is a regression everywhere the coarse one reached, and
      // the lost cases land on the permissive side.
      message += ref.refused
        ? `\n\nGround Truth docs are NOT BEING SERVED here — ${ref.notice}`
        : '\n\nNo Ground Truth docs are readable here, and whether any exist is UNKNOWN — ' +
          'this directory was refused the store project its name selects.';
      message += '\nDo NOT run /anvi:ground to resolve this: it writes into the store project ' +
        'this directory just failed to prove it owns. Fix the binding first.';
    } else {
      message += '\n\nNO Ground Truth docs found. Consider running /anvi:ground first.';
    }

    if (anvi.refused) {
      // Same distinction one kind over: no boundary block below could mean the
      // project has no dharana, or that it has one and is being refused it.
      //
      // Both kinds address the store project selected by the SAME basename and
      // are judged against the same caller, so when both are refused the reason
      // and the remedy are identical and only the quoted kind differs. Printing
      // the full sentence twice costs ~350 characters of injected context to say
      // one thing — so state the second kind and point at the reason already
      // given. Guarded on the states actually matching rather than on the
      // reasoning above being true forever.
      message += (ref.refused && ref.state === anvi.state)
        ? '\n\nProject boundaries are NOT BEING SERVED here either — same refusal, same remedy.'
        : `\n\nProject boundaries are NOT BEING SERVED here — ${anvi.notice}`;
    }

    message += boundaryContext;

    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: message
      }
    };
    process.stdout.write(JSON.stringify(output));
  } catch (e) {
    process.exit(0);
  }
});

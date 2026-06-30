#!/usr/bin/env node
// debug-grounding-gate: PrePromptSubmit hook (user_prompt_submit_hook)
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

const stdinTimeout = setTimeout(() => process.exit(0), 5000);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const cwd = data.cwd || process.cwd();
    const userMessage = (data.user_message || data.message || '').toLowerCase();

    // Debugging keyword detection
    const debugKeywords = [
      'fix', 'broken', 'bug', 'silent', 'failing', 'not working',
      'why isn\'t', 'why doesn\'t', 'why is it', 'debug', 'investigate',
      'wrong output', 'no sound', 'no audio', 'crash', 'error',
      'doesn\'t work', 'stopped working', 'regression',
    ];

    const isDebugging = debugKeywords.some(kw => userMessage.includes(kw));
    if (!isDebugging) process.exit(0);

    // Find project catalogues
    let anviDir = null;
    for (const candidate of [
      path.join(cwd, '.anvi'),
      path.join(cwd, 'artifacts', '.anvi'),
    ]) {
      if (fs.existsSync(candidate)) {
        anviDir = candidate;
        break;
      }
    }

    // Find Ground Truth docs
    const refDir = path.join(cwd, 'artifacts', 'ref');
    let gtDocs = [];
    if (fs.existsSync(refDir)) {
      gtDocs = fs.readdirSync(refDir)
        .filter(f => f.startsWith('GROUND_TRUTH_') && f.endsWith('.md'))
        .map(f => `artifacts/ref/${f}`);
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
        const misaligned = vyapti.match(/## (SV\d+):[^\n]*MISALIGNED/g) ||
                           vyapti.match(/## (SV\d+):[^\n]*NOT YET IMPLEMENTED/g);
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
    } else {
      message += '\n\nNO Ground Truth docs found. Consider running /anvi:ground first.';
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

#!/usr/bin/env node
// experiment-protocol-guard: PreToolUse hook for Bash
//
// Enforces: before running a diagnostic tool (tools/diagnose-*, tools/*test*,
// tools/*prophet*, tools/capture.ts, tools/raw-osc-*), an experiment protocol
// file must exist at artifacts/investigations/exp-*.md with:
//   - Hypothesis (written BEFORE the experiment)
//   - Predicted outcome (written BEFORE the experiment)
//
// If no protocol exists, injects a reminder (does not block — blocking Bash
// is too disruptive for general use). The reminder includes which Ground Truth
// docs are relevant.

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
    const toolInput = data.tool_input || {};
    const command = toolInput.command || '';

    // Only trigger for diagnostic tool execution
    const diagnosticPatterns = [
      /tools\/diagnose/,
      /tools\/capture/,
      /tools\/raw-osc/,
      /tools\/.*prophet/,
      /tools\/.*test/,
      /tools\/spectrogram/,
      /tools\/engine-vs-raw/,
      /tools\/measure-coldstart/,
      /tools\/audioworklet-process/,
    ];

    const isDiagnostic = diagnosticPatterns.some(p => p.test(command));
    if (!isDiagnostic) process.exit(0);

    // Check for experiment protocol files
    const investigationsDir = path.join(cwd, 'artifacts', 'investigations');
    let protocols = [];
    if (fs.existsSync(investigationsDir)) {
      protocols = fs.readdirSync(investigationsDir)
        .filter(f => f.startsWith('exp-') && f.endsWith('.md'))
        .sort()
        .reverse();
    }

    // Check if the most recent protocol has hypothesis + prediction
    let hasGroundedProtocol = false;
    let latestProtocol = null;
    if (protocols.length > 0) {
      latestProtocol = protocols[0];
      const content = fs.readFileSync(
        path.join(investigationsDir, latestProtocol), 'utf8'
      );
      // Check for required fields
      const hasHypothesis = /##\s*Hypothesis/i.test(content) &&
                           !/\[TODO\]|\[fill in\]|TBD/i.test(content.match(/##\s*Hypothesis[\s\S]*?(?=##|$)/)?.[0] || '');
      const hasPrediction = /##\s*Predicted Outcome/i.test(content) &&
                            !/\[TODO\]|\[fill in\]|TBD/i.test(content.match(/##\s*Predicted Outcome[\s\S]*?(?=##|$)/)?.[0] || '');
      const hasSourceBasis = /##\s*Source Code Basis/i.test(content);

      hasGroundedProtocol = hasHypothesis && hasPrediction;
    }

    if (hasGroundedProtocol) process.exit(0); // Protocol exists and is filled in

    // Build reminder message
    let message = 'EXPERIMENT PROTOCOL: Running a diagnostic tool without a grounded experiment protocol.';

    if (latestProtocol) {
      message += ` Latest protocol (${latestProtocol}) is missing hypothesis or predicted outcome.`;
    } else {
      message += ' No experiment protocol found at artifacts/investigations/exp-*.md.';
    }

    message += '\n\nBefore running experiments:';
    message += '\n1. Create artifacts/investigations/exp-NNN.md (use EXPERIMENT_TEMPLATE.md)';
    message += '\n2. Write the HYPOTHESIS with file:line citation from Ground Truth';
    message += '\n3. Write the PREDICTED OUTCOME before running';
    message += '\n4. THEN run the diagnostic tool';

    // Find Ground Truth docs for context
    const refDir = path.join(cwd, 'artifacts', 'ref');
    if (fs.existsSync(refDir)) {
      const gtDocs = fs.readdirSync(refDir)
        .filter(f => f.startsWith('GROUND_TRUTH_') && f.endsWith('.md'));
      if (gtDocs.length > 0) {
        message += '\n\nGround Truth docs available: ' + gtDocs.join(', ');
      }
    }

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: message
      }
    };
    process.stdout.write(JSON.stringify(output));
  } catch (e) {
    process.exit(0);
  }
});

#!/usr/bin/env node
// anvi-route-logger: PostToolUse hook for Read
//
// Detects when Claude reads Anvi cognitive OS spec files (context routing).
// Logs to /tmp/anvi-route-{session_id}.log for AnviDeck real-time dashboard.
//
// Fires on every Read tool call. Exits immediately if the file isn't a
// known spec file. Lightweight: parse stdin, string match, exit.

const fs = require('fs');
const path = require('path');

// Spec file → category mapping
const SPEC_FILES = {
  'adaptive-observation.md': { category: 'diagnose', tier: 3 },
  'diagnose.md': { category: 'diagnose', tier: 3 },
  'design.md': { category: 'design', tier: 3 },
  'review.md': { category: 'review', tier: 3 },
  'recover.md': { category: 'recover', tier: 3 },
  'base-layer.md': { category: 'always', tier: 1 },
  'context-rot.md': { category: 'diagnose', tier: 3 },
  'translation.md': { category: 'translate', tier: 3 },
  'dharana-spec.md': { category: 'plan', tier: 3 },
  'dhyana-spec.md': { category: 'implement', tier: 3 },
  // Project-level catalogues
  'hetvabhasa.md': { category: 'diagnose', tier: 2 },
  'vyapti.md': { category: 'implement', tier: 2 },
  'krama.md': { category: 'implement', tier: 2 },
  'dharana.md': { category: 'implement', tier: 2 },
};

// Only match files under ~/.claude/anvi/ or .anvi/ directories
function isAnviSpecFile(filePath) {
  if (!filePath) return null;
  const basename = path.basename(filePath);
  const spec = SPEC_FILES[basename];
  if (!spec) return null;

  // Must be in an anvi-related directory
  if (filePath.includes('.claude/anvi/') || filePath.includes('.anvi/')) {
    return { file: basename, ...spec };
  }
  return null;
}

const stdinTimeout = setTimeout(() => process.exit(0), 5000);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const filePath = (data.tool_input && data.tool_input.file_path) || '';
    const sessionId = data.session_id || 'unknown';

    const match = isAnviSpecFile(filePath);
    if (!match) process.exit(0);

    const logEntry = JSON.stringify({
      ts: new Date().toISOString(),
      sid: sessionId,
      file: match.file,
      category: match.category,
      tier: match.tier
    });

    fs.appendFileSync(
      path.join('/tmp', `anvi-route-${sessionId}.log`),
      logEntry + '\n'
    );
  } catch (_) {
    // Silent fail — never block tool execution
  }
  process.exit(0);
});

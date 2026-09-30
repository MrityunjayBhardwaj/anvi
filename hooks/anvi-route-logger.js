#!/usr/bin/env node
// anvi-route-logger: PostToolUse hook for Read
//
// Detects when Claude reads Anvi cognitive OS spec files (context routing).
// Logs to /tmp/anvi-route-{session_id}.log for AnviDeck real-time dashboard.
//
// Also records which commands are used (#527 step 6). A skill reaches its workflow by
// reading ~/.claude/anvi/workflows/<name>.md, so each such Read is one row naming the
// workflow. It is a PROXY: a read is not a completed run, and a long workflow read in
// parts is several reads. The same file read through a checkout or worktree is
// development, not a command, and is not recorded. These rows feed the removal of
// unused commands over a 60-day window, so they go beside the meter's rows (durable,
// machine-local), not to /tmp, which the OS clears.
//
// Fires on every Read tool call. Exits immediately if the file is neither a
// known spec file nor an installed workflow. Lightweight: parse stdin, string match, exit.

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

// Only a top-level markdown file directly under the installed workflows directory.
const WORKFLOW_READ = /\/\.claude\/anvi\/workflows\/([a-z0-9][a-z0-9-]*)\.md$/;
function workflowOf(filePath) {
  const m = WORKFLOW_READ.exec(filePath || '');
  return m ? m[1] : null;
}

// What this run costs, one row per run (#527). Guarded like any shared module: a
// missing meter on a skewed install must cost the measurement, never the hook.
let meter = null;
try { meter = require('./hook-meter.js'); meter.start('anvi-route-logger.js', 'PostToolUse'); } catch (_) { meter = null; }
const stdinTimeout = setTimeout(() => process.exit(0), 5000);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    if (meter) meter.session(data.session_id);
    const filePath = (data.tool_input && data.tool_input.file_path) || '';
    const sessionId = data.session_id || 'unknown';

    const workflow = workflowOf(filePath);
    const match = workflow ? null : isAnviSpecFile(filePath);
    if (!match && !workflow) process.exit(0);

    const ts = new Date().toISOString();
    // The id becomes a filename; an unusable one must not steer the write out of /tmp (#591).
    // One rule for both logs — the meter's. Without the meter (a skewed install) every id
    // is treated as unusable rather than trusted.
    const name = meter ? meter.fileFor(sessionId).replace(/\.jsonl$/, '') : 'no-session';
    const logEntry = JSON.stringify(workflow
      ? { ts, sid: sessionId, file: `${workflow}.md`, category: 'workflow', workflow }
      : { ts, sid: sessionId, file: match.file, category: match.category, tier: match.tier });

    if (workflow && meter) {
      try {
        const dir = meter.workflowReadsDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, meter.fileFor(sessionId)), JSON.stringify({ ts, sid: sessionId, workflow }) + '\n');
      } catch (_) { /* the dashboard line below still gets written */ }
    }

    fs.appendFileSync(
      path.join('/tmp', `anvi-route-${name}.log`),
      logEntry + '\n'
    );
  } catch (_) {
    // Silent fail — never block tool execution
  }
  process.exit(0);
});

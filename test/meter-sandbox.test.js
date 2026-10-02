#!/usr/bin/env node
// Every test file keeps its meter rows out of the real meter directory (#597).
//
// The set of test files is DERIVED from the directory, so a new test cannot skip the
// sandbox by not being listed here. Two things are checked: that every file requires the
// sandbox before anything else, and — by running it — that the sandbox does what it says:
// a hook spawned from a process that required it writes its row into a temp directory,
// and the same hook spawned without it writes into `$CLAUDE_DIR/anvi-meter`.
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const TEST_DIR = __dirname;
const REQUIRE_LINE = "require('./meter-sandbox');";
const files = fs.readdirSync(TEST_DIR).filter(f => f.endsWith('.test.js')).sort();

console.log('\nEVERY TEST FILE REQUIRES THE SANDBOX FIRST:');
{
  // "First" = before any other require, so nothing can spawn a hook ahead of it.
  const firstRequire = text => (text.split('\n').find(l => /\brequire\(/.test(l) && !/^\s*(\/\/|\*)/.test(l)) || '').trim();
  const missing = files.filter(f => firstRequire(fs.readFileSync(path.join(TEST_DIR, f), 'utf8')) !== REQUIRE_LINE);
  ok(files.length >= 100, `the test files were found (${files.length})`);
  ok(missing.length === 0, `${files.length - missing.length} of ${files.length} test files require the sandbox before anything else${missing.length ? ' — missing: ' + missing.join(', ') : ''}`);
  const probe = "'use strict';\nconst fs = require('fs');\nrequire('./meter-sandbox');\n";
  ok(firstRequire(probe) !== REQUIRE_LINE, 'a file that requires something else first is counted as missing');
  ok(firstRequire("// require('./meter-sandbox');\n'use strict';\nconst a = require('a');\n") !== REQUIRE_LINE, 'a commented-out require does not count');
}

console.log('\nWHAT THE SANDBOX DOES, OBSERVED:');
{
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-meter-sandbox-')));
  const claude = path.join(scratch, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  const meter = path.join(__dirname, '..', 'hooks', 'hook-meter.js');
  const sandbox = path.join(__dirname, 'meter-sandbox.js');
  const real = path.join(claude, 'anvi-meter');
  const count = d => { try { return fs.readdirSync(d).filter(f => f.endsWith('.jsonl')).length; } catch { return 0; } };
  // A child with no ANVI_METER_DIR and a scratch CLAUDE_DIR: where does the meter say a row goes?
  const env = { ...process.env, CLAUDE_DIR: claude, HOME: scratch };
  delete env.ANVI_METER_DIR;
  const where = withSandbox => spawnSync(process.execPath, ['-e', `
    ${withSandbox ? `require(${JSON.stringify(sandbox)});` : ''}
    const m = require(${JSON.stringify(meter)});
    process.stdout.write(m.meterDir(process.env));
  `], { encoding: 'utf8', env });
  const bare = where(false), boxed = where(true);
  ok(bare.status === 0 && bare.stdout === real, `without the sandbox a row goes to $CLAUDE_DIR/anvi-meter (got ${bare.stdout || bare.stderr.trim().split('\n').pop()})`);
  ok(boxed.status === 0 && boxed.stdout !== real && /anvi-test-meter-/.test(boxed.stdout),
     `with it, a row goes to a temp directory (got ${boxed.stdout || boxed.stderr.trim().split('\n').pop()})`);
  ok(count(real) === 0, 'and nothing was written under the scratch Claude directory');
  const chosen = path.join(scratch, 'chosen');
  const kept = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(sandbox)}); process.stdout.write(process.env.ANVI_METER_DIR);`],
    { encoding: 'utf8', env: { ...env, ANVI_METER_DIR: chosen } });
  ok(kept.stdout === chosen, 'a directory the caller already chose is left alone — the runner\'s still wins');
  const gone = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(sandbox)}); process.stdout.write(process.env.ANVI_METER_DIR);`], { encoding: 'utf8', env });
  ok(gone.stdout && !fs.existsSync(gone.stdout), 'the temp directory is removed when the test process exits');
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

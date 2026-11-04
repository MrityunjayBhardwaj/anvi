// coexecution-vitest-setup.mjs — per-test coverage for scripts/coexecution.js (#713).
//
// A vitest setup file. It starts the JavaScript engine's precise coverage (node:inspector) in the test worker and takes it around every
// test: each take RESETS the engine's counters, so a "test" bucket holds exactly the functions that ran in
// that test case (its beforeEach/afterEach included), and "between" buckets hold module loading,
// beforeAll work and what ran after the last test. One JSON record per test file, the shape
// scripts/coexecution.js reads. Only scripts under COEXEC_ROOT are kept.
//
// Anvi installs no dependency for this: it runs inside the PROJECT's vitest. It is not run by
// anvi's own suite (anvi has no vitest); the stave observation of #713 is its run.
//
// RUN IT ON A COPY, NEVER ON A LIVE CHECKOUT. The project being measured is read-only to anvi:
//   1. copy the package source (e.g. `git archive <ref> packages/<pkg>`) into a scratch dir S;
//   2. give the copy a node_modules of absolute symlinks to an installed checkout's packages;
//   3. copy this file into the copy, and add a config there that merges the package's own:
//        mergeConfig(base, { cacheDir: `${S}/cache/vite`, test: { setupFiles: ['./coexecution-vitest-setup.mjs'] } })
//   4. run with every writable location pointed into S:
//        TMPDIR=$S/tmp COEXEC_OUT=$S/cov COEXEC_ROOT=$S/<pkg>/src/ node <copy>/node_modules/vitest/vitest.mjs run --config <that config>
//      (TMPDIR catches node's compile cache; cacheDir catches vite's; COEXEC_OUT is ours);
//   5. touch a marker before the run and prove afterwards that `find <installed checkout> -newer
//      <marker> -not -path '*/.git/*'` prints nothing.
import { Session } from 'node:inspector/promises'
import { writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { beforeEach, afterEach, afterAll, expect } from 'vitest'

const OUT = process.env.COEXEC_OUT
const ROOT = process.env.COEXEC_ROOT // absolute src dir; only scripts under it are kept
if (!OUT || !ROOT) throw new Error('coexec-setup: COEXEC_OUT and COEXEC_ROOT must be set')
mkdirSync(OUT, { recursive: true })

const session = new Session()
session.connect()
await session.post('Profiler.enable')
await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
// Discard what ran before this test file (setup, the runner, a previous file in a reused worker).
await session.post('Profiler.takePreciseCoverage')

const norm = u => { let s = String(u || ''); if (s.startsWith('file://')) s = decodeURIComponent(new URL(s).pathname); return s.replace(/[?#].*$/, '') }
async function take() {
  const { result } = await session.post('Profiler.takePreciseCoverage')
  const files = {}
  for (const sc of result) {
    const url = norm(sc.url)
    if (!url.startsWith(ROOT)) continue
    // functions[0] is the script itself; for a vite-runner module functions[1] is the module body
    // wrapper. Record every function that ran, by name and start offset, so the reader decides.
    const ran = sc.functions.filter(f => f.ranges[0] && f.ranges[0].count > 0).map(f => [f.functionName, f.ranges[0].startOffset, f.ranges[0].endOffset, f.ranges[0].count])
    if (!ran.length) continue
    const prev = files[url] || []
    files[url] = prev.concat(ran)
  }
  return files
}

const buckets = []
let testFile = null
beforeEach(async (ctx) => {
  testFile = ctx.task.file && ctx.task.file.filepath
  buckets.push({ name: '(before)', kind: 'between', files: await take() })
})
afterEach(async (ctx) => {
  const names = []; for (let t = ctx.task; t && t.type !== 'file'; t = t.suite) if (t.name) names.unshift(t.name)
  buckets.push({ name: ctx.task.fullName || names.join(' > '), kind: 'test', state: ctx.task.result && ctx.task.result.state, files: await take() })
})
afterAll(async () => {
  const f = testFile || expect.getState().testPath || 'unknown'
  buckets.push({ name: '(after)', kind: 'between', files: await take() })
  const id = createHash('sha256').update(f).digest('hex').slice(0, 16)
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify({ testFile: f, pid: process.pid, buckets }))
})

'use strict';
// warrant-rows — the licence table, as data.
//
// A licence row says: "a claim of THIS kind is licensed by THIS observation."
// The hook that consumes it (`absent-warrant-check.js`) contains no knowledge of
// any particular claim; it walks this array. Adding a fourth row is an edit to
// this file alone, and removing one must silence exactly its own case — which is
// how the rows are falsified.
//
// WHY THIS IS A `.js` AND NOT A `.json`. `install.sh` ships hooks by globbing
// `hooks/*.js`. A `.json` sitting beside them would be absent from every copy
// install, the `require` would throw, the hook's blanket catch would swallow it,
// and the feature would be silently off — the exact defect class this repo
// catalogues (infrastructure referenced by docs and never shipped by the
// installer). The rows are still data: declarative objects with no control flow,
// consumed by a loop.
//
// THE ROWS ARE MATCHED STRUCTURALLY, NEVER BY TOKEN OVERLAP between the claim's
// words and the observation's words. A similarity score cannot tell a statement
// from its inverse — measured on a borrowed harness, an exact inverse scored a
// perfect match — so every `licensed` predicate below asks about the SHAPE of the
// turn (was there a run? did it precede the claim? was its output more than a
// status?) and never about how much text the claim and the evidence share.

// Output that is a STATUS rather than an observation. Reading `0` is not reading
// what the command said, and the whole `verified` row exists for that distinction.
const STATUS_ONLY = [
  /^\s*$/,
  /^\s*\(?(?:bash\s+)?(?:command\s+)?(?:completed\s+)?with no output\)?\s*$/i,
  /^\s*\(no output\)\s*$/i,
  /^\s*(?:0|1|ok|okay|done|true|false|yes|no|pass|passed|fail|failed)\s*$/i,
  /^\s*(?:exit|rc|status)\s*[=:]?\s*\d+\s*$/i,
];

function isStatusOnly(text) {
  return STATUS_ONLY.some((re) => re.test(String(text)));
}

// Tools whose result is an observation of the world rather than a report of our
// own writing. `Write` and `Edit` return a confirmation of what we just asked
// for; believing those is believing ourselves.
const OBSERVING_TOOLS = new Set(['Bash', 'BashOutput', 'Read', 'Grep', 'Glob', 'NotebookRead']);

// A command shaped like a search — the population an absence claim comes from.
const SEARCH_COMMAND = /\b(?:grep|rg|ag|ack|find|ls|fd)\b/;

// A command shaped like a test run.
const TEST_COMMAND =
  /\b(?:npm|yarn|pnpm)\s+(?:run\s+)?test|\bvitest\b|\bjest\b|\bpytest\b|\bcargo\s+test\b|\bgo\s+test\b|\bnpm\s+t\b|run-all-tests|\btest\/\S+\.test\.\w+/i;

// A denominator stated in prose: the count the zero was drawn from.
const DENOMINATOR = [
  /\bexamined\s*[=:]?\s*\d+/i,
  /\bdenominator\b/i,
  /\bout of\s+\d+\b/i,
  /\bof\s+\d+\s+(?:files?|entries|records?|lines?|candidates?|projects?|hooks?|tests?)\b/i,
  /\b\d+\s+(?:files?|entries|records?|lines?|candidates?)\s+(?:examined|scanned|searched|checked)\b/i,
];

// A prediction of what should go red, stated in prose.
const PREDICTION = [
  /\bpredict(?:s|ed|ion|ions)?\b/i,
  /\bshould\s+(?:go\s+)?red\b/i,
  /\bshould\s+(?:now\s+)?fail\b/i,
  /\bexpect(?:ed|ing)?\s+(?:\S+\s+){0,4}(?:to\s+)?(?:go\s+)?(?:red|fail)/i,
  /\bmust\s+redden\b/i,
  /\bexpected\s+red\b/i,
];

const ROWS = [
  {
    kind: 'verified',
    // Detection is deliberately narrow: an assertion that a thing was CHECKED and
    // holds. "I will verify" is a plan, not a claim, so the future forms are excluded
    // by requiring the assertive shapes below rather than the bare stem.
    claim: [
      /\bverified\b/i,
      /\bconfirmed\b/i,
      /\bit(?:'s| is)\s+fixed\b/i,
      /\b(?:now\s+works|works\s+now)\b/i,
      /\bconfirmed\s+working\b/i,
    ],
    required: 'a run whose OUTPUT was read — an exit status is not an observation',
    searched: 'observation-bearing tool results in the turn carrying more than a status',
    // Licensed by the SHAPE of the turn: at least one observing tool returned
    // something that is not a bare status.
    licensed: (turn) => turn.events.some(
      (e) => e.kind === 'result' && OBSERVING_TOOLS.has(e.name) && !isStatusOnly(e.text),
    ),
    question:
      'You reported something as verified. Which run\'s OUTPUT did you read to establish that — '
      + 'and if what you read was an exit status, what would a wrong result have looked like in it?',
  },

  {
    kind: 'absence',
    claim: [
      /\bno\s+(?:results?|matches?|hits?|instances?|occurrences?|consumers?|callers?|references?|entries)\b/i,
      /\bnothing\s+(?:matches|matched|found|there)\b/i,
      /\bnone\s+(?:found|matched|exist)\b/i,
      /\b(?:0|zero)\s+(?:results?|matches?|hits?|instances?|occurrences?|consumers?|callers?|references?|entries|files?)\b/i,
      /\bnot\s+found\s+anywhere\b/i,
      /\bdoes\s+not\s+appear\s+anywhere\b/i,
    ],
    required: 'a positive control that must match, or the denominator the zero was drawn from',
    searched: 'a denominator stated in prose, or a sibling search in the turn that DID return something',
    // Two ways to license a zero, and both are structural. Either the turn states
    // what the zero was drawn from, or the turn ran a second search of the same
    // shape that came back non-empty — the control proving the instrument works.
    licensed: (turn) => {
      if (DENOMINATOR.some((re) => re.test(turn.prose))) return true;
      const searches = turn.events.filter(
        (e) => e.kind === 'result' && e.searchShaped,
      );
      return searches.length >= 2 && searches.some((e) => !isStatusOnly(e.text));
    },
    question:
      'You reported a zero. What was the denominator it was drawn from, and which control term — '
      + 'one you know is present — did you search for to prove the instrument was looking?',
  },

  {
    kind: 'suite',
    // ⚠ RECORDED, NOT ASKED — and the reason is a measurement, not a preference.
    //
    // This row fires on 81 of the 83 claims it detects across 807 real turns. A row
    // that fires on 98% of what it sees carries almost no information: it is not a
    // check, it is a constant, and a constant that speaks every time is the fastest
    // way to teach a reader to stop reading.
    //
    // The cause is known and is POSITIONAL rather than semantic. Of those turns, 45
    // pair a prediction with a test run and only 8 have the prediction in a text
    // block earlier than the run — predictions are usually written up after the run,
    // stated in the previous turn, or made while thinking, which this reader excludes
    // by design. So the row is right about what licenses a green suite and wrong
    // about where the licence is allowed to sit.
    //
    // Until that is repaired, asking would spend the mechanism's whole credibility on
    // the one row we already believe is mis-specified — and the trial measures whether
    // people ACT on the questions, so noise from a known defect would return "ignored"
    // for a reason that has nothing to do with the hypothesis. Staying silent keeps the
    // row measuring: it still detects, still writes an instance record, and its figures
    // still accumulate for the repair.
    silent: true,
    claim: [
      /\b(?:tests?|suite|everything|all)\s+(?:are\s+|is\s+)?(?:still\s+)?green\b/i,
      /\bgreen\s+(?:across the board|everywhere)\b/i,
      /\ball\s+tests?\s+pass(?:ing|ed|es)?\b/i,
      /\btests?\s+pass(?:ing|ed|es)?\b/i,
      /\bsuite\s+pass(?:ing|ed|es)?\b/i,
      /\bfull\s+suite\s+green\b/i,
    ],
    required: 'a predicted red, stated BEFORE the run',
    searched: 'a prediction in prose at a position earlier in the turn than the test run',
    // The ONLY row whose licence is about ORDER, and the order is what makes it a
    // prediction rather than a rationalisation. A green suite after a behavioural
    // change is a question until something was named that should have reddened.
    licensed: (turn) => {
      const run = turn.events.find((e) => e.kind === 'call' && TEST_COMMAND.test(e.text));
      if (!run) return false; // a green claimed with no run in the turn is never licensed
      return turn.events.some(
        (e) => e.kind === 'text' && e.i < run.i && PREDICTION.some((re) => re.test(e.text)),
      );
    },
    question:
      'You reported the suite green after changing behaviour. Which assertion did you predict '
      + 'would go red before the run — and did it?',
  },
];

module.exports = {
  ROWS,
  isStatusOnly,
  OBSERVING_TOOLS,
  SEARCH_COMMAND,
  TEST_COMMAND,
  DENOMINATOR,
  PREDICTION,
};

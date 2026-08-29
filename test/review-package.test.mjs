import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectPackage,
  diffLines,
  loadReviewPackage,
  renderReviewPackage,
  revision,
} from '../src/render-review-package.mjs';

const INSTRUCTIONS = 'Decide whether the change breaks behaviour a caller can observe.';

/** the shape a passing attempt has on disk, with only the fields a test cares about set */
function attempt({ attempt: n = 1, step = n, passed = false, testFile = 'a\nb\n', mutant, pristine }) {
  return {
    type: 'gate-attempt',
    step,
    attempt: n,
    of: 4,
    passed,
    path: 'proof-test.js',
    command: './node_modules/.bin/mocha proof-test.js',
    testFile,
    mutant: mutant ?? { code: passed ? 1 : 0, ms: 140, tail: 'changed tail' },
    pristine: pristine ?? { code: 0, ms: 139, tail: 'original tail' },
  };
}

/** a stage-1 run: one run-start, one step per attempt, a gate-outcome after run-end */
function stageOne({ attempts = [], result = null, resolution = 'proved' } = {}) {
  const events = [
    { type: 'run-start', caseId: 'ms-70', model: 'test-model', instructions: INSTRUCTIONS, tools: ['submit-proof'], maxSteps: 10 },
  ];
  attempts.forEach((a) => {
    events.push({ type: 'step', step: a.step, text: `working on attempt ${a.attempt}`, toolCalls: [] });
    events.push(a);
    events.push({ type: 'tool-result', step: a.step, name: 'submit-proof', ok: true, result: 'gate replied', ms: 300 });
  });
  events.push({ type: 'run-end', result, stopReason: 'final', error: null, usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12, costUsd: 0.001 }, steps: attempts.length, wallMs: 4000 });
  events.push({ type: 'gate-outcome', resolution, attempts: attempts.length });
  return events.map((event, seq) => ({ seq, t: '2026-08-29T12:00:00.000Z', ...event }));
}

const PROVED_ANSWER = '```json\n{"defect": true, "testFile": {"path": "proof-test.js", "content": "x"}, "note": "years fall through to weeks"}\n```';

test('diffLines marks what went, what came and what stayed', () => {
  const lines = diffLines('one\ntwo\nthree\n', 'one\ntwo point five\nthree\n');
  assert.deepEqual(
    lines.map((l) => l.sign),
    [' ', '-', '+', ' ', ' '],
  );
  assert.equal(lines[1].text, 'two');
  assert.equal(lines[2].text, 'two point five');
});

test('a revision elides unchanged runs and counts what changed', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
  const after = ['a', 'b', 'c', 'd', 'CHANGED', 'f', 'g', 'h'].join('\n');
  const { lines, added, removed } = revision(before, after);

  assert.equal(added, 1);
  assert.equal(removed, 1);
  // two lines of context each side survive; the rest is one printed count, not a silent drop
  const elisions = lines.filter((l) => l.sign === '@');
  assert.equal(elisions.length, 2);
  assert.equal(elisions[0].text, '2 unchanged lines');
  assert.ok(!lines.some((l) => l.sign === ' ' && l.text === 'a'));
});

test('collects a stage-1 run: attempts in order, each keyed to its line of the file', () => {
  const events = stageOne({
    attempts: [attempt({ attempt: 1 }), attempt({ attempt: 2, passed: true })],
    result: PROVED_ANSWER,
  });
  const pkg = collectPackage({ events, caseId: 'ms-70' });

  assert.equal(pkg.attempts.length, 2);
  assert.equal(pkg.passed.attempt, 2);
  assert.equal(pkg.attempts[0].key, 'e02');
  assert.equal(pkg.attempts[1].key, 'e05');
  assert.equal(pkg.attempts[0].said, 'working on attempt 1');
  assert.equal(pkg.attempts[0].revision, null, 'the first attempt revises nothing');
  assert.equal(pkg.outcome.resolution, 'proved');
});

test('reads the verdict from the summary row, and falls back to the final answer without one', () => {
  const events = stageOne({ attempts: [attempt({ passed: true })], result: PROVED_ANSWER });

  const scored = collectPackage({
    events,
    caseId: 'ms-70',
    summary: {
      candidate: 'stage-1',
      model: 'test-model',
      cases: [{ id: 'ms-70', kind: 'buggy', outcome: 'proved', defect: true, note: 'from the scorer' }],
    },
  });
  assert.equal(scored.verdict.note, 'from the scorer');
  assert.equal(scored.verdict.from, 'summary.json');
  assert.equal(scored.candidate.name, 'stage-1');

  const bare = collectPackage({ events, caseId: 'ms-70' });
  assert.equal(bare.verdict.defect, true);
  assert.equal(bare.verdict.note, 'years fall through to weeks');
  assert.equal(bare.verdict.from, "the run's final answer");
});

test('a stage-2 file holds two runs: the ledger from the first, the attempts from the second', () => {
  const hypothesizer = [
    { type: 'run-start', caseId: 'ms-70', model: 'test-model', instructions: 'rank the defects', tools: [], maxSteps: 4 },
    { type: 'step', step: 1, text: 'thinking', toolCalls: [] },
    { type: 'run-end', result: 'ledger written', stopReason: 'final', error: null, usage: {}, steps: 1, wallMs: 1000 },
    {
      type: 'ledger',
      entries: 1,
      source: 'tool',
      hypotheses: [{ rank: 1, claim: 'years parse as weeks', input: "ms('1y')", expected: '31557600000', observed: '604800000' }],
    },
  ];
  const events = [...hypothesizer, ...stageOne({ attempts: [attempt({ passed: true })], result: PROVED_ANSWER })].map(
    (event, index) => ({ ...event, key: undefined, seq: index }),
  );

  const pkg = collectPackage({ events, caseId: 'ms-70' });
  assert.equal(pkg.runs.length, 2);
  assert.equal(pkg.ledger.entries, 1);
  assert.equal(pkg.attempts.length, 1);
  // keyed by position in the file, so the second run's events do not collide with the first's
  assert.equal(pkg.attempts[0].key, 'e06');

  const html = renderReviewPackage(pkg);
  assert.match(html, /years parse as weeks/);
  assert.match(html, /ms\(&#39;1y&#39;\)/);
  assert.match(html, /run 1 of 2/);
});

test('an empty ledger is reported as the assertion it is, and a missing one as absent', () => {
  const events = [
    { type: 'run-start', caseId: 'bytes-12', model: 'm', instructions: INSTRUCTIONS, tools: [], maxSteps: 4 },
    { type: 'step', step: 1, text: 'nothing here', toolCalls: [] },
    { type: 'run-end', result: '{"defect": false, "note": "equivalent"}', stopReason: 'final', error: null, usage: {}, steps: 1, wallMs: 900 },
    { type: 'ledger', entries: 0, source: 'tool', hypotheses: [] },
    { type: 'gate-outcome', resolution: 'clean', attempts: 0 },
  ].map((event, seq) => ({ seq, t: '2026-08-29T13:22:05.704Z', ...event }));

  const empty = renderReviewPackage(collectPackage({ events, caseId: 'bytes-12' }));
  assert.match(empty, /The hypothesizer ranked nothing/);
  assert.match(empty, /No gate attempt was recorded/);

  const none = renderReviewPackage(
    collectPackage({ events: events.filter((e) => e.type !== 'ledger'), caseId: 'bytes-12' }),
  );
  assert.match(none, /No ledger was recorded/);
});

test('the proof renders only from a gate attempt that passed', () => {
  // a confident claim, four attempts, none of them passing: the page may not say it was proved
  const events = stageOne({
    attempts: [1, 2, 3, 4].map((n) => attempt({ attempt: n })),
    result: PROVED_ANSWER,
    resolution: 'withheld',
  });
  const html = renderReviewPackage(
    collectPackage({
      events,
      caseId: 'bytes-control-loop',
      summary: { cases: [{ id: 'bytes-control-loop', kind: 'control', outcome: 'no-verdict', defect: true, note: 'it formats differently' }] },
    }),
  );

  assert.match(html, /no gate attempt passed in this run/);
  assert.match(html, /Nothing on this page proves the claim/);
  assert.doesNotMatch(html, /Gate passed/);
  assert.doesNotMatch(html, /Proved by gate attempt/);
});

test('transport retries are counted where a reader cannot miss them', () => {
  const events = stageOne({ attempts: [attempt({ passed: true })], result: PROVED_ANSWER });
  events.splice(1, 0, { seq: 99, t: '2026-08-29T12:00:00.000Z', type: 'retry', step: 1, attempt: 1, delayMs: 500, reason: 'socket hang up', status: null });

  const pkg = collectPackage({ events, caseId: 'ms-70' });
  assert.equal(pkg.retries.length, 1);
  assert.match(renderReviewPackage(pkg), /1 transport retry was recorded/);
});

test('both runners are shown for every attempt, with their exit codes', () => {
  const events = stageOne({
    attempts: [
      attempt({ attempt: 1, mutant: { code: 1, ms: 12, tail: 'red on changed' }, pristine: { code: 1, ms: 13, tail: 'red on original' } }),
      attempt({ attempt: 2, passed: true, mutant: { code: 1, ms: 14, tail: 'the failure' }, pristine: { code: 0, ms: 15, tail: 'the pass' } }),
    ],
    result: PROVED_ANSWER,
  });
  const html = renderReviewPackage(collectPackage({ events, caseId: 'ms-70' }));

  ['red on changed', 'red on original', 'the failure', 'the pass'].forEach((tail) =>
    assert.match(html, new RegExp(tail)),
  );
  assert.match(html, /exit 1 &middot; failed/);
  assert.match(html, /exit 0 &middot; passed/);
  assert.match(html, /Gate passed &middot; exit 1\/0/);
});

test('the page is self-contained, escapes what the model wrote, and drops terminal escapes', () => {
  const events = stageOne({
    attempts: [
      attempt({
        passed: true,
        testFile: "assert.equal(render('<script>alert(1)</script>'), 'ok');\n",
        mutant: { code: 1, ms: 20, tail: '\u001b[31m-604800000\u001b[0m expected \u001b[32m+31557600000\u001b[0m' },
      }),
    ],
    result: PROVED_ANSWER,
  });
  const html = renderReviewPackage(collectPackage({ events, caseId: 'ms-70' }));

  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;alert\(1\)/);
  assert.doesNotMatch(html, /\u001b/);
  // the tail is broken to the half-measure the two runner sheets sit in, so the numbers are
  // asserted on their own rather than as one line
  assert.match(html, /-604800000/);
  assert.match(html, /\+31557600000/);
});

test('renders a real run from disk: three attempts, the third one proving it', () => {
  const pkg = loadReviewPackage('runs/stage1-flash-rep1', 'js-yaml-18');

  assert.equal(pkg.attempts.length, 3);
  assert.equal(pkg.passed.attempt, 3);
  assert.equal(pkg.attempts[1].revision.added, 3, 'the second attempt rewrote three lines');
  assert.equal(pkg.caseRecord.kind, 'buggy');
  assert.match(pkg.diff, /YAML_INTEGER_EXPLICIT_PATTERN/);

  const html = renderReviewPackage(pkg);
  assert.match(html, /Review package &middot; stage1-flash-rep1/);
  assert.match(html, /proved on gate attempt 3 of 4/);
  // the corpus's own record of the case is on the page, and marked as what the agent never saw
  assert.match(html, /Ground truth &middot; not shown to the agent/);
  assert.match(html, /load\(&#39;a: !!int 0o17&#39;\)/);
});

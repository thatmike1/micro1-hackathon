import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildScoreboard, formatScoreboard, parseArgs, reconcile } from './scoreboard.mjs';
import { renderScoreboardPage } from './scoreboard-page.mjs';
import { parseSummary, readSummary } from './summary-format.mjs';

/* ---------------------------------------------------------------------------------------------
   fixtures: a summary of each recorded generation, built from one shape so a test says which
   field it moved rather than restating the whole file
   --------------------------------------------------------------------------------------------- */

const USAGE = { promptTokens: 100, completionTokens: 20, totalTokens: 120, costUsd: 0.001 };

/** @param {string} id @param {string} kind @param {string} outcome */
function scoredCase(id, kind, outcome) {
  return {
    id,
    kind,
    library: 'ms',
    category: 'boundary',
    outcome,
    defect: outcome === 'proved' || outcome === 'false-alarm',
    note: '',
    error: null,
    proof: null,
    usage: USAGE,
    wallMs: 1000,
  };
}

/**
 * @param {object} options
 * @param {number} options.generation which recorded shape to write
 * @param {string[]} options.outcomes one outcome per buggy case, then the controls
 */
function summaryOf({ generation = 2, buggy = ['proved'], controls = ['correct'], model = 'm' } = {}) {
  const cases = [
    ...buggy.map((outcome, i) => scoredCase(`bug-${i}`, 'buggy', outcome)),
    ...controls.map((outcome, i) => scoredCase(`ctl-${i}`, 'control', outcome)),
  ];
  const summary = {
    candidate: 'stage-1',
    description: 'a candidate',
    model,
    startedAt: '2026-08-29T12:00:00.000Z',
    finishedAt: '2026-08-29T12:01:00.000Z',
    wallMs: 60000,
    totals: totalsOf(cases),
    cases,
  };
  if (generation >= 2) summary.requestExtras = { max_tokens: 4096 };
  if (generation >= 3) {
    summary.candidateOptions = { memory: 'off' };
    summary.concurrency = 1;
    summary.order = cases.map((c) => c.id);
  }
  return summary;
}

/** the headline as `eval/run-eval.mjs` writes it, so the reader's recompute check has something to agree with */
function totalsOf(cases) {
  const count = (kind, outcome) =>
    cases.filter((c) => c.kind === kind && c.outcome === outcome).length;
  const buggy = cases.filter((c) => c.kind === 'buggy').length;
  return {
    cases: cases.length,
    buggy,
    controls: cases.length - buggy,
    proved: count('buggy', 'proved'),
    proofRate: buggy === 0 ? null : count('buggy', 'proved') / buggy,
    claimUnproved: count('buggy', 'claim-unproved'),
    misses: count('buggy', 'miss'),
    falseAlarms: count('control', 'false-alarm'),
    controlsCorrect: count('control', 'correct'),
    noVerdict: cases.filter((c) => c.outcome === 'no-verdict').length,
    errors: cases.filter((c) => c.outcome === 'error').length,
    usage: cases.reduce(
      (total, c) => ({
        promptTokens: total.promptTokens + c.usage.promptTokens,
        completionTokens: total.completionTokens + c.usage.completionTokens,
        totalTokens: total.totalTokens + c.usage.totalTokens,
        costUsd: total.costUsd + c.usage.costUsd,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
    ),
    wallMsTotal: cases.reduce((n, c) => n + c.wallMs, 0),
  };
}

/** write a run directory tree and hand back its path */
function runsFixture(runs) {
  const dir = mkdtempSync(join(tmpdir(), 'scoreboard-'));
  for (const [name, summary] of Object.entries(runs)) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'summary.json'), JSON.stringify(summary));
  }
  return dir;
}

describe('summary format generations', () => {
  it('reads each of the three shapes committed under runs/', () => {
    for (const generation of [1, 2, 3]) {
      const parsed = parseSummary(summaryOf({ generation }), `gen-${generation}`);
      assert.equal(parsed.generation, generation, `generation ${generation} was misread`);
    }
  });

  // the regression this file exists for: the recorded fields grew three times, and a reader that
  // treats a moved field as absent scores the run as a zero and reports the zero as a measurement
  it('refuses a shape between generations rather than scoring it', () => {
    const between = summaryOf({ generation: 2 });
    between.order = ['bug-0']; // stage 3's field, without the two that came with it
    assert.throws(
      () => parseSummary(between, 'half-gen-3'),
      /unrecognised summary generation.*order/s,
    );
  });

  it('refuses a summary whose totals moved instead of reading them as zero', () => {
    const moved = summaryOf({ generation: 2 });
    moved.totals.provedCases = moved.totals.proved;
    delete moved.totals.proved;
    assert.throws(() => parseSummary(moved, 'moved-field'), /totals\.proved .* not a number/s);
  });

  it('refuses a summary whose totals no longer match the cases they are over', () => {
    const drifted = summaryOf({ generation: 3, buggy: ['proved', 'miss'] });
    drifted.totals.proved = 2;
    assert.throws(() => parseSummary(drifted, 'drifted'), /totals do not match the cases/);
  });

  it('refuses an outcome outside the scorer vocabulary', () => {
    const odd = summaryOf({ generation: 1 });
    odd.cases[0].outcome = 'partially-proved';
    assert.throws(() => parseSummary(odd, 'odd-outcome'), /outside the vocabulary/);
  });

  it('names the file it could not read', () => {
    assert.throws(() => readSummary('/nowhere/summary.json'), /\/nowhere\/summary\.json/);
  });
});

describe('scoreboard aggregation', () => {
  const ENGINE = {
    id: 'test',
    label: 'test',
    model: 'm',
    role: 'a fixture',
    slice: { label: '3 cases', cases: 3, buggy: 2, controls: 1 },
    shipped: 'stage 1',
  };
  const ARM = {
    id: 'arm',
    label: 'arm',
    code: 'a',
    prefix: 'arm',
    engine: 'test',
    track: 'ladder',
    row: '1',
    against: null,
    claims: [],
  };

  /** three repetitions where one case proves every time and the other only twice */
  function wobbly() {
    return runsFixture({
      'arm-rep1': summaryOf({ buggy: ['proved', 'proved'], controls: ['correct'] }),
      'arm-rep2': summaryOf({ buggy: ['proved', 'miss'], controls: ['correct'] }),
      'arm-rep3': summaryOf({ buggy: ['proved', 'proved'], controls: ['correct'] }),
    });
  }

  it('counts only the cases proved in every repetition, and keeps the single runs beside it', () => {
    const board = buildScoreboard({ runsDir: wobbly(), arms: [ARM], engines: [ENGINE] });
    const [arm] = board.arms;
    assert.equal(arm.allProved, 1, 'a case missed once must not count toward the primary metric');
    assert.equal(arm.anyProved, 2);
    assert.deepEqual(
      arm.reps.map((rep) => rep.proved),
      [2, 1, 2],
    );
    assert.deepEqual(arm.flips, ['bug-1']);
  });

  it('reports false alarms per repetition rather than averaging them', () => {
    const runsDir = runsFixture({
      'arm-rep1': summaryOf({ buggy: ['proved', 'proved'], controls: ['false-alarm'] }),
      'arm-rep2': summaryOf({ buggy: ['proved', 'proved'], controls: ['correct'] }),
      'arm-rep3': summaryOf({ buggy: ['proved', 'proved'], controls: ['correct'] }),
    });
    const board = buildScoreboard({ runsDir, arms: [ARM], engines: [ENGINE] });
    assert.deepEqual(
      board.arms[0].reps.map((rep) => rep.falseAlarms),
      [1, 0, 0],
    );
    const printed = formatScoreboard(board);
    assert.match(printed, /1\/1 0\/1 0\/1/, 'the three draws must survive into the table');
    assert.doesNotMatch(printed, /0\.33/, 'nothing may print an averaged false-alarm rate');
  });

  it('separates a control that was never answered from one that came back correct', () => {
    const runsDir = runsFixture({
      'arm-rep1': summaryOf({ buggy: ['proved', 'proved'], controls: ['no-verdict'] }),
    });
    const board = buildScoreboard({ runsDir, arms: [ARM], engines: [ENGINE] });
    const [rep] = board.arms[0].reps;
    assert.equal(rep.falseAlarms, 0);
    assert.equal(rep.controlsCorrect, 0);
    assert.deepEqual(
      rep.controlsUnanswered.map((c) => c.id),
      ['ctl-0'],
    );
    assert.match(formatScoreboard(board), /controls that were never answered/);
  });

  it('refuses repetitions that were not run at one configuration', () => {
    const runsDir = runsFixture({
      'arm-rep1': summaryOf({}),
      'arm-rep2': (() => {
        const other = summaryOf({});
        other.requestExtras = { max_tokens: 8192 };
        return other;
      })(),
    });
    assert.throws(
      () => buildScoreboard({ runsDir, arms: [ARM], engines: [ENGINE] }),
      /disagree on requestExtras/,
    );
  });

  it('refuses an arm measured over a different slice than its engine', () => {
    const runsDir = runsFixture({
      'arm-rep1': summaryOf({ buggy: ['proved', 'proved', 'proved'], controls: ['correct'] }),
    });
    assert.throws(
      () => buildScoreboard({ runsDir, arms: [ARM], engines: [ENGINE] }),
      /is measured over 2 \+ 1/,
    );
  });

  it('will not report a missing arm as a zero', () => {
    assert.throws(
      () => buildScoreboard({ runsDir: runsFixture({}), arms: [ARM], engines: [ENGINE] }),
      /no run directory .* starts with "arm"/,
    );
  });

  it('takes the delta on the primary metric against the named arm only', () => {
    const runsDir = runsFixture({
      'base-rep1': summaryOf({ buggy: ['proved', 'miss'], controls: ['correct'] }),
      'next-rep1': summaryOf({ buggy: ['proved', 'proved'], controls: ['correct'] }),
      'next-rep2': summaryOf({ buggy: ['proved', 'proved'], controls: ['correct'] }),
    });
    const base = { ...ARM, id: 'base', label: 'base', prefix: 'base' };
    const next = { ...ARM, id: 'next', label: 'next', prefix: 'next', against: 'base' };
    const board = buildScoreboard({ runsDir, arms: [base, next], engines: [ENGINE] });
    // base holds 1 of 2, next holds 2 of 2; the delta is on that metric, not on the single runs
    assert.equal(board.arms[0].allProved, 1);
    assert.equal(board.arms[1].allProved, 2);
    assert.match(formatScoreboard(board), /\+1/);
  });
});

describe('reconciliation against the CHANGELOG rows', () => {
  const arm = {
    id: 'a',
    label: 'arm',
    engine: 'test',
    track: 'ladder',
    buggyCount: 12,
    controlCount: 3,
    allProved: 10,
    anyProved: 12,
    flips: ['x', 'y'],
    tokens: 1_552_623,
    costUsd: 0.0613,
    wallMs: 468_000,
    reps: [
      { proved: 11, falseAlarms: 0, misses: 1, claimUnproved: 0, noVerdict: 0, controlsUnanswered: [] },
      { proved: 12, falseAlarms: 0, misses: 0, claimUnproved: 0, noVerdict: 0, controlsUnanswered: [] },
      { proved: 11, falseAlarms: 0, misses: 0, claimUnproved: 0, noVerdict: 1, controlsUnanswered: [] },
    ],
  };

  it('passes a row whose figures the runs reproduce', () => {
    const { checks, disagreements } = reconcile([
      {
        ...arm,
        claims: [
          { row: '1', single: [11, 12, 11], all: 10, falseAlarms: [0, 0, 0], flips: 2 },
        ],
      },
    ]);
    assert.equal(checks.length, 4);
    assert.deepEqual(disagreements, []);
  });

  it('flags a row that states a per-repetition figure the runs do not have', () => {
    const { disagreements } = reconcile([
      { ...arm, claims: [{ row: '1', falseAlarms: [0, 0, 1] }] },
    ]);
    assert.equal(disagreements.length, 1);
    assert.equal(disagreements[0].stated, '0/3 0/3 1/3');
    assert.equal(disagreements[0].actual, '0/3 0/3 0/3');
  });

  it('compares cost and tokens at the precision the row states them', () => {
    const { disagreements } = reconcile([
      { ...arm, claims: [{ row: '1', costUsd: 0.0613, tokens: '1.55M', wallMin: 7.8 }] },
    ]);
    assert.deepEqual(disagreements, []);
  });

  it('refuses a claimed field nothing knows how to recompute', () => {
    assert.throws(
      () => reconcile([{ ...arm, claims: [{ row: '1', vibes: 'good' }] }]),
      /claims "vibes"/,
    );
  });
});

describe('the emitted page', () => {
  const ENGINE = {
    id: 'test',
    label: 'test',
    model: 'test/model',
    role: 'a fixture',
    slice: { label: '3 cases', cases: 3, buggy: 2, controls: 1 },
    shipped: 'stage 1',
  };
  const ARM = {
    id: 'arm',
    label: 'arm',
    code: 'a',
    prefix: 'arm',
    engine: 'test',
    track: 'ladder',
    row: '1',
    against: null,
    shipped: true,
    claims: [{ row: '1', all: 1 }],
  };

  function page() {
    const runsDir = runsFixture({
      'arm-rep1': summaryOf({ buggy: ['proved', 'proved'], controls: ['correct'], model: 'test/model' }),
      'arm-rep2': summaryOf({ buggy: ['proved', 'miss'], controls: ['correct'], model: 'test/model' }),
    });
    return renderScoreboardPage(buildScoreboard({ runsDir, arms: [ARM], engines: [ENGINE] }));
  }

  it('is self-contained: no script, no external request', () => {
    const html = page();
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.match(html, /<style>/);
  });

  it('states the metric, the slice and the shipped configuration', () => {
    const html = page();
    assert.match(html, /All k/);
    assert.match(html, /test\/model/);
    assert.match(html, /3 cases/);
    assert.match(html, /class="ships"/);
  });

  it('marks a disagreement in words as well as in ink', () => {
    const html = page();
    // the fixture arm claims 1 proved in every repetition and holds 1, so this page agrees
    assert.match(html, /agrees/);
    assert.doesNotMatch(html, /DISAGREES/);
  });

  it('dates itself from the runs it read, not from the clock', () => {
    assert.match(page(), /2026-08-29/);
  });
});

describe('CLI flags', () => {
  it('writes scoreboard.html unless told not to', () => {
    assert.equal(parseArgs([]).html, 'scoreboard.html');
    assert.equal(parseArgs(['--no-html']).html, null);
    assert.equal(parseArgs(['--html', 'out/x.html']).html, 'out/x.html');
    assert.equal(parseArgs(['--runs', 'other']).runsDir, 'other');
  });

  it('refuses a flag it does not know', () => {
    assert.throws(() => parseArgs(['--average-the-false-alarms']), /unknown flag/);
  });
});

// the committed runs are the record every CHANGELOG row is argued from, so the scoreboard is held
// to them directly rather than only to fixtures
describe('over the committed runs', { skip: !existsSync('runs/stage2-flash-rep1/summary.json') }, () => {
  const board = buildScoreboard();

  it('scores every registered arm and keeps each engine on its own slice', () => {
    const [flash, qwen] = board.engines;
    assert.equal(flash.slice.buggy + flash.slice.controls, 15);
    assert.equal(qwen.slice.buggy + qwen.slice.controls, 12);
    for (const arm of board.arms) {
      const engine = board.engines.find((e) => e.id === arm.engine);
      assert.equal(arm.buggyCount, engine.slice.buggy, `${arm.id} is off its engine's slice`);
      assert.equal(arm.controlCount, engine.slice.controls, `${arm.id} is off its engine's slice`);
    }
  });

  it('reads all three recorded generations', () => {
    assert.deepEqual(
      board.generations.map(([generation]) => generation),
      [1, 2, 3],
    );
  });

  it('reproduces the shipped rows: 12/12 on flash at stage 2, 4/10 on qwen at stage 1', () => {
    const shipped = board.arms.filter((arm) => arm.shipped);
    assert.deepEqual(
      shipped.map((arm) => `${arm.id} ${arm.allProved}/${arm.buggyCount}`),
      ['stage-2-flash 12/12', 'stage-1-qwen 4/10'],
    );
  });

  it('reconciles against CHANGELOG.md, with row 0f\'s qwen control figure the known exception', () => {
    const { checks, disagreements } = board.reconciliation;
    assert.ok(checks.length >= 60, `only ${checks.length} figures were checked`);
    for (const item of disagreements) {
      assert.equal(
        `${item.arm} ${item.row} ${item.field}`,
        'baseline-1-qwen 0f falseAlarms',
        `unexpected disagreement: ${item.armLabel} ${item.label} — ` +
          `CHANGELOG says ${item.stated}, the runs say ${item.actual}`,
      );
    }
  });
});

import { STYLESHEET } from '../src/render/stylesheet.mjs';
import { esc, number, particular, stamp } from '../src/render/format.mjs';

/**
 * The scoreboard as one self-contained HTML page, in the same book as the trajectory and the
 * review package.
 *
 * It composes rather than forks, the way `src/render/review-stylesheet.mjs` does: `STYLESHEET`
 * already carries the design system's `tokens.css` inlined verbatim between its BEGIN/END markers,
 * so the runtime still restyles all three artifacts by regenerating that one block, and nothing
 * below introduces a value of its own. The measurement table the token sheet reserved
 * `--table-rule-head`, `--table-rule-row`, `--table-rule-foot`, `--col-figure` and `--col-count`
 * for is the table this page sets.
 *
 * Two rules the page inherits and does not break. No hue encodes state: a figure that disagrees
 * with `CHANGELOG.md` is marked in the correction ink *and* said in words, so the page reads the
 * same in greyscale. And nothing is filled in: an arm measured once prints an em rule where the
 * k=3 metric would be, rather than a number that would be compared with one.
 */

/** what the scoreboard adds to the book */
const SCOREBOARD = String.raw`

/* ======================================================================
   THE SCOREBOARD
   Every candidate over the same cases, read across. The book's own
   measure is a reading measure and a results table is wider than it, so
   a table breaks out into the printed margin and scrolls inside its own
   frame rather than pushing the page sideways.
   ====================================================================== */

.wide {
  margin-left: calc((var(--col-margin) + var(--col-gutter)) * -1);
  overflow-x: auto;
}

/* the measurement table: ruled heavy under the head, feint between rows,
   closed by a rule at the foot, the way a results sheet is ruled */
table.record {
  border-collapse: collapse;
  margin-top: var(--space-1);
  min-width: 100%;
}
.record th {
  font: var(--weight-print) var(--size-apparatus)/var(--lead) var(--font-print);
  letter-spacing: var(--track-apparatus);
  text-transform: uppercase;
  color: var(--ink-print);
  text-align: left;
  vertical-align: bottom;
  white-space: nowrap;
  padding: 0 var(--space-h) calc(var(--space-h) - 2px) 0;
  border-bottom: var(--table-rule-head);
}
.record td {
  font-family: var(--font-machine);
  font-size: var(--size-machine);
  line-height: var(--lead);
  color: var(--ink-machine);
  font-variant-numeric: lining-nums tabular-nums;
  white-space: nowrap;
  padding: calc(var(--space-h) - 1px) var(--space-h) var(--space-h) 0;
  border-bottom: var(--table-rule-row);
}
.record tr:last-child td { border-bottom: var(--table-rule-foot); }
.record th:last-child, .record td:last-child { padding-right: 0; }

/* the arm's name is written matter, not an instrument reading */
.record td.arm {
  font-family: var(--font-record);
  font-size: var(--size-body);
  color: var(--ink-record);
}
/* the primary metric is the number the project is argued from, and is set
   at the record's own weight so it is not read as one column of many */
.record td.primary {
  font-weight: var(--weight-record-em);
  color: var(--ink-record);
}
/* a cell holding words rather than a reading is allowed to break, so a long
   field name does not set the width of the whole sheet */
.record td.wrap { white-space: normal; }
.record td.figure { text-align: right; min-width: var(--col-figure); }
.record td.count  { text-align: right; min-width: var(--col-count); }
/* an unmeasured cell is ruled, never zero */
.record td.none { color: var(--ink-print); }

/* the shipped configuration carries a stamp in the correction ink, and
   says so in words beside it, so the mark is not the only carrier */
.record td .ships {
  font: var(--weight-print) var(--size-apparatus)/var(--lead) var(--font-print);
  letter-spacing: var(--track-apparatus);
  text-transform: uppercase;
  color: var(--ink-correct);
  border: var(--stamp-border);
  padding: 0 var(--space-h);
  margin-left: var(--space-h);
  white-space: nowrap;
}

/* an arm's name set once over the run of rows it covers, the way a group is
   headed in a printed table of results rather than repeated down a column */
.record tr.group th {
  padding-top: var(--space-1);
  border-bottom: var(--table-rule-row);
  color: var(--ink-record);
  font-family: var(--font-record);
  font-size: var(--size-body);
  font-weight: var(--weight-record-em);
  letter-spacing: 0;
  text-transform: none;
}
.record tr.group:first-child th { padding-top: 0; }

/* the per-case matrix: one column per arm, one character per repetition,
   so a wobbling case is visible as a pattern rather than a rate */
.matrix td { font-variant-numeric: lining-nums tabular-nums; letter-spacing: 0.15em; }
.matrix td.id { letter-spacing: 0; }

/* a reconciled figure that does not match its row. The correction ink
   marks it and the cell says which way, so the page survives greyscale */
.record tr.disputed td { color: var(--ink-correct); }
.record tr.disputed td.arm { color: var(--ink-correct); }

/* a disagreement set out in full: what the row states over what the runs
   produce, ruled apart the way a correction is entered beneath an entry */
.dispute {
  margin-top: var(--space-1);
  border-top: var(--rule-weight) solid var(--ink-correct);
  padding-top: calc(var(--space-h) - 1px);
}
.dispute .what {
  font: var(--weight-print) var(--size-apparatus)/var(--lead) var(--font-print);
  letter-spacing: var(--track-apparatus);
  text-transform: uppercase;
  color: var(--ink-correct);
  margin: 0;
}
.dispute dl {
  margin: var(--space-h) 0 0;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: var(--space-1);
}
.dispute dt {
  font: var(--weight-print) var(--size-apparatus)/var(--lead) var(--font-print);
  letter-spacing: var(--track-apparatus);
  text-transform: uppercase;
  color: var(--ink-print);
}
.dispute dd {
  margin: 0;
  font-family: var(--font-machine);
  font-size: var(--size-machine);
  line-height: var(--lead);
  color: var(--ink-machine);
  font-variant-numeric: lining-nums tabular-nums;
}

/* the key under a table, set as printed apparatus */
.key-line {
  margin: var(--space-h) 0 0;
  font: var(--weight-print) var(--size-apparatus)/var(--lead) var(--font-print);
  letter-spacing: var(--track-apparatus);
  text-transform: uppercase;
  color: var(--ink-print);
}

@media (max-width: 800px) {
  /* the printed margin has already folded away, so the break-out has nothing to reclaim */
  .wide { margin-left: 0; }
}
`;

/** the complete inline sheet for the emitted scoreboard */
export const SCOREBOARD_STYLESHEET = STYLESHEET + SCOREBOARD;

/** an outcome's mark, spelled out under every matrix that uses it */
const MARK_KEY = [
  ['P', 'proved'],
  ['u', 'claim unproved'],
  ['.', 'miss'],
  ['C', 'control correct'],
  ['A', 'false alarm'],
  ['?', 'no verdict'],
  ['E', 'error'],
];

const MARK = {
  proved: 'P',
  'claim-unproved': 'u',
  miss: '.',
  correct: 'C',
  'false-alarm': 'A',
  'no-verdict': '?',
  error: 'E',
};

/**
 * @param {object} board from `buildScoreboard`
 * @returns {string} a complete HTML document
 */
export function renderScoreboardPage(board) {
  const engineSections = board.engines
    .map((engine, i) => engineSection(engine, board, i + 2))
    .join('\n');
  const last = latestFinish(board);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eval scoreboard — silent mutant</title>
<style>
${SCOREBOARD_STYLESHEET}
</style>
</head>
<body>
<main class="leaf">

  <p class="marginal">Fol. 1</p>
  <header class="masthead printed">
    <span>Eval scoreboard &middot; ${esc(board.runsDir)}/</span>
    <span>${last ? esc(stamp(last)) : 'undated'}</span>
  </header>

  <h1>Every candidate, over the same cases</h1>

  <p class="standfirst">${esc(board.arms.length)} arms, ${esc(board.runCount)} committed run
  directories, <b>no model called</b>. Every figure on this page is recomputed from the
  <code>summary.json</code> each run wrote, so the page regenerates for free and
  <code>CHANGELOG.md</code> can be held to it. The last section does exactly that.</p>

  <p class="marginal at-block">Particulars</p>
  <dl class="particulars">
    ${particular('Primary metric', 'cases proved in EVERY repetition')}
    ${particular('Repetitions', `k=3 on every ladder arm`)}
    ${particular('Engines', board.engines.map((e) => e.label).join(' · '))}
    ${particular('Shipped', board.engines.map((e) => `${e.shipped} on ${e.label}`).join(' · '))}
    ${particular('Runs read', `${board.runCount} directories under ${board.runsDir}/`)}
    ${particular('Summary generations', board.generations.map(([g, dirs]) => `gen ${g}: ${dirs.length}`).join(' · '))}
    ${particular(
      'Reconciled',
      `${board.reconciliation.checks.length} figures against CHANGELOG.md`,
    )}
    ${particular(
      'Disagreements',
      board.reconciliation.disagreements.length === 0
        ? 'none'
        : `${board.reconciliation.disagreements.length} — see § ${board.engines.length + 2}`,
    )}
  </dl>

  <h2><span class="key">&sect; 1</span>What is being measured</h2>
  <p>A case is <b>proved</b> when the agent's own test exits non-zero on the patched checkout and
  zero on the pristine one, under the library's own runner. The primary metric is not that rate on
  one run: it is the count of cases proved in <b>every one of three repetitions</b>, because a
  single draw hid the headroom — baseline 1 on flash was reported at 12/12 from one run and holds
  7/12 across three (row 0f). Single-run rates are printed beside the primary number, never
  instead of it.</p>

  <p><b>False alarms are printed per repetition.</b> A defect claimed on an equivalent refactor is
  treated as a hard error, and averaging three draws of a metric whose target is zero would report
  a number the project never claims. Where a control was left without a verdict at all, that is
  said separately: an unanswered control is not a control that came back correct.</p>

  <p><b>The two engines are measured over different cases and never share a table.</b>
  ${board.engines
    .map(
      (e) =>
        `${esc(e.label)} covers ${esc(e.slice.label)} (${e.slice.buggy} buggy + ${e.slice.controls} controls)`,
    )
    .join('; ')}. A rate over one slice is not a rate over the other, and no comparison on this
  page crosses between them. <b>The shipped configuration is per engine</b> for the same reason:
  ${board.engines.map((e) => `${esc(e.shipped)} on ${esc(e.label)}`).join(', ')}.</p>

  <p><b>Stage 3 is an on/off ablation and is scored against its own memory-off arm.</b> Both off
  arms re-measure an unchanged candidate under a sequential case order and land one case below the
  row they re-measure, so reading the on arm against rows 1 and 2 would charge that gap to the
  memory.</p>

${engineSections}

  <h2><span class="key">&sect; ${board.engines.length + 2}</span>Reconciliation against CHANGELOG.md</h2>
${reconciliationSection(board)}

  <h2><span class="key">&sect; ${board.engines.length + 3}</span>What was read</h2>
${provenanceSection(board)}

  <p class="marginal at-block">Fol. 1</p>
  <footer class="colophon printed">
    <span>Recomputed from ${esc(board.runCount)} run directories under ${esc(board.runsDir)}/</span>
    <span>Fol. 1 of 1</span>
    <span class="note">${esc(tally(board))}</span>
  </footer>

</main>
</body>
</html>
`;
}

/** one engine: its ladder, its single-run rows, its ablation, its controls note, its case matrix */
function engineSection(engine, board, section) {
  const ladder = engine.arms.filter((arm) => arm.track === 'ladder');
  const singles = engine.arms.filter((arm) => arm.track === 'single');
  const ablation = engine.arms.filter((arm) => arm.track === 'ablation');

  const parts = [
    `  <h2><span class="key">&sect; ${section}</span>${esc(engine.label)} &mdash; ${esc(engine.role)}</h2>`,
    `  <p><code>${esc(engine.model)}</code>, measured over ${esc(engine.slice.label)}:
  ${engine.slice.buggy} buggy cases and ${engine.slice.controls} equivalent-refactor controls.
  Every figure in this section is over that slice.</p>`,
    metricTable(ladder, board),
    costTable(ladder),
  ];

  if (singles.length > 0) {
    parts.push(
      `  <p>Measured once, before the engine pins existed, and therefore not comparable with the
  rows above: a single draw at an unpinned configuration is the number row 0f was opened to
  replace.</p>`,
      metricTable(singles, board),
      costTable(singles),
    );
  }

  if (ablation.length > 0) {
    parts.push(
      `  <p>The stage-3 ablation, scored against its own memory-off arm:</p>`,
      metricTable(ablation, board),
      costTable(ablation),
    );
  }

  const unanswered = engine.arms.flatMap((arm) =>
    arm.reps.flatMap((rep) =>
      rep.controlsUnanswered.map((record) => ({
        arm: `${arm.label} r${rep.rep}`,
        id: record.id,
        outcome: record.outcome,
      })),
    ),
  );
  if (unanswered.length > 0) {
    parts.push(`  <p class="marginal at-block">Controls</p>
  <div class="wide">
  <table class="record">
    <thead><tr><th>Arm</th><th>Control</th><th>Outcome</th></tr></thead>
    <tbody>
${unanswered
  .map(
    (row) =>
      `      <tr><td class="arm">${esc(row.arm)}</td><td>${esc(row.id)}</td><td>${esc(row.outcome)}</td></tr>`,
  )
  .join('\n')}
    </tbody>
  </table>
  </div>
  <p class="key-line">A control left without a verdict is counted in neither column above. The
  false-alarm rate in that repetition is over the controls that were answered.</p>`);
  }

  parts.push(caseMatrix(engine));
  return parts.join('\n');
}

/** what the decision was made on: the rates, the primary number, the delta, the controls */
function metricTable(arms, board) {
  const rows = arms.map((arm) => {
    const against = arm.against ? board.arms.find((a) => a.id === arm.against) : null;
    const diff = against && arm.k > 1 ? arm.allProved - against.allProved : null;
    return `      <tr>
        <td class="arm">${esc(arm.label)}${arm.shipped ? '<span class="ships">Ships</span>' : ''}</td>
        <td class="count">${esc(arm.row)}</td>
        <td class="count">${esc(arm.k)}</td>
        <td class="figure">${arm.reps.map((r) => `${r.proved}/${r.buggy}`).join(' ')}</td>
        <td class="figure primary">${
          arm.k > 1 ? `${arm.allProved}/${arm.buggyCount}` : '<span class="none">&mdash;</span>'
        }</td>
        <td class="count">${
          diff === null
            ? '<span class="none">&mdash;</span>'
            : esc(`${diff > 0 ? '+' : ''}${diff}`)
        }</td>
        <td class="figure">${arm.reps.map((r) => `${r.falseAlarms}/${r.controls}`).join(' ')}</td>
        <td class="count">${
          arm.k > 1 ? esc(arm.flips.length) : '<span class="none">&mdash;</span>'
        }</td>
      </tr>`;
  });
  return `  <div class="wide">
  <table class="record">
    <thead><tr>
      <th>Arm</th><th>Row</th><th>k</th><th>Single-run</th><th>All k</th>
      <th>&Delta;</th><th>False alarms</th><th>Flips</th>
    </tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>
  </div>
  <p class="key-line">All k = cases proved in every repetition, the primary metric. Single-run and
  false alarms are one figure per repetition, in order. &Delta; is on the primary metric, against
  the arm the row argues from, never across engines.</p>${headroom(arms)}`;
}

/**
 * The gap between a case proved once and a case held three times is the arm's headroom, and it is
 * the whole reason the primary metric is the k=3 one.
 */
function headroom(arms) {
  const measured = arms.filter((arm) => arm.k > 1);
  if (measured.length === 0) return '';
  return `
  <p class="key-line">Proved in at least one repetition: ${measured
    .map((arm) => `${esc(arm.label)} ${arm.anyProved}/${arm.buggyCount}`)
    .join(' &middot; ')}</p>`;
}

/** what it cost, and where the non-proofs went */
function costTable(arms) {
  const rows = arms.map(
    (arm) => `      <tr>
        <td class="arm">${esc(arm.label)}</td>
        <td class="figure">${arm.reps.map((r) => r.misses).join(' ')}</td>
        <td class="figure">${arm.reps.map((r) => r.claimUnproved + r.noVerdict).join(' ')}</td>
        <td class="figure">${esc((arm.tokens / 1e6).toFixed(2))}M</td>
        <td class="figure">$${esc(arm.costUsd.toFixed(4))}</td>
        <td class="figure">${esc((arm.wallMs / 60000).toFixed(1))} min</td>
      </tr>`,
  );
  return `  <div class="wide">
  <table class="record">
    <thead><tr>
      <th>Arm</th><th>Misses</th><th>Withheld</th><th>Tokens</th><th>Cost</th><th>Wall</th>
    </tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>
  </div>
  <p class="key-line">Withheld = a buggy case claimed but not proved, or left without a verdict.
  A withheld claim asks for a human; a miss ships the defect.</p>`;
}

/** every arm of one engine read across one case at a time */
function caseMatrix(engine) {
  const rows = engine.caseIds.map((id) => {
    const kind = engine.arms[0].outcomes.get(id).kind;
    const cells = engine.arms
      .map(
        (arm) =>
          `<td>${esc(
            arm.outcomes
              .get(id)
              .outcomes.map((outcome) => MARK[outcome] ?? '?')
              .join(''),
          )}</td>`,
      )
      .join('');
    return `      <tr><td class="id">${esc(id)}</td><td class="id">${esc(kind)}</td>${cells}</tr>`;
  });
  return `  <p class="marginal at-block">Per case</p>
  <div class="wide">
  <table class="record matrix">
    <thead><tr>
      <th>Case</th><th>Kind</th>${engine.arms.map((arm) => `<th>${esc(arm.code)}</th>`).join('')}
    </tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>
  </div>
  <p class="key-line">${engine.arms
    .map((arm) => `${esc(arm.code)} = ${esc(arm.label)}, row ${esc(arm.row)}`)
    .join(' &middot; ')}</p>
  <p class="key-line">${MARK_KEY.map(([mark, meaning]) => `${esc(mark)} ${esc(meaning)}`).join(' &middot; ')}</p>`;
}

/** every figure a row states, recomputed, with the disagreements set out in full underneath */
function reconciliationSection(board) {
  const { checks, disagreements } = board.reconciliation;
  // the arm is a group head rather than a repeated column: it is the same arm for a run of rows,
  // and setting it once leaves the sheet the width the figures actually need
  const rows = [];
  let group = null;
  for (const check of checks) {
    if (check.arm !== group) {
      group = check.arm;
      rows.push(
        `      <tr class="group"><th colspan="5">${esc(check.armLabel)}</th></tr>`,
      );
    }
    rows.push(`      <tr${check.ok ? '' : ' class="disputed"'}>
        <td class="count">${esc(check.row)}</td>
        <td>${esc(check.label)}</td>
        <td class="figure">${esc(check.stated)}</td>
        <td class="figure">${esc(check.actual)}</td>
        <td>${check.ok ? 'agrees' : 'DISAGREES'}</td>
      </tr>`);
  }

  const verdict =
    disagreements.length === 0
      ? `  <p>All <b>${checks.length}</b> figures the rows state come back out of the runs
  unchanged.</p>`
      : `  <p><b>${disagreements.length}</b> of ${checks.length} figures stated by the rows do not
  come back out of the runs. Each is set out below as it stands. Neither side was adjusted to
  agree with the other: the run directories are what both are over.</p>`;

  const disputes = disagreements
    .map(
      (item) => `  <div class="dispute">
    <p class="what">Row ${esc(item.row)} &middot; ${esc(item.armLabel)} &middot; ${esc(item.label)}</p>
    <dl>
      <dt>CHANGELOG says</dt><dd>${esc(item.stated)}</dd>
      <dt>The runs say</dt><dd>${esc(item.actual)}</dd>
    </dl>
  </div>`,
    )
    .join('\n');

  return `${verdict}
${disputes}
  <div class="wide">
  <table class="record">
    <thead><tr>
      <th>Row</th><th>Figure</th><th>Stated</th><th>Runs say</th><th></th>
    </tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>
  </div>`;
}

/** which directories were read, and which recorded shape each of them is */
function provenanceSection(board) {
  const rows = board.arms.flatMap((arm) =>
    arm.reps.map(
      (rep) => `      <tr>
        <td class="arm wrap">${esc(arm.label)} ${esc(arm.engine)}</td>
        <td class="id">${esc(rep.dir)}</td>
        <td class="count">${esc(rep.rep)}</td>
        <td class="count">${esc(rep.generation)}</td>
        <td class="figure">${esc(number(rep.tokens))}</td>
      </tr>`,
    ),
  );
  return `  <p>The recorded fields grew as the measurement did and three shapes are committed: the
  row-0 runs predate <code>requestExtras</code>; the <code>day2-</code>, <code>stage1-</code> and
  <code>stage2-</code> runs carry it but not <code>candidateOptions</code>,
  <code>concurrency</code> or <code>order</code>; stage 3 carries all of them. Each is read as its
  own generation and a fourth shape stops the scoreboard rather than being scored partly.</p>
  <div class="wide">
  <table class="record">
    <thead><tr><th>Arm</th><th>Directory</th><th>Rep</th><th>Gen</th><th>Tokens</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>
  </div>`;
}

/** the latest moment any run in the scoreboard finished: the record's own date, not today's */
function latestFinish(board) {
  const stamps = board.arms
    .flatMap((arm) => arm.reps.map((rep) => rep.summary.finishedAt))
    .filter(Boolean)
    .sort();
  return stamps.at(-1) ?? null;
}

/** what the page is made of, so nothing can be dropped unnoticed */
function tally(board) {
  const cases = board.engines
    .map((engine) => `${engine.label} ${engine.caseIds.length}`)
    .join(', ');
  const { checks, disagreements } = board.reconciliation;
  return (
    `${board.arms.length} arms, ${board.runCount} runs, cases ${cases}; ` +
    `${checks.length} figures reconciled, ${disagreements.length} disagreeing`
  );
}

#!/usr/bin/env node
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARMS, ENGINES } from './arms.mjs';
import { renderScoreboardPage } from './scoreboard-page.mjs';
import { readSummary } from './summary-format.mjs';

/**
 * CLI: `npm run eval:scoreboard [-- --html <path>] [--runs <dir>] [--no-html]`
 *
 * Every candidate in the programme, side by side on the same cases, from the run directories
 * already committed under `runs/`. Nothing here calls a model and nothing needs a key: the runs
 * are the record, and this is an aggregation over them, so a reader can regenerate the whole
 * scoreboard for free and hold `CHANGELOG.md` to it.
 *
 * What the measurement is, and what the scoreboard therefore refuses to do:
 *
 * - **The primary metric is cases proved in every repetition**, not a single-run proof rate.
 *   Single-run rates are printed beside it because they are what the row-0 numbers were and what
 *   row 0f showed to be hiding the headroom, but the bold number is the k=3 one.
 * - **False alarms are per repetition.** An average over three repetitions of a hard-zero metric
 *   is a number nothing in the project claims; every rate here is printed as its three draws.
 * - **The case slices differ by engine.** Flash arms cover all 15 cases, qwen arms the 12 ms+bytes
 *   cases. The two engines never share a table, and no delta crosses them.
 * - **The shipped configuration is per engine**: stage 2 on flash, stage 1 on qwen. Both are
 *   marked in their own engine's table rather than one being called the winner.
 * - **Stage 3 is an on/off ablation** and is scored against its own off arm. Its off arms
 *   re-measure an unchanged candidate under a different case order and land a case below the rows
 *   they re-measure, so scoring the on arm against rows 1 and 2 would read that gap as memory.
 *
 * The last section reconciles every number against the `CHANGELOG.md` row that states it. The
 * rows' own figures live in `eval/arms.mjs`; a disagreement is printed, not resolved.
 */

/** an outcome as one character, the same marks `eval/analyze-k3.mjs` prints */
export const MARK = {
  proved: 'P',
  'claim-unproved': 'u',
  miss: '.',
  correct: 'C',
  'false-alarm': 'A',
  'no-verdict': '?',
  error: 'E',
};

/**
 * Read every arm's repetitions and score them.
 *
 * @param {{runsDir?: string, arms?: object[], engines?: object[]}} [options]
 * @returns {object} the scoreboard, ready to format
 */
export function buildScoreboard({ runsDir = 'runs', arms = ARMS, engines = ENGINES } = {}) {
  const scored = arms.map((arm) => scoreArm(arm, runsDir));
  const byEngine = engines.map((engine) => {
    const own = scored.filter((arm) => arm.engine === engine.id);
    if (own.length === 0) throw new Error(`no arms for engine ${engine.id}`);
    checkSlice(engine, own);
    return { ...engine, arms: own, caseIds: own[0].caseIds };
  });

  const generations = new Map();
  for (const arm of scored) {
    for (const rep of arm.reps) {
      if (!generations.has(rep.generation)) generations.set(rep.generation, []);
      generations.get(rep.generation).push(rep.dir);
    }
  }

  return {
    runsDir,
    engines: byEngine,
    arms: scored,
    generations: [...generations].sort((a, b) => a[0] - b[0]),
    runCount: scored.reduce((n, arm) => n + arm.k, 0),
    reconciliation: reconcile(scored),
  };
}

/** one arm: its repetitions, the per-repetition rates, and the metric that holds across them */
function scoreArm(arm, runsDir) {
  const dirs = readdirSync(runsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(arm.prefix))
    .filter((e) => existsSync(join(runsDir, e.name, 'summary.json')))
    .map((e) => e.name)
    .sort();
  if (dirs.length === 0) {
    throw new Error(
      `arm ${arm.id}: no run directory under ${runsDir}/ starts with "${arm.prefix}". ` +
        'The scoreboard scores committed runs and will not report an empty arm as a zero.',
    );
  }

  const reps = dirs.map((dir, i) => {
    const summary = readSummary(join(runsDir, dir, 'summary.json'));
    const buggy = summary.cases.filter((c) => c.kind === 'buggy');
    const controls = summary.cases.filter((c) => c.kind === 'control');
    return {
      dir,
      rep: Number(/-rep(\d+)$/.exec(dir)?.[1] ?? i + 1),
      generation: summary.generation,
      summary,
      proved: buggy.filter((c) => c.outcome === 'proved').length,
      buggy: buggy.length,
      controls: controls.length,
      falseAlarms: controls.filter((c) => c.outcome === 'false-alarm').length,
      controlsCorrect: controls.filter((c) => c.outcome === 'correct').length,
      controlsUnanswered: controls.filter(
        (c) => c.outcome === 'no-verdict' || c.outcome === 'error',
      ),
      misses: buggy.filter((c) => c.outcome === 'miss').length,
      claimUnproved: buggy.filter((c) => c.outcome === 'claim-unproved').length,
      noVerdict: buggy.filter((c) => c.outcome === 'no-verdict').length,
      errors: summary.cases.filter((c) => c.outcome === 'error').length,
      tokens: summary.totals.usage.totalTokens,
      costUsd: summary.totals.usage.costUsd ?? 0,
      wallMs: summary.wallMs,
    };
  });

  checkOneConfiguration(arm, reps);

  /** @type {Map<string, {kind: string, outcomes: string[]}>} */
  const outcomes = new Map();
  for (const rep of reps) {
    for (const record of rep.summary.cases) {
      if (!outcomes.has(record.id)) outcomes.set(record.id, { kind: record.kind, outcomes: [] });
      outcomes.get(record.id).outcomes.push(record.outcome);
    }
  }
  const buggyCases = [...outcomes].filter(([, c]) => c.kind === 'buggy');
  const controlCases = [...outcomes].filter(([, c]) => c.kind === 'control');
  const first = reps[0].summary;

  return {
    ...arm,
    k: reps.length,
    reps,
    caseIds: [...outcomes.keys()].sort(),
    candidate: first.candidate,
    description: first.description,
    model: first.model,
    requestExtras: first.requestExtras ?? null,
    candidateOptions: first.candidateOptions ?? null,
    concurrency: first.concurrency ?? null,
    generation: first.generation,
    outcomes,
    buggyCount: buggyCases.length,
    controlCount: controlCases.length,
    allProved: buggyCases.filter(([, c]) => c.outcomes.every((o) => o === 'proved')).length,
    anyProved: buggyCases.filter(([, c]) => c.outcomes.some((o) => o === 'proved')).length,
    flips: buggyCases.filter(([, c]) => new Set(c.outcomes).size > 1).map(([id]) => id),
    tokens: sum(reps, (r) => r.tokens),
    costUsd: sum(reps, (r) => r.costUsd),
    wallMs: sum(reps, (r) => r.wallMs),
  };
}

/**
 * Repetitions of one arm have to have been run at one configuration, or the arm is not an arm and
 * its k=3 number is over three different things.
 */
function checkOneConfiguration(arm, reps) {
  const fields = ['candidate', 'model'];
  for (const field of fields) {
    const seen = new Set(reps.map((r) => r.summary[field]));
    if (seen.size > 1) {
      throw new Error(
        `arm ${arm.id}: repetitions disagree on ${field} (${[...seen].join(', ')}). ` +
          'These are not repetitions of one arm.',
      );
    }
  }
  const extras = new Set(reps.map((r) => JSON.stringify(r.summary.requestExtras ?? null)));
  if (extras.size > 1) {
    throw new Error(
      `arm ${arm.id}: repetitions disagree on requestExtras — ${[...extras].join(' vs ')}. ` +
        'Two runs are only comparable when the knob set sent to OpenRouter matches.',
    );
  }
  const options = new Set(reps.map((r) => JSON.stringify(r.summary.candidateOptions ?? null)));
  if (options.size > 1) {
    throw new Error(
      `arm ${arm.id}: repetitions disagree on candidateOptions — ${[...options].join(' vs ')}`,
    );
  }
}

/** every arm on an engine has to be over that engine's slice, or nothing on the page lines up */
function checkSlice(engine, arms) {
  const reference = arms[0];
  for (const arm of arms) {
    if (arm.model !== engine.model) {
      throw new Error(
        `arm ${arm.id} runs ${arm.model} but is registered on engine ${engine.id} (${engine.model})`,
      );
    }
    if (arm.buggyCount !== engine.slice.buggy || arm.controlCount !== engine.slice.controls) {
      throw new Error(
        `arm ${arm.id}: ${arm.buggyCount} buggy + ${arm.controlCount} controls, but engine ` +
          `${engine.id} is measured over ${engine.slice.buggy} + ${engine.slice.controls} ` +
          `(${engine.slice.label}). A rate over a different slice is a different number.`,
      );
    }
    if (arm.caseIds.join(',') !== reference.caseIds.join(',')) {
      throw new Error(
        `arm ${arm.id} and arm ${reference.id} are both on engine ${engine.id} but cover ` +
          'different cases, so they cannot be put side by side',
      );
    }
  }
}

/* ---------------------------------------------------------------------------------------------
   reconciliation against CHANGELOG.md
   --------------------------------------------------------------------------------------------- */

/** how each claimed field is recomputed, printed and compared */
const CHECKS = [
  {
    field: 'single',
    label: 'single-run proof rate',
    actual: (arm) => arm.reps.map((r) => r.proved),
    show: (value, arm) => value.map((n) => `${n}/${arm.buggyCount}`).join(' '),
    same: sameArray,
  },
  {
    field: 'all',
    label: 'proved in every rep',
    actual: (arm) => arm.allProved,
    show: (value, arm) => `${value}/${arm.buggyCount}`,
    same: Object.is,
  },
  {
    field: 'falseAlarms',
    label: 'false alarms',
    actual: (arm) => arm.reps.map((r) => r.falseAlarms),
    show: (value, arm) => value.map((n) => `${n}/${arm.controlCount}`).join(' '),
    same: sameArray,
  },
  {
    field: 'misses',
    label: 'misses',
    actual: (arm) => arm.reps.map((r) => r.misses),
    show: (value) => value.join(' '),
    same: sameArray,
  },
  {
    field: 'missesEachAtLeast',
    label: 'misses every rep',
    actual: (arm) => Math.min(...arm.reps.map((r) => r.misses)),
    show: (value) => `${value}+ per rep`,
    same: (stated, actual) => actual >= stated,
  },
  {
    field: 'claimUnproved',
    label: 'claims not proved',
    actual: (arm) => arm.reps.map((r) => r.claimUnproved),
    show: (value) => value.join(' '),
    same: sameArray,
  },
  {
    field: 'noVerdict',
    label: 'no-verdicts, buggy',
    actual: (arm) => arm.reps.map((r) => r.noVerdict),
    show: (value) => value.join(' '),
    same: sameArray,
  },
  {
    field: 'controlNoVerdicts',
    label: 'controls unanswered',
    actual: (arm) =>
      sum(arm.reps, (r) => r.controlsUnanswered.filter((c) => c.outcome === 'no-verdict').length),
    show: (value) => String(value),
    same: Object.is,
  },
  {
    field: 'flips',
    label: 'cases that flip',
    actual: (arm) => arm.flips.length,
    show: (value) => String(value),
    same: Object.is,
  },
  {
    field: 'costUsd',
    label: 'cost',
    actual: (arm) => arm.costUsd,
    show: (value) => `$${value.toFixed(4)}`,
    same: (stated, actual) => actual.toFixed(4) === stated.toFixed(4),
  },
  {
    field: 'tokens',
    label: 'tokens',
    actual: (arm) => arm.tokens,
    // the rows state tokens at their own precision ("212k", "1.55M"), so the recomputed figure is
    // rounded to the same unit before it is compared
    show: (value) => (typeof value === 'string' ? value : value.toLocaleString('en-US')),
    same: (stated, actual) => tokensLike(actual, stated) === stated,
  },
  {
    field: 'wallMin',
    label: 'wall time',
    actual: (arm) => arm.wallMs / 60000,
    show: (value) => `${value.toFixed(1)} min`,
    same: (stated, actual) => actual.toFixed(1) === stated.toFixed(1),
  },
];

const CHECK_BY_FIELD = new Map(CHECKS.map((check) => [check.field, check]));

/**
 * Recompute every figure a `CHANGELOG.md` row states about an arm and compare it with the row.
 *
 * @param {object[]} arms scored arms
 * @returns {{checks: object[], disagreements: object[]}}
 */
export function reconcile(arms) {
  const checks = [];
  for (const arm of arms) {
    for (const claim of arm.claims ?? []) {
      for (const [field, stated] of Object.entries(claim)) {
        if (field === 'row') continue;
        const check = CHECK_BY_FIELD.get(field);
        if (!check) {
          throw new Error(
            `arm ${arm.id}: CHANGELOG row ${claim.row} claims "${field}", which nothing in ` +
              'eval/scoreboard.mjs knows how to recompute',
          );
        }
        const actual = check.actual(arm);
        checks.push({
          arm: arm.id,
          // the k=1 rows share a label with the arm that re-measured them, so the track is part
          // of the name wherever a claim is attributed
          armLabel: `${arm.label} ${arm.engine}${arm.track === 'single' ? ', k=1' : ''}`,
          row: claim.row,
          field,
          label: check.label,
          stated: check.show(stated, arm),
          actual: check.show(actual, arm),
          ok: check.same(stated, actual),
        });
      }
    }
  }
  return { checks, disagreements: checks.filter((c) => !c.ok) };
}

/** `1748025` printed the way `1.75M` or `212k` is written */
function tokensLike(actual, stated) {
  if (typeof stated !== 'string') return actual;
  const unit = /M$/.test(stated) ? 1e6 : /k$/i.test(stated) ? 1e3 : 1;
  const decimals = (/\.(\d+)/.exec(stated)?.[1] ?? '').length;
  return unit === 1
    ? String(actual)
    : `${(actual / unit).toFixed(decimals)}${unit === 1e6 ? 'M' : 'k'}`;
}

function sameArray(stated, actual) {
  return (
    Array.isArray(stated) &&
    Array.isArray(actual) &&
    stated.length === actual.length &&
    stated.every((value, i) => value === actual[i])
  );
}

/* ---------------------------------------------------------------------------------------------
   the terminal table
   --------------------------------------------------------------------------------------------- */

/**
 * @param {ReturnType<typeof buildScoreboard>} board
 * @returns {string}
 */
export function formatScoreboard(board) {
  const out = [
    'silent mutant — eval scoreboard',
    `${board.arms.length} arms over ${board.runCount} committed run directories under ` +
      `${board.runsDir}/. No model was called: every figure is recomputed from summary.json.`,
    '',
    'primary metric: cases proved in EVERY repetition. Single-run rates stand beside it because',
    'one draw hides the headroom (row 0f). False alarms are printed per repetition, never averaged.',
  ];

  for (const engine of board.engines) {
    out.push(
      '',
      `## ${engine.label} — ${engine.model} — ${engine.role}`,
      `slice: ${engine.slice.label} (${engine.slice.buggy} buggy + ${engine.slice.controls} controls). ` +
        `shipped: ${engine.shipped}.`,
    );

    const ladder = engine.arms.filter((arm) => arm.track === 'ladder');
    const singles = engine.arms.filter((arm) => arm.track === 'single');
    const ablation = engine.arms.filter((arm) => arm.track === 'ablation');

    out.push('', ...armTable(ladder, board));
    if (singles.length > 0) {
      out.push(
        '',
        'measured once, before the engine pins existed — not comparable with the k=3 rows above:',
        ...armTable(singles, board),
      );
    }
    if (ablation.length > 0) {
      out.push(
        '',
        `### stage 3 ablation on ${engine.label} — scored against its own memory-off arm`,
        ...armTable(ablation, board),
      );
    }

    const unanswered = controlNotes(engine);
    if (unanswered.length > 0) out.push('', ...unanswered);

    out.push('', ...caseMatrix(engine));
  }

  out.push('', ...reconciliationBlock(board));
  out.push(
    '',
    `marks: ${Object.entries(MARK)
      .map(([outcome, mark]) => `${mark}=${outcome}`)
      .join('  ')}`,
  );
  return out.join('\n');
}

/** one table of arms, all on one engine and one track, so every column is over one denominator */
function armTable(arms, board) {
  const header = [
    'arm',
    'row',
    'k',
    'single-run',
    'all k',
    'Δ',
    'false alarms',
    'miss',
    'withheld',
    'flip',
    'tokens',
    'cost',
    'wall',
  ];
  const rows = arms.map((arm) => {
    const against = arm.against ? board.arms.find((a) => a.id === arm.against) : null;
    return [
      `${arm.label}${arm.shipped ? ' *' : ''}`,
      arm.row,
      String(arm.k),
      arm.reps.map((r) => `${r.proved}/${r.buggy}`).join(' '),
      arm.k > 1 ? `${arm.allProved}/${arm.buggyCount}` : '—',
      delta(arm, against),
      arm.reps.map((r) => `${r.falseAlarms}/${r.controls}`).join(' '),
      arm.reps.map((r) => r.misses).join(' '),
      arm.reps.map((r) => r.claimUnproved + r.noVerdict).join(' '),
      arm.k > 1 ? String(arm.flips.length) : '—',
      `${(arm.tokens / 1e6).toFixed(2)}M`,
      `$${arm.costUsd.toFixed(4)}`,
      `${(arm.wallMs / 60000).toFixed(1)} min`,
    ];
  });
  const table = plainTable(header, rows);
  const footnotes = [];
  if (arms.some((arm) => arm.shipped)) footnotes.push('* the configuration that ships on this engine');
  footnotes.push('withheld = a buggy case claimed but not proved, or left without a verdict');
  if (arms.some((arm) => arm.k > 1)) {
    // the gap between this and the primary metric is the arm's headroom: a case it can prove and
    // cannot hold. It is what row 0f found and what the k=3 metric exists to expose
    footnotes.push(
      `proved in at least one repetition: ${arms
        .filter((arm) => arm.k > 1)
        .map((arm) => `${arm.label} ${arm.anyProved}/${arm.buggyCount}`)
        .join(', ')}`,
    );
  }
  return [...table, ...footnotes];
}

/** the primary metric against the arm this one is argued against, and never across engines */
function delta(arm, against) {
  if (!against || arm.k < 2) return '—';
  if (against.engine !== arm.engine) throw new Error(`${arm.id} compares across engines`);
  const diff = arm.allProved - against.allProved;
  return `${diff > 0 ? '+' : ''}${diff}`;
}

/**
 * A control that was never answered is not a control that came back correct, and the false-alarm
 * column cannot show the difference: both print as a zero.
 */
function controlNotes(engine) {
  const lines = [];
  for (const arm of engine.arms) {
    for (const rep of arm.reps) {
      for (const record of rep.controlsUnanswered) {
        lines.push(
          `  ${arm.label} ${arm.engine} r${rep.rep}  ${record.id}  ${record.outcome}`,
        );
      }
    }
  }
  if (lines.length === 0) return [];
  return [
    'controls that were never answered — counted in neither column, and a false-alarm rate in',
    'that repetition is over the controls that were:',
    ...lines,
  ];
}

/** every arm of one engine on the same cases, one column each, one character per repetition */
function caseMatrix(engine) {
  const header = ['case', 'kind', ...engine.arms.map((arm) => arm.code)];
  const rows = engine.caseIds.map((id) => {
    const kind = engine.arms[0].outcomes.get(id).kind;
    return [
      id,
      kind,
      ...engine.arms.map((arm) =>
        arm.outcomes
          .get(id)
          .outcomes.map((outcome) => MARK[outcome] ?? '?')
          .join(''),
      ),
    ];
  });
  return [
    `per case, ${engine.label}, one column per arm:`,
    '',
    ...plainTable(header, rows),
    `columns: ${engine.arms.map((arm) => `${arm.code}=${arm.label} (row ${arm.row})`).join('  ')}`,
  ];
}

function reconciliationBlock(board) {
  const { checks, disagreements } = board.reconciliation;
  const lines = [
    '## reconciliation against CHANGELOG.md',
    `${checks.length} figures stated by the rows, recomputed from the runs: ` +
      `${checks.length - disagreements.length} agree, ${disagreements.length} do not.`,
  ];
  if (disagreements.length === 0) {
    lines.push('', 'every number the rows state is the number the committed runs produce.');
    return lines;
  }
  for (const item of disagreements) {
    lines.push(
      '',
      `row ${item.row} · ${item.armLabel} · ${item.label}`,
      `  CHANGELOG says   ${item.stated}`,
      `  the runs say     ${item.actual}`,
    );
  }
  lines.push(
    '',
    'a disagreement is left standing here. The scoreboard is not adjusted to match a row, and a',
    'row is not adjusted to match the scoreboard: the run directories are what both are over.',
  );
  return lines;
}

/** a table sized to its content, two spaces between columns, in the style of `eval/report.mjs` */
function plainTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((row) => row[i].length)));
  const line = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)];
}

function sum(items, read) {
  return items.reduce((total, item) => total + read(item), 0);
}

/* ---------------------------------------------------------------------------------------------
   CLI
   --------------------------------------------------------------------------------------------- */

/** @param {string[]} argv */
export function parseArgs(argv) {
  const options = { runsDir: 'runs', html: 'scoreboard.html' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--runs') options.runsDir = argv[++i];
    else if (arg === '--html') options.html = argv[++i];
    else if (arg === '--no-html') options.html = null;
    else throw new Error(`unknown flag ${arg}. usage: eval/scoreboard.mjs [--runs <dir>] [--html <path>|--no-html]`);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv.slice(2));
  const board = buildScoreboard({ runsDir: options.runsDir });
  process.stdout.write(`${formatScoreboard(board)}\n`);
  if (options.html) {
    writeFileSync(options.html, renderScoreboardPage(board));
    process.stdout.write(`\nwrote ${options.html}\n`);
  }
  if (board.reconciliation.disagreements.length > 0) {
    process.stdout.write(
      `\n${board.reconciliation.disagreements.length} figure(s) disagree with CHANGELOG.md — see above\n`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);

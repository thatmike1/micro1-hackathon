#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join as joinPath } from 'node:path';
import { CASES_DIR } from '../corpus/case-edit.mjs';
import { parseVerdict } from '../eval/verdict.mjs';
import { REVIEW_STYLESHEET } from './render/review-stylesheet.mjs';
import {
  bytes,
  clock,
  count,
  duration,
  esc,
  HALF_MEASURE_COLUMNS,
  join,
  machine,
  particular,
  said,
  stamp,
  tokens,
} from './render/format.mjs';
import { readTrajectory } from './trajectory.mjs';

/**
 * CLI: `node src/render-review-package.mjs <run-dir> <case-id> [-o out.html]`
 *
 * The review package is what a human opens for ONE case: the diff that was under review, the
 * ledger of hypotheses where the run produced one, every gate attempt with both runners' output
 * and their exit codes, what changed in the test between attempts, and the verdict with the test
 * file that proved it. A reviewer should be able to decide whether the answer is trustworthy
 * without opening the JSONL.
 *
 * It is the same book as the trajectory page — same tokens, same three inks, same tipped-in
 * sheets — and it holds to the same rule about what the renderer may put on a page: nothing that
 * is not in the record. Two contracts follow from that here:
 *
 *   - the proof renders only from a `gate-attempt` event with `passed: true`. A claim in a
 *     summary, a confident final answer, or a `proved` scoring outcome never fills that space;
 *     with no passing attempt the rule prints over an empty space and says so.
 *   - what crosses a tipped-in sheet's join is the event key, so every runner tail, test file
 *     and diff on the page names the line of the file it came from.
 *
 * The corpus's own record of the case — what the mutation actually was, and the input that
 * separates the builds — is set apart in its own panel at the end, because it is ground truth
 * the agent never saw and must not read as part of the run.
 */
function main(argv) {
  const args = argv.slice(2);
  const outFlag = args.findIndex((a) => a === '-o' || a === '--out');
  const positional = args.filter(
    (a, index) => !a.startsWith('-') && (outFlag < 0 || index !== outFlag + 1),
  );
  const [runDir, caseId] = positional;
  if (!runDir || !caseId) {
    process.stderr.write(
      'usage: node src/render-review-package.mjs <run-dir> <case-id> -o <out.html>\n',
    );
    process.exit(1);
  }
  const output = outFlag >= 0 ? args[outFlag + 1] : joinPath(runDir, `${caseId}-review.html`);
  const pkg = loadReviewPackage(runDir, caseId);
  writeFileSync(output, renderReviewPackage(pkg));
  process.stdout.write(`rendered ${runDir} ${caseId} -> ${output}\n`);
}

/**
 * Gather everything one case's package is set from: the trajectory, the run summary's row for
 * that case, and the corpus record and diff it was cut from. Only the trajectory is required —
 * a package renders from a bare JSONL, and says which parts of the record were missing.
 *
 * @param {string} runDir a directory holding `<case-id>.jsonl`, and usually `summary.json`
 * @param {string} caseId
 */
export function loadReviewPackage(runDir, caseId) {
  const trajectoryPath = joinPath(runDir, `${caseId}.jsonl`);
  if (!existsSync(trajectoryPath)) throw new Error(`no trajectory for ${caseId} in ${runDir}`);

  const summaryPath = joinPath(runDir, 'summary.json');
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
  const caseDir = joinPath(CASES_DIR, caseId);
  const recordPath = joinPath(caseDir, 'case.json');
  const diffPath = joinPath(caseDir, 'mutation.diff');

  return collectPackage({
    events: readTrajectory(trajectoryPath),
    summary,
    caseRecord: existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : null,
    diff: existsSync(diffPath) ? readFileSync(diffPath, 'utf8') : null,
    runLabel: basename(runDir),
    source: basename(trajectoryPath),
    caseId,
  });
}

/**
 * Read the flat event list, the summary row and the corpus record into the shape the page is set
 * from. Kept separate from both the filesystem and the markup so the assembly can be tested from
 * plain event arrays.
 *
 * Events are keyed by position in the file rather than by `seq`, exactly as the trajectory page
 * keys them: a stage-2 file holds the hypothesizer's run and the prover's run one after the
 * other, and `seq` restarts at the second `run-start`.
 *
 * @param {object} sources
 * @param {object[]} sources.events
 * @param {object|null} [sources.summary] the run's `summary.json`
 * @param {object|null} [sources.caseRecord] the corpus `case.json`
 * @param {string|null} [sources.diff] the corpus `mutation.diff`
 * @param {string} [sources.runLabel] the run directory's name, for the masthead
 * @param {string} [sources.source] the trajectory filename, for the colophon
 * @param {string} [sources.caseId] falls back to the trajectory's own `caseId`
 */
export function collectPackage({
  events,
  summary = null,
  caseRecord = null,
  diff = null,
  runLabel = 'run',
  source = 'trajectory.jsonl',
  caseId,
} = {}) {
  const keyed = events.map((event, index) => ({
    ...event,
    key: `e${String(index).padStart(2, '0')}`,
  }));
  const of = (type) => keyed.filter((e) => e.type === type);
  const starts = of('run-start');
  const ends = of('run-end');
  const id = caseId ?? starts[0]?.caseId ?? 'case';

  const summaryCase = summary?.cases?.find((c) => c.id === id) ?? null;
  const candidate = {
    name: summary?.candidate ?? null,
    model: summary?.model ?? starts[0]?.model ?? null,
  };

  const attempts = of('gate-attempt').map((event, index, all) => ({
    ...event,
    said: textBefore(keyed, event),
    revision: index === 0 ? null : revision(all[index - 1].testFile, event.testFile),
  }));

  const finalText = ends.at(-1)?.result ?? null;
  const parsed = finalText ? parseVerdict(finalText) : { ok: false };
  const verdict = summaryCase?.defect != null
    ? { defect: summaryCase.defect, note: summaryCase.note, from: 'summary.json' }
    : parsed.ok
      ? { defect: parsed.verdict.defect, note: parsed.verdict.note, from: "the run's final answer" }
      : { defect: null, note: null, from: null };

  return {
    caseId: id,
    runLabel,
    source,
    candidate,
    summaryCase,
    caseRecord,
    diff,
    events: keyed,
    runs: starts.map((start, index) => ({ start, end: ends[index] ?? null, index })),
    start: starts[0] ?? {},
    end: ends.at(-1) ?? {},
    ledger: of('ledger').at(-1) ?? null,
    attempts,
    passed: attempts.find((a) => a.passed) ?? null,
    outcome: of('gate-outcome').at(-1) ?? null,
    retries: of('retry'),
    verdict,
    finalText,
    usage: summaryCase?.usage ?? ends.at(-1)?.usage ?? null,
    wallMs: summaryCase?.wallMs ?? ends.reduce((sum, e) => sum + (e.wallMs ?? 0), 0),
  };
}

/** what the agent wrote in the turn that made this submission, if it wrote anything */
function textBefore(keyed, event) {
  const before = keyed.slice(0, keyed.indexOf(event));
  const turn = before.filter((e) => e.type === 'step' && e.step === event.step).at(-1);
  return turn?.text ?? null;
}

/**
 * What changed in the test file between two gate attempts.
 *
 * A revision is usually one or two lines inside a file that is otherwise resubmitted whole, so
 * the unchanged runs between changes are elided down to two lines of context: the reviewer is
 * being shown what the agent did about the gate's complaint, not the file again.
 *
 * @param {string} before the previous attempt's test file
 * @param {string} after this attempt's test file
 * @returns {{lines: {sign: string, text: string}[], added: number, removed: number}}
 */
export function revision(before, after) {
  const lines = elide(diffLines(String(before ?? ''), String(after ?? '')), 2);
  return {
    lines,
    added: lines.filter((l) => l.sign === '+').length,
    removed: lines.filter((l) => l.sign === '-').length,
  };
}

/**
 * A line diff, longest-common-subsequence over lines. The files are single test files, tens of
 * lines at most, so the quadratic table is the right shape for the job.
 *
 * @returns {{sign: ' '|'-'|'+', text: string}[]}
 */
export function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  // common[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const common = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i][j] = a[i] === b[j]
        ? common[i + 1][j + 1] + 1
        : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ sign: ' ', text: a[i] });
      i += 1;
      j += 1;
    } else if (common[i + 1][j] >= common[i][j + 1]) {
      out.push({ sign: '-', text: a[i] });
      i += 1;
    } else {
      out.push({ sign: '+', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) out.push({ sign: '-', text: a[i++] });
  while (j < b.length) out.push({ sign: '+', text: b[j++] });
  return out;
}

/**
 * Replace every run of unchanged lines further than `context` from a change with one printed line
 * saying how many were dropped, so nothing is silently missing.
 *
 * @param {{sign: string, text: string}[]} lines
 * @param {number} context lines of unchanged text kept on each side of a change
 */
function elide(lines, context) {
  const near = lines.map((line, index) =>
    lines.some(
      (other, otherIndex) => other.sign !== ' ' && Math.abs(otherIndex - index) <= context,
    ),
  );
  const out = [];
  let dropped = 0;
  lines.forEach((line, index) => {
    if (line.sign === ' ' && !near[index]) {
      dropped += 1;
      return;
    }
    if (dropped) {
      out.push({ sign: '@', text: `${count(dropped, 'unchanged line')}` });
      dropped = 0;
    }
    out.push(line);
  });
  if (dropped) out.push({ sign: '@', text: `${count(dropped, 'unchanged line')}` });
  return out;
}

/**
 * @param {ReturnType<typeof collectPackage>} pkg
 * @returns {string} a complete HTML document
 */
export function renderReviewPackage(pkg) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review package — ${esc(pkg.caseId)}</title>
<style>
${REVIEW_STYLESHEET}
</style>
</head>
<body>
<main class="leaf">

  <p class="marginal">Fol. 1</p>
  <header class="masthead printed">
    <span>Review package &middot; ${esc(pkg.runLabel)}</span>
    <span>${esc(pkg.start.t ? stamp(pkg.start.t) : 'undated')}</span>
  </header>

  <h1>${esc(pkg.caseId)}</h1>

  ${standfirst(pkg)}

  <p class="marginal at-block">Particulars</p>
  <dl class="particulars">
    ${particular('Candidate', pkg.candidate.name)}
    ${particular('Model', pkg.candidate.model)}
    ${particular('Library', pkg.caseRecord?.library ?? pkg.summaryCase?.library)}
    ${particular('Case', kindLine(pkg))}
    ${particular('Scored', pkg.summaryCase?.outcome)}
    ${particular('Gate', gateLine(pkg))}
    ${particular('Tokens', tokens(pkg.usage))}
    ${particular('Wall time', pkg.wallMs ? duration(pkg.wallMs) : null)}
    ${particular(
      'Cost',
      pkg.usage?.costUsd != null ? `$${pkg.usage.costUsd.toFixed(6)}` : 'not reported',
    )}
    ${particular('Trajectory', pkg.source)}
  </dl>

  <h2><span class="key">&sect; 1</span>The change under review</h2>
  ${changeSection(pkg)}

  <h2><span class="key">&sect; 2</span>Hypothesis ledger</h2>
  ${ledgerSection(pkg)}

  <h2><span class="key">&sect; 3</span>The gate</h2>
  ${gateSection(pkg)}

  <h2><span class="key">&sect; 4</span>Verdict</h2>
  ${verdictSection(pkg)}

  <h2><span class="key">&sect; 5</span>What the corpus records</h2>
  ${corpusSection(pkg)}

  <h2><span class="key">&sect; 6</span>Instructions as issued</h2>
  ${instructionsSection(pkg)}

  <h2><span class="key">&sect; 7</span>Attestation</h2>
  ${attestation(pkg)}

  <div class="legend printed">
    <p><i></i>Attempt that passed the gate</p>
    <p><i class="m-retried"></i>Attempt struck, test revised</p>
    <p><i class="m-failed"></i>Attempt failed, not revised</p>
  </div>

  <p class="marginal at-block">Fol. 1</p>
  <footer class="colophon printed">
    <span>Rendered from ${esc(pkg.runLabel)}/${esc(pkg.source)}</span>
    <span>Fol. 1 of 1</span>
    <span class="note">${esc(tally(pkg))}</span>
  </footer>

</main>
</body>
</html>
`;
}

/** the shape of the review in the written hand: what was claimed, what the gate did about it */
function standfirst(pkg) {
  const claim = pkg.verdict.defect === true
    ? 'A <b>defect was claimed</b>'
    : pkg.verdict.defect === false
      ? 'The change was called an <b>equivalent refactor</b>'
      : 'No parseable verdict was recorded';

  const gate = pkg.passed
    ? ` and <b>proved on gate attempt ${pkg.passed.attempt}${
        pkg.passed.of ? ` of ${pkg.passed.of}` : ''
      }</b>: exit ${pkg.passed.mutant?.code} on the changed checkout, ${
        pkg.passed.pristine?.code
      } on the original.`
    : pkg.attempts.length
      ? `; <b>${count(pkg.attempts.length, 'gate attempt')}</b> ${
          pkg.attempts.length === 1 ? 'was' : 'were'
        } made and none passed.`
      : ' with no gate attempt at all.';

  const ledger = pkg.ledger
    ? pkg.ledger.entries
      ? ` The hypothesizer ranked ${count(pkg.ledger.entries, 'candidate defect')} first.`
      : ' The hypothesizer returned an empty ledger, which is how this candidate asserts an equivalent refactor.'
    : '';

  const resolution = pkg.outcome
    ? ` The run was recorded as <b>${esc(pkg.outcome.resolution)}</b>${
        pkg.outcome.reason ? ` &mdash; ${esc(pkg.outcome.reason)}` : ''
      }.`
    : '';

  // a run that fought the transport is a run whose timings and step count read differently,
  // so the count is stated where it cannot be missed rather than left in the file
  const retried = pkg.retries.length
    ? ` ${count(pkg.retries.length, 'transport retry', 'transport retries')} ${
        pkg.retries.length === 1 ? 'was' : 'were'
      } recorded along the way.`
    : '';

  return `<p class="standfirst">${claim}${gate}${ledger}${resolution}${retried}</p>`;
}

/** the case's kind, as the corpus records it rather than as the run guessed it */
function kindLine(pkg) {
  const kind = pkg.caseRecord?.kind ?? pkg.summaryCase?.kind;
  const category = pkg.caseRecord?.category ?? pkg.summaryCase?.category;
  if (!kind) return null;
  return category ? `${kind} · ${category}` : kind;
}

function gateLine(pkg) {
  if (!pkg.attempts.length) return 'no attempt made';
  const budget = pkg.attempts[0].of;
  const made = `${pkg.attempts.length}${budget ? ` of ${budget}` : ''}`;
  return pkg.passed ? `${made}, passed on ${pkg.passed.attempt}` : `${made}, none passed`;
}

/** § 1 — the diff, tipped in as it was handed to the agent */
function changeSection(pkg) {
  if (!pkg.diff) {
    return absent('No diff is on disk for this case &mdash; the corpus record it was cut from is missing.');
  }
  const file = pkg.caseRecord?.file;
  return `<figure>
    ${diffBlock(pkg.diff.split('\n'))}
    <figcaption>${join(
      'corpus',
    )}<span class="what">mutation.diff${file ? ` &middot; ${esc(file)}` : ''}</span><span class="measure">${bytes(
    pkg.diff,
  )}</span></figcaption>
  </figure>`;
}

/**
 * A diff in the book's correction hand: what went is struck and stays legible, what came stands
 * in its place, and the sign character stays in the text so the reading survives a greyscale
 * print. Accepts raw unified-diff lines or the `{sign, text}` pairs a revision produces.
 *
 * @param {(string|{sign: string, text: string})[]} lines
 */
function diffBlock(lines) {
  const rows = lines.map((line) => {
    const { sign, text } = typeof line === 'string' ? readDiffLine(line) : line;
    if (sign === '@') return `<span class="line meta">&hellip; ${esc(text)}</span>`;
    const kind = sign === '+' ? 'add' : sign === '-' ? 'del' : sign === '#' ? 'meta' : 'ctx';
    const prefix = sign === '#' ? '' : sign;
    return `<span class="line ${kind}">${esc(`${prefix}${text}`) || '&nbsp;'}</span>`;
  });
  return `<pre class="diff">${rows.join('')}</pre>`;
}

/**
 * A source file, set one recorded line per block.
 *
 * Instrument output is hard-wrapped at 48 columns so a soft wrap can never read as a line the
 * instrument emitted. A test file is read as code, where a hard wrap is worse than a soft one:
 * it breaks an expression in a place the author did not. So the lines stay whole and the sheet's
 * own hanging indent shows where the measure ran out.
 */
function source(text) {
  const lines = String(text ?? '').split('\n');
  return `<pre>${lines.map((line) => `<span>${esc(line) || '&nbsp;'}</span>`).join('')}</pre>`;
}

/** classify one line of a unified diff: `#` marks a header, which is printed, not written */
function readDiffLine(line) {
  if (/^(diff |index |--- |\+\+\+ |@@)/.test(line)) return { sign: '#', text: line };
  if (line.startsWith('+')) return { sign: '+', text: line.slice(1) };
  if (line.startsWith('-')) return { sign: '-', text: line.slice(1) };
  return { sign: ' ', text: line.replace(/^ /, '') };
}

/** § 2 — the ranked ledger, or the honest absence of one */
function ledgerSection(pkg) {
  if (!pkg.ledger) {
    return absent(
      'No ledger was recorded: this candidate answers without ranking hypotheses first.',
    );
  }
  const from = `<p class="printed">Ledger read from the ${esc(pkg.ledger.source ?? 'record')} &middot; ${esc(
    pkg.ledger.key,
  )}</p>`;

  if (!pkg.ledger.entries) {
    return `${from}
  <p class="said">The hypothesizer ranked nothing. An empty ledger is this candidate's way of asserting that the change is an equivalent refactor, so the prover was never run and no gate attempt follows.</p>`;
  }

  const entries = (pkg.ledger.hypotheses ?? []).map(
    (h) => `  <div class="hypothesis">
    <p class="printed">Rank ${esc(h.rank)}</p>
${said(h.claim, '    ')}
    <dl class="observation">
      <dt>Input</dt><dd>${esc(h.input ?? 'not recorded')}</dd>
      <dt>Expected</dt><dd>${esc(h.expected ?? 'not recorded')}</dd>
      <dt>Observed</dt><dd>${esc(h.observed ?? 'not recorded')}</dd>
    </dl>
  </div>`,
  );
  return [from, ...entries].join('\n');
}

/** § 3 — every attempt in the order it was made, on one spine */
function gateSection(pkg) {
  if (!pkg.attempts.length) {
    return absent('No gate attempt was recorded: nothing was submitted to be run.');
  }
  return `<div class="chain">
${pkg.attempts.map((attempt, index) => renderAttempt(attempt, index, pkg)).join('\n')}
  </div>`;
}

/**
 * One attempt: what the agent wrote, what it changed since the last attempt, the file it
 * submitted, the two exit codes and both runners' output.
 *
 * The mark struck on the spine is the attempt's own state and nothing else: filled where the
 * gate passed, open square where it failed and the agent revised, open circle where it failed
 * and nothing followed.
 */
function renderAttempt(attempt, index, pkg) {
  const revised = !attempt.passed && index < pkg.attempts.length - 1;
  const mark = attempt.passed ? '' : revised ? ' retried' : ' failed';

  const head = `      <p class="printed step-head"><span>Gate attempt ${esc(attempt.attempt)}${
    attempt.of ? ` of ${esc(attempt.of)}` : ''
  } &middot; ${attempt.passed ? 'passed' : 'failed'}</span><span>${esc(
    attempt.t ? clock(attempt.t) : '',
  )}</span></p>`;

  const revisionBlock = attempt.revision
    ? `      <p class="trim"><span class="correction">Revised</span> ${esc(
        `${count(attempt.revision.added, 'line')} written, ${
          attempt.revision.removed
        } struck since attempt ${attempt.attempt - 1}`,
      )}</p>
      <figure>
        ${diffBlock(attempt.revision.lines)}
        <figcaption>${join(attempt.key)}<span class="what">Revision &middot; attempt ${esc(
          attempt.attempt - 1,
        )} to ${esc(attempt.attempt)}</span><span class="measure"></span></figcaption>
      </figure>`
    : '';

  const test = `      <figure>
        ${source(attempt.testFile)}
        <figcaption>${join(attempt.key)}<span class="what">${esc(
          attempt.path ?? 'test file',
        )} &middot; submitted</span><span class="measure">${bytes(attempt.testFile)}</span></figcaption>
      </figure>`;

  const command = attempt.command
    ? `      <p class="call"><span class="key">Run</span><code>${esc(attempt.command)}</code></p>`
    : '';

  return `    <p class="marginal"><span>Attempt</span><br><span>${esc(attempt.attempt)}</span></p>
    <div class="step${mark}">
${[head, said(attempt.said), revisionBlock, test, command, codes(attempt), runners(attempt)]
  .filter((fragment) => fragment !== '')
  .join('\n')}
    </div>`;
}

/** the exit-code pair, which is the whole of what the gate decided */
function codes(attempt) {
  const row = (what, side) =>
    `      <p class="what">${what}</p><p class="code">exit ${esc(side?.code ?? '?')} &middot; ${
      side?.code === 0 ? 'passed' : 'failed'
    }</p><p class="took">${side?.ms != null ? esc(duration(side.ms)) : ''}</p>`;
  return `      <div class="codes">
${row('Changed checkout', attempt.mutant)}
${row('Original checkout', attempt.pristine)}
      </div>`;
}

/** both runners' output, side by side, because one tail is never the evidence */
function runners(attempt) {
  // the two sheets sit in half the measure each, so their output is broken to match: a tail
  // wrapped for the full measure would soft-wrap again here and read as lines it never emitted
  const sheet = (what, side) => `        <figure>
          ${machine(plain(side?.tail) || '(no output)', HALF_MEASURE_COLUMNS)}
          <figcaption>${join(attempt.key)}<span class="what">${what}</span><span class="measure">exit ${esc(
            side?.code ?? '?',
          )}</span></figcaption>
        </figure>`;
  return `      <div class="runners">
${sheet('Changed', attempt.mutant)}
${sheet('Original', attempt.pristine)}
      </div>`;
}

/**
 * Instrument output as it reads on a terminal that never had colour. Mocha and `node --test`
 * write SGR escapes into the tails the gate records; escaped verbatim into HTML they print as
 * control characters, so the escapes come out and nothing else does.
 */
function plain(text) {
  return String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * § 4 — the verdict, and the test that stands behind it.
 *
 * The proof renders only from a gate attempt that passed. Where none did, the space prints empty
 * under its rule: a claim, however confident, is not a proof on this page.
 */
function verdictSection(pkg) {
  const stated = pkg.verdict.defect == null
    ? '<p class="printed">No parseable verdict was recorded</p>'
    : `<p class="printed">Answered ${
        pkg.verdict.defect ? 'defect' : 'equivalent refactor'
      } &middot; read from ${esc(pkg.verdict.from)}</p>`;
  const note = said(pkg.verdict.note, '  ');

  if (!pkg.passed) {
    return [
      stated,
      note,
      absent(
        pkg.attempts.length
          ? `Nothing on this page proves the claim: ${count(
              pkg.attempts.length,
              'attempt was',
              'attempts were',
            )} made and none passed the gate.`
          : 'No test was submitted, so there is nothing here to check.',
      ),
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    stated,
    note,
    `  <p class="printed">Proved by gate attempt ${esc(pkg.passed.attempt)} &middot; ${esc(
      pkg.passed.key,
    )}</p>
  <figure>
    ${source(pkg.passed.testFile)}
    <figcaption>${join(pkg.passed.key)}<span class="what">${esc(
      pkg.passed.path ?? 'test file',
    )} &middot; the test that passed</span><span class="measure">${bytes(
      pkg.passed.testFile,
    )}</span></figcaption>
  </figure>
  <p class="call"><span class="key">Run</span><code>${esc(pkg.passed.command ?? '')}</code></p>
${codes(pkg.passed)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * § 5 — what the corpus knows, which the agent did not. It is set inside its own panel so a
 * reviewer reading quickly can never take it for something the run produced.
 */
function corpusSection(pkg) {
  const record = pkg.caseRecord;
  if (!record) return absent('No corpus record is on disk for this case.');
  const mutation = record.mutation ?? {};
  const at = mutation.location?.start
    ? `${record.file}:${mutation.location.start.line}:${mutation.location.start.column}`
    : record.file;
  return `<p class="printed">Ground truth &middot; not shown to the agent</p>
  <div class="corpus">
    <dl class="observation">
      <dt>Kind</dt><dd>${esc(record.kind)}${record.category ? ` · ${esc(record.category)}` : ''}</dd>
      <dt>At</dt><dd>${esc(at)}</dd>
      <dt>Mutator</dt><dd>${esc(mutation.mutator ?? 'not recorded')}</dd>
      <dt>Was</dt><dd>${esc(mutation.original ?? '')}</dd>
      <dt>Is</dt><dd>${esc(mutation.replacement ?? '')}</dd>
      <dt>Input</dt><dd>${esc(record.distinguishingInput ?? 'none — this case is a control')}</dd>
      <dt>Original</dt><dd>${esc(record.expected?.pristine ?? 'no divergence recorded')}</dd>
      <dt>Changed</dt><dd>${esc(record.expected?.mutant ?? 'no divergence recorded')}</dd>
    </dl>
${said(record.note, '    ')}
  </div>`;
}

/** § 6 — what each run in the file was told, verbatim, deduplicated where two runs share it */
function instructionsSection(pkg) {
  const seen = new Set();
  const sheets = pkg.runs
    .map(({ start, index }) => {
      const text = start.instructions ?? '';
      if (!text || seen.has(text)) return '';
      seen.add(text);
      const role = pkg.runs.length > 1 ? ` &middot; run ${index + 1} of ${pkg.runs.length}` : '';
      return `<figure>
    ${machine(text)}
    <figcaption>${join(start.key)}<span class="what">Instructions as issued${role}</span><span class="measure">${
      text.length
    } chars</span></figcaption>
  </figure>`;
    })
    .filter(Boolean);
  if (!sheets.length) return absent('No instructions were recorded with this run.');
  return sheets.join('\n  ');
}

/**
 * The foot of the page. `Recorded by` names the apparatus that kept the record. `Proved by` is
 * filled only from a gate attempt that passed, and states the two exit codes rather than an
 * opinion; with no such attempt the rule prints over an empty space and says why.
 */
function attestation(pkg) {
  const passed = pkg.passed;
  return `<section class="attest">
    <div>
      <div class="sign"><p class="hand machine">${esc(
        pkg.candidate.model ?? 'model not recorded',
      )}</p></div>
      <p class="printed">Recorded by &middot; ${esc(
        pkg.candidate.name ?? 'agent loop',
      )}, unattended</p>
    </div>
    <div>
      <div class="sign${passed ? ' stamped' : ''}">${
        passed
          ? `<p class="hand"><span class="stamp">Gate passed &middot; exit ${esc(
              passed.mutant?.code,
            )}/${esc(passed.pristine?.code)} &middot; ${esc(passed.key)}</span></p>`
          : ''
      }</div>
      <p class="printed">${
        passed
          ? `Proved by &middot; attempt ${esc(passed.attempt)} &middot; ${esc(clock(passed.t))}`
          : 'Proved by &mdash; no gate attempt passed in this run'
      }</p>
    </div>
  </section>`;
}

/** an empty space closed by a rule, saying what is not in the record */
function absent(what) {
  return `  <p class="absent printed">${what}</p>`;
}

/** the colophon's count: what the page is made of, so nothing can be dropped unnoticed */
function tally(pkg) {
  const range = pkg.events.length
    ? `${pkg.events[0].key}–${pkg.events.at(-1).key}`
    : 'none';
  const runs = pkg.runs.length > 1 ? `; ${pkg.runs.length} runs in this file` : '';
  const attempts = `; ${count(pkg.attempts.length, 'gate attempt')}`;
  const missing = [
    pkg.diff ? '' : 'no diff',
    pkg.caseRecord ? '' : 'no corpus record',
    pkg.summaryCase ? '' : 'no summary row',
  ].filter(Boolean);
  const gaps = missing.length ? `; ${missing.join(', ')}` : '';
  return `${count(pkg.events.length, 'event')} recorded, ${range}, unbroken${runs}${attempts}${gaps}`;
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);

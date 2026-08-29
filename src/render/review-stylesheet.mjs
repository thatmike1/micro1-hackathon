import { STYLESHEET } from './stylesheet.mjs';

/**
 * The review package's sheet: the trajectory page's own sheet, plus the few shapes a per-case
 * review needs that a trajectory has none for.
 *
 * It composes rather than forks. `STYLESHEET` already carries the design system's `tokens.css`
 * inlined verbatim between its BEGIN/END markers and the document rules that read through it, so
 * the runtime still restyles both artifacts by regenerating that one block. Nothing below
 * introduces a value of its own: every colour, rule, space and face is a token.
 */

/** what the review page adds to the book */
const REVIEW = String.raw`

/* ======================================================================
   THE REVIEW PACKAGE
   The per-case leaf a human opens to decide whether one answer is
   trustworthy. Same book, same three inks: the rules below add only a
   diff, a ranked ledger, and the two runners read side by side. Nothing
   here encodes state by hue — a removed line is struck, an added line
   stands, and both survive a greyscale print.
   ====================================================================== */

/* a diff, set the way the book corrects itself: what went is struck and
   left legible, what came stands in its place. The sign character stays
   in the text, so the reading holds with no colour at all. */
.diff .line {
  display: block;
  padding-left: 3ch;
  text-indent: -3ch;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.diff .ctx { color: var(--ink-record-soft); }
.diff .add { color: var(--ink-machine); }
.diff .del {
  color: var(--ink-record-soft);
  text-decoration: line-through var(--rule-weight) var(--ink-correct);
  text-decoration-skip-ink: none;
}
/* file and hunk headers are a diff's printed apparatus, not its content */
.diff .meta { color: var(--ink-print); }

/* the two runners, read together: one exit code is not evidence, the pair
   is. They sit in one row where there is width for both, and stack where
   there is not. */
.runners {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: var(--space-1);
  margin-top: var(--space-1);
}
.runners > figure { margin-top: 0; }

/* the exit-code pair itself, set as the measurement it is: what the gate
   decided is these two numbers and nothing else on the page says
   otherwise */
.codes {
  margin: var(--space-1) 0 0;
  border-top: var(--rule-weight) solid var(--rule-print);
  border-bottom: var(--rule-weight) solid var(--rule-print);
  display: grid;
  grid-template-columns: 1fr auto auto;
  column-gap: var(--space-1);
  align-items: baseline;
}
.codes > * {
  padding: calc(var(--space-h) - 1px) 0 var(--space-h);
  border-bottom: var(--rule-weight) solid var(--rule-feint);
}
.codes > :nth-last-child(-n+3) { border-bottom: 0; }
.codes .what {
  font: var(--weight-print) var(--size-apparatus)/var(--lead) var(--font-print);
  letter-spacing: var(--track-apparatus);
  text-transform: uppercase;
  color: var(--ink-print);
  margin: 0;
}
.codes .code, .codes .took {
  margin: 0;
  font-family: var(--font-machine);
  font-size: var(--size-machine);
  line-height: var(--lead);
  color: var(--ink-machine);
  font-variant-numeric: lining-nums tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.codes .took { color: var(--ink-print); }

/* one ranked hypothesis: the claim in the written hand, then the three
   machine fields it stands or falls on, ruled like a field on a form */
.hypothesis { margin-top: var(--space-1); }
.hypothesis + .hypothesis {
  border-top: var(--rule-weight) solid var(--rule-print);
  padding-top: calc(var(--space-1) - 1px);
}
/* the key column is set from the longest label rather than a fixed width: these labels are
   the field names of the record, and a clipped one would run into its own value */
.observation {
  margin: var(--space-h) 0 0;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: var(--space-1);
  row-gap: 0;
}
.observation dt {
  font: var(--weight-print) var(--size-apparatus)/var(--lead) var(--font-print);
  letter-spacing: var(--track-apparatus);
  text-transform: uppercase;
  color: var(--ink-print);
}
.observation dd {
  margin: 0;
  font-family: var(--font-machine);
  font-size: var(--size-machine);
  line-height: var(--lead);
  color: var(--ink-machine);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

/* what was never recorded prints as an empty space closed by a rule and
   labelled, the way an unwitnessed signature line does: the page does not
   fill a gap in the record with prose of its own */
.absent {
  margin-top: var(--space-1);
  border-top: var(--rule-weight) solid var(--rule-print);
  padding-top: calc(var(--space-h) - 1px);
}

/* the ground truth the corpus holds, set apart from everything the run
   produced: an inset panel, tipped in like an instrument's sheet, so a
   reader cannot mistake it for something the agent was told */
.corpus {
  margin-top: var(--space-1);
  background: var(--paper-inset);
  border: var(--box-border);
  padding: var(--box-pad);
}
.corpus > :first-child { margin-top: 0; }
.corpus .observation { margin-top: var(--space-h); }
.corpus figure { border: 0; padding: 0; background: none; }

@media (max-width: 800px) {
  /* the masthead carries a run directory and a date, both set nowrap: at phone width the
     pair is wider than the page, so the two run onto their own lines instead of pushing
     the document sideways */
  .masthead { flex-wrap: wrap; }
  /* the ledger's key column would squeeze its values to two characters */
  .observation { grid-template-columns: minmax(0, 1fr); }
  .codes { grid-template-columns: 1fr auto; }
  .codes .took { display: none; }
}
`;

/** the complete inline sheet for one emitted review package */
export const REVIEW_STYLESHEET = STYLESHEET + REVIEW;

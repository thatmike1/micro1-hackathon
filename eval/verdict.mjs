/**
 * A candidate's answer, parsed out of its final message.
 *
 * @typedef {object} Verdict
 * @property {boolean} defect whether the candidate says the change breaks observable behaviour
 * @property {{path: string, content: string}|null} testFile the proof it offers, if any
 * @property {string} note its own one-line justification, carried into the summary
 */

/**
 * Pull the verdict object out of a model's final message.
 *
 * Models put the JSON in a fenced block, or after prose, or as the whole message; all three are
 * accepted. Failure to parse is returned rather than thrown, because "the candidate did not
 * answer in the contracted shape" is a result worth scoring, not a crash.
 *
 * @param {string|null} text
 * @returns {{ok: true, verdict: Verdict} | {ok: false, error: string}}
 */
export function parseVerdict(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'empty answer' };

  for (const candidate of jsonCandidates(text)) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || !('defect' in parsed)) continue;
    return { ok: true, verdict: normalise(parsed) };
  }
  return { ok: false, error: 'no JSON object with a "defect" field in the answer' };
}

/**
 * Every plausible JSON payload in `text`, most-likely first: fenced blocks last-to-first, then
 * brace-balanced spans starting at each `{`, also last-to-first. Both orderings prefer the
 * latest payload, so a model that reasons in JSON before writing its verdict is read as
 * verdict-last rather than verdict-first.
 * @param {string} text
 */
function* jsonCandidates(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const fenced of fences.reverse()) yield fenced;

  const starts = [];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '{') starts.push(i);
  for (const start of starts.reverse()) {
    const end = matchingBrace(text, start);
    if (end !== -1) yield text.slice(start, end + 1);
  }
}

/** index of the `}` closing the `{` at `start`, respecting strings and escapes; -1 if unbalanced */
function matchingBrace(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** @returns {Verdict} */
function normalise(parsed) {
  const file = parsed.testFile ?? parsed.test_file ?? null;
  const content = typeof file?.content === 'string' ? file.content : null;
  return {
    defect: parsed.defect === true || parsed.defect === 'true',
    testFile: content ? { path: String(file.path ?? ''), content } : null,
    note: typeof parsed.note === 'string' ? parsed.note : '',
  };
}

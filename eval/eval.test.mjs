import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadCases } from '../corpus/case-edit.mjs';
import { capture } from '../corpus/exec.mjs';
import { pristineEntry } from '../corpus/libraries.mjs';
import { formatReport } from './report.mjs';
import { classify, totals } from './score.mjs';
import { parseVerdict } from './verdict.mjs';
import { formatGate, run as runStage1, settle } from './candidates/stage-1.mjs';
import { run as runStage2, settle as settleStage2 } from './candidates/stage-2.mjs';
import { isInside, materialiseTest, prepareCase, proofRunner } from './workspace.mjs';

describe('verdict parsing', () => {
  it('reads a fenced verdict after prose', () => {
    const parsed = parseVerdict(
      'Looks wrong to me.\n\n```json\n{"defect": true, "testFile": {"path": "p.js", "content": "x"}, "note": "n"}\n```',
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.verdict.defect, true);
    assert.deepEqual(parsed.verdict.testFile, { path: 'p.js', content: 'x' });
  });

  it('reads a bare object and treats a missing test file as none', () => {
    const parsed = parseVerdict('{"defect": false, "note": "equivalent"}');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.verdict.defect, false);
    assert.equal(parsed.verdict.testFile, null);
  });

  it('takes the last fenced block when the answer shows an example first', () => {
    const parsed = parseVerdict(
      '```json\n{"defect": true, "note": "the shape"}\n```\nActually:\n```json\n{"defect": false, "note": "final"}\n```',
    );
    assert.equal(parsed.verdict.note, 'final');
  });

  it('survives braces inside the test source', () => {
    const content = 'if (a) { b({ c: "}" }) }';
    const parsed = parseVerdict(
      `\`\`\`json\n${JSON.stringify({ defect: true, testFile: { path: 'p.js', content }, note: '' })}\n\`\`\``,
    );
    assert.equal(parsed.verdict.testFile.content, content);
  });

  it('reports an unusable answer rather than throwing', () => {
    assert.equal(parseVerdict('I could not decide.').ok, false);
    assert.equal(parseVerdict('').ok, false);
    assert.equal(parseVerdict(null).ok, false);
  });
});

describe('scoring', () => {
  const withTest = { defect: true, testFile: { path: 'p', content: 'x' }, note: '' };
  const clean = { defect: false, testFile: null, note: '' };

  it('proves a buggy case only on red mutant and green pristine', () => {
    assert.equal(classify('buggy', withTest, { proved: true }), 'proved');
    assert.equal(classify('buggy', withTest, { proved: false }), 'claim-unproved');
    assert.equal(classify('buggy', { ...withTest, testFile: null }, null), 'claim-unproved');
    assert.equal(classify('buggy', clean, null), 'miss');
  });

  it('treats any defect claim on a control as a false alarm', () => {
    assert.equal(classify('control', withTest, { proved: true }), 'false-alarm');
    assert.equal(classify('control', clean, null), 'correct');
  });

  it('totals count only what each metric is over', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.001 };
    const results = [
      { kind: 'buggy', outcome: 'proved', usage, wallMs: 1000 },
      { kind: 'buggy', outcome: 'miss', usage, wallMs: 1000 },
      { kind: 'control', outcome: 'false-alarm', usage, wallMs: 1000 },
      { kind: 'control', outcome: 'correct', usage, wallMs: 1000 },
    ];
    const t = totals(results);
    assert.equal(t.proved, 1);
    assert.equal(t.buggy, 2);
    assert.equal(t.proofRate, 0.5);
    assert.equal(t.falseAlarms, 1);
    assert.equal(t.usage.totalTokens, 60);
    assert.equal(Number(t.usage.costUsd.toFixed(6)), 0.004);
  });

  it('renders a report from a summary', () => {
    const summary = {
      candidate: 'stub',
      description: 'd',
      model: 'm',
      wallMs: 60_000,
      cases: [
        {
          id: 'ms-12',
          kind: 'buggy',
          outcome: 'proved',
          defect: true,
          wallMs: 1000,
          usage: { totalTokens: 15, costUsd: 0.001 },
          proof: { proved: true, mutant: { code: 1 }, pristine: { code: 0 } },
        },
      ],
      totals: totals([
        {
          kind: 'buggy',
          outcome: 'proved',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.001 },
          wallMs: 1000,
        },
      ]),
    };
    const report = formatReport(summary);
    assert.match(report, /proof rate\s+1\/1 \(100%\)/);
    assert.match(report, /red\/green 1\/0/);
  });
});

describe('checkout sandbox', () => {
  it('admits paths under a root and rejects everything else', () => {
    assert.equal(isInside('/tmp/case/mutant/index.js', ['/tmp/case/mutant']), true);
    assert.equal(isInside('/tmp/case/mutant', ['/tmp/case/mutant']), true);
    assert.equal(isInside('/tmp/case/mutant/../../etc', ['/tmp/case/mutant']), false);
    assert.equal(isInside('/tmp/case/mutant-other/x', ['/tmp/case/mutant']), false);
  });
});

// the double-run gate against a real checkout; skipped until `npm run corpus:setup` has run
describe('double-run gate', { skip: !existsSync(pristineEntry('ms')) }, () => {
  it('scores a real test red on the mutant and green on pristine', async () => {
    const record = loadCases().find((c) => c.id === 'ms-12');
    const workspace = await prepareCase(record);
    try {
      const pristineSource = readFileSync(pristineEntry('ms'), 'utf8');
      assert.equal(readFileSync(join(workspace.pristine, 'index.js'), 'utf8'), pristineSource);
      assert.notEqual(readFileSync(join(workspace.mutant, 'index.js'), 'utf8'), pristineSource);

      const runner = proofRunner('ms');
      const content = [
        "var assert = require('assert');",
        "var ms = require('./');",
        "describe('proof', function () {",
        "  it('keeps its own error message for non-strings', function () {",
        '    assert.throws(function () { ms(null); }, /val is not a non-empty string/);',
        '  });',
        '});',
      ].join('\n');

      const codes = {};
      for (const side of ['mutant', 'pristine']) {
        materialiseTest(workspace[side], runner, content);
        codes[side] = capture(runner.command, workspace[side], { timeoutMs: 60_000 }).code;
      }
      assert.notEqual(codes.mutant, 0);
      assert.equal(codes.pristine, 0);
    } finally {
      workspace.cleanup();
    }
  });
});

describe('stage 1 gate', () => {
  const runner = proofRunner('ms');
  const trace = () => {
    const written = [];
    return { events: written, written, write: (type, payload) => written.push({ type, ...payload }) };
  };
  const gate = (mutantCode, pristineCode) => ({
    path: runner.path,
    command: runner.command,
    mutant: { code: mutantCode, ms: 1, tail: 'mutant output' },
    pristine: { code: pristineCode, ms: 1, tail: 'pristine output' },
    proved: mutantCode !== 0 && pristineCode === 0,
  });

  it('names the failure shape rather than just repeating the exit codes', () => {
    assert.match(formatGate(1, gate(0, 0)), /Green on both/);
    assert.match(formatGate(1, gate(1, 1)), /Red on both/);
    assert.match(formatGate(1, gate(0, 1)), /Backwards/);
    assert.match(formatGate(1, gate(1, 0)), /GATE PASSED/);
  });

  it('returns both runner outputs and the attempts left on a failure', () => {
    const text = formatGate(2, gate(0, 0));
    assert.match(text, /attempt 2 of 4\. 2 attempt\(s\) left/);
    assert.match(text, /mutant output/);
    assert.match(text, /pristine output/);
  });

  it('answers a defect with the exact test that passed the gate', () => {
    const t = trace();
    const attempts = [
      { attempt: 1, passed: false, content: 'bad', result: gate(0, 0) },
      { attempt: 2, passed: true, content: 'good', result: gate(1, 0) },
    ];
    const settled = settle({ text: 'prose only', stopReason: 'final' }, attempts, runner, t);
    const verdict = parseVerdict(settled.text).verdict;
    assert.equal(verdict.defect, true);
    assert.equal(verdict.testFile.content, 'good');
    assert.deepEqual(t.written, [
      { type: 'gate-outcome', resolution: 'proved', attempts: 2, passedOn: 2 },
    ]);
  });

  it('lets a clean answer stand untouched when the gate was never passed', () => {
    const t = trace();
    const answer = { text: '{"defect": false, "note": "equivalent"}', stopReason: 'final' };
    const settled = settle(answer, [], runner, t);
    assert.equal(settled.text, answer.text);
    assert.equal(t.written[0].resolution, 'clean');
  });

  it('withholds a defect claim that never passed the gate, so it scores no-verdict', () => {
    const t = trace();
    const attempts = [1, 2, 3, 4].map((attempt) => ({
      attempt,
      passed: false,
      content: 'x',
      result: gate(0, 0),
    }));
    const answer = { text: '{"defect": true, "testFile": {"path": "p", "content": "x"}}' };
    const settled = settle(answer, attempts, runner, t);
    assert.equal(parseVerdict(settled.text).ok, false);
    assert.equal(t.written[0].resolution, 'withheld');
    assert.equal(t.written[0].attempts, 4);
  });

  it('passes a transport error through, so it scores error rather than no-verdict', () => {
    const t = trace();
    const answer = { text: '', stopReason: 'error', error: 'HTTP 502 after 4 retries' };
    const attempts = [{ attempt: 1, passed: false, content: 'x', result: gate(0, 0) }];
    const settled = settle(answer, attempts, runner, t);
    assert.equal(settled, answer);
    assert.equal(settled.stopReason, 'error');
    assert.equal(settled.error, 'HTTP 502 after 4 retries');
    assert.deepEqual(t.written, []);
  });
});

// the whole prover loop against a real checkout with a scripted model: a test that does not
// separate the builds, the gate's rejection, then a test that does
describe('stage 1 prover loop', { skip: !existsSync(pristineEntry('ms')) }, () => {
  it('rejects a non-separating test, accepts the revision, and logs both attempts', async () => {
    const record = loadCases().find((c) => c.id === 'ms-4');
    const workspace = await prepareCase(record);
    const events = [];
    const trajectory = { events, write: (type, payload) => events.push({ type, ...payload }) };

    const proof = (assertion) =>
      [
        "var assert = require('assert');",
        "var ms = require('./');",
        "describe('proof', function () {",
        "  it('checks a year', function () {",
        `    ${assertion}`,
        '  });',
        '});',
      ].join('\n');
    const submissions = [
      proof("assert.equal(ms('1s'), 1000);"),
      proof("assert.equal(ms('1y'), 31557600000);"),
    ];
    let turn = 0;

    const transport = async () => {
      turn += 1;
      const message =
        turn <= submissions.length
          ? {
              content: null,
              tool_calls: [
                {
                  id: `call-${turn}`,
                  type: 'function',
                  function: {
                    name: 'submit-proof',
                    arguments: JSON.stringify({ content: submissions[turn - 1] }),
                  },
                },
              ],
            }
          : { content: '```json\n{"defect": true, "note": "year constant divided"}\n```' };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }),
      };
    };

    try {
      const answer = await runStage1({ record, workspace, trajectory, model: 'mock', transport });
      const gates = events.filter((e) => e.type === 'gate-attempt');
      assert.deepEqual(
        gates.map((g) => g.passed),
        [false, true],
      );
      assert.equal(gates[0].mutant.code, 0, 'the non-separating test passes on the mutant too');
      assert.notEqual(gates[1].mutant.code, 0);
      assert.equal(gates[1].pristine.code, 0);

      const verdict = parseVerdict(answer.text).verdict;
      assert.equal(verdict.defect, true);
      assert.equal(verdict.testFile.content, submissions[1]);
      assert.equal(verdict.note, 'year constant divided');
      assert.equal(events.at(-1).resolution, 'proved');
      assert.equal(events.at(-1).passedOn, 2);
    } finally {
      workspace.cleanup();
    }
  });
});

describe('stage 2 settle', () => {
  const runner = proofRunner('ms');
  const trace = () => {
    const written = [];
    return { events: written, written, write: (type, payload) => written.push({ type, ...payload }) };
  };
  const gate = (mutantCode, pristineCode) => ({
    path: runner.path,
    command: runner.command,
    mutant: { code: mutantCode, ms: 1, tail: 'mutant output' },
    pristine: { code: pristineCode, ms: 1, tail: 'pristine output' },
    proved: mutantCode !== 0 && pristineCode === 0,
  });
  const entry = (claim) => ({ claim, input: 'ms("1y")', expected: 'a', observed: 'b' });

  it('answers a defect with the test that passed and names the hypothesis it came from', () => {
    const t = trace();
    const attempts = [
      { attempt: 1, hypothesis: 1, passed: false, content: 'bad', result: gate(0, 0) },
      { attempt: 2, hypothesis: 1, passed: false, content: 'worse', result: gate(1, 1) },
      { attempt: 3, hypothesis: 2, passed: true, content: 'good', result: gate(1, 0) },
    ];
    const settled = settleStage2({
      answer: { text: 'prose only', stopReason: 'final' },
      attempts,
      ledger: [entry('first'), entry('second')],
      runner,
      trajectory: t,
    });
    const verdict = parseVerdict(settled.text).verdict;
    assert.equal(verdict.defect, true);
    assert.equal(verdict.testFile.content, 'good');
    assert.equal(t.written[0].resolution, 'proved');
    assert.equal(t.written[0].hypothesis, 2);
    assert.equal(t.written[0].passedOn, 3);
  });

  it('answers clean on an empty ledger, without ever reaching the gate', () => {
    const t = trace();
    const settled = settleStage2({
      answer: { text: 'nothing observable changes here', stopReason: 'final' },
      attempts: [],
      ledger: [],
      runner,
      trajectory: t,
    });
    assert.equal(parseVerdict(settled.text).verdict.defect, false);
    assert.equal(t.written[0].resolution, 'clean');
    assert.equal(t.written[0].via, 'empty-ledger');
    assert.equal(t.written[0].attempts, 0);
  });

  it('withholds when no ledger arrived at all, rather than reading silence as clean', () => {
    const t = trace();
    const settled = settleStage2({
      answer: { text: '', stopReason: 'max-steps' },
      attempts: [],
      ledger: [],
      ledgered: false,
      runner,
      trajectory: t,
    });
    assert.equal(parseVerdict(settled.text).ok, false);
    assert.equal(t.written[0].resolution, 'withheld');
    assert.equal(t.written[0].reason, 'the hypothesizer recorded no ledger');
  });

  it("lets the last prover's clean answer stand untouched", () => {
    const t = trace();
    const answer = { text: '{"defect": false, "note": "hypothesis was wrong"}', stopReason: 'final' };
    const settled = settleStage2({ answer, attempts: [], ledger: [entry('only')], runner, trajectory: t });
    assert.equal(settled.text, answer.text);
    assert.equal(t.written[0].via, 'prover');
  });

  it('withholds a defect claim that never passed the gate, so it scores no-verdict', () => {
    const t = trace();
    const attempts = [1, 2, 3, 4].map((attempt) => ({
      attempt,
      hypothesis: attempt <= 2 ? 1 : 2,
      passed: false,
      content: 'x',
      result: gate(0, 0),
    }));
    const answer = { text: '{"defect": true, "testFile": {"path": "p", "content": "x"}}' };
    const settled = settleStage2({
      answer,
      attempts,
      ledger: [entry('first'), entry('second')],
      runner,
      trajectory: t,
    });
    assert.equal(parseVerdict(settled.text).ok, false);
    assert.equal(t.written[0].resolution, 'withheld');
    assert.equal(t.written[0].attempts, 4);
  });

  it('passes a transport error through, so it scores error rather than no-verdict', () => {
    const t = trace();
    const answer = { text: '', stopReason: 'error', error: 'HTTP 502 after 4 retries' };
    const settled = settleStage2({
      answer,
      attempts: [],
      ledger: [entry('first')],
      runner,
      trajectory: t,
    });
    assert.equal(settled, answer);
    assert.equal(settled.stopReason, 'error');
    assert.equal(settled.error, 'HTTP 502 after 4 retries');
    assert.deepEqual(t.written, []);
  });
});

// the whole split against a real checkout with a scripted model: a ledger whose first entry is
// wrong, two attempts spent on it, then the second entry proved
describe('stage 2 hypothesizer/prover split', { skip: !existsSync(pristineEntry('ms')) }, () => {
  it('abandons a hypothesis when its attempts are spent and proves the next one', async () => {
    const record = loadCases().find((c) => c.id === 'ms-4');
    const workspace = await prepareCase(record);
    const events = [];
    const trajectory = { events, write: (type, payload) => events.push({ type, ...payload }) };

    const proof = (assertion) =>
      [
        "var assert = require('assert');",
        "var ms = require('./');",
        "describe('proof', function () {",
        "  it('checks a year', function () {",
        `    ${assertion}`,
        '  });',
        '});',
      ].join('\n');
    // hypothesis 1 gets two tests that do not separate the builds; hypothesis 2 gets one that does
    const submissions = [
      proof("assert.equal(ms('1s'), 1000);"),
      proof("assert.equal(ms('2s'), 2000);"),
      proof("assert.equal(ms('1y'), 31557600000);"),
    ];
    const ledger = {
      hypotheses: [
        { claim: 'seconds are mis-parsed', input: "ms('1s')", expected: '1000', observed: 'something else' },
        { claim: 'the year constant is wrong', input: "ms('1y')", expected: '31557600000', observed: 'half that' },
      ],
    };

    // what the scripted prover offers per ledger rank: two dead ends on the first, the real
    // separator on the second
    const perRank = { 1: [submissions[0], submissions[1]], 2: [submissions[2]] };
    const sent = { 1: 0, 2: 0 };
    let turn = 0;
    const call = (name, args) => ({
      content: null,
      tool_calls: [{ id: `c${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    });
    const transport = async (url, init) => {
      turn += 1;
      const body = JSON.parse(init.body);
      const tools = body.tools.map((t) => t.function.name);
      let message;
      if (tools.includes('record-ledger')) {
        message = body.messages.some((m) => m.role === 'tool')
          ? { content: 'ledger recorded' }
          : call('record-ledger', ledger);
      } else {
        const rank = Number(/You are working hypothesis (\d+)/.exec(body.messages[1].content)?.[1]);
        message =
          sent[rank] < perRank[rank].length
            ? call('submit-proof', { content: perRank[rank][sent[rank]++] })
            : { content: '```json\n{"defect": true, "note": "year constant divided"}\n```' };
      }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }) };
    };

    try {
      const answer = await runStage2({ record, workspace, trajectory, model: 'mock', transport });

      const recorded = events.find((e) => e.type === 'ledger');
      assert.equal(recorded.entries, 2);
      assert.equal(recorded.source, 'tool');

      const gates = events.filter((e) => e.type === 'gate-attempt');
      assert.deepEqual(
        gates.map((g) => g.hypothesis),
        [1, 1, 2],
        'two attempts on the first hypothesis, then it is abandoned',
      );
      assert.deepEqual(
        gates.map((g) => g.passed),
        [false, false, true],
      );

      const verdict = parseVerdict(answer.text).verdict;
      assert.equal(verdict.defect, true);
      assert.equal(verdict.testFile.content, submissions[2]);
      assert.equal(events.at(-1).resolution, 'proved');
      assert.equal(events.at(-1).hypothesis, 2);
    } finally {
      workspace.cleanup();
    }
  });

  it('spends no gate attempt when the ledger comes back empty', async () => {
    const record = loadCases().find((c) => c.id === 'ms-control-lookup');
    const workspace = await prepareCase(record);
    const events = [];
    const trajectory = { events, write: (type, payload) => events.push({ type, ...payload }) };

    let turn = 0;
    const transport = async (url, init) => {
      turn += 1;
      const body = JSON.parse(init.body);
      const message = body.messages.some((m) => m.role === 'tool')
        ? { content: 'nothing to prove' }
        : {
            content: null,
            tool_calls: [
              {
                id: `c${turn}`,
                type: 'function',
                function: { name: 'record-ledger', arguments: JSON.stringify({ hypotheses: [] }) },
              },
            ],
          };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }) };
    };

    try {
      const answer = await runStage2({ record, workspace, trajectory, model: 'mock', transport });
      assert.equal(events.filter((e) => e.type === 'gate-attempt').length, 0);
      assert.equal(parseVerdict(answer.text).verdict.defect, false);
      assert.equal(events.at(-1).via, 'empty-ledger');
    } finally {
      workspace.cleanup();
    }
  });
});

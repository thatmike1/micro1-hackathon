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

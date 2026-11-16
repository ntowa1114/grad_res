'use strict';
// 集計（harness/summarize.js）の規則のテスト: ○/△/×、食い違いの検出、無効試行を数えないこと
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mark, hasDiscrepancy, summarizeCondition, conditions } = require('../harness/summarize');

const trialMatch = (o = {}) => ({ L1: true, L2: true, L3: true, L4: true, ...o });
const meta = (n, o = {}) => ({ runId: `D-M-OA-${String(n).padStart(3, '0')}`, valid: true, cdpBodyAvailable: { available: 2, total: 2 },
  t1: { trialMatch: trialMatch(o.match), missed: 0, falsePositives: 0, contentErrors: 0, outOfBrowser: [] }, ...(o.top || {}) });
function writeTrials(metas) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sum-'));
  for (const m of metas) { const d = path.join(root, 'D-M-OA', m.runId); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify(m)); }
  return root;
}

test('条件は18（R の悪性は作らない）', () => { assert.equal(conditions().length, 18); assert.ok(!conditions().some((c) => c.startsWith('R-M'))); });
test('○ = 全一致、× = 全不一致、△ = その中間（件数から機械的に）', () => {
  assert.equal(mark(3, 3), '○'); assert.equal(mark(10, 10), '○'); assert.equal(mark(0, 3), '×'); assert.equal(mark(0, 10), '×');
  assert.equal(mark(2, 3), '△'); assert.equal(mark(8, 10), '△'); assert.equal(mark(0, 0), '-');
});
test('食い違い: 全試行で同じ結果なら無し。試行間で違えば有り（①）', () => {
  assert.equal(hasDiscrepancy([meta(1), meta(2), meta(3)]).any, false);
  assert.equal(hasDiscrepancy([meta(1), meta(2, { match: { L3: false } }), meta(3)]).between, true);
});
test('食い違い: 全試行が同じでも、T1 で見逃しが1件でもあれば有り（②）', () => {
  const m = meta(1); m.t1.missed = 1;
  const d = hasDiscrepancy([m, meta(2), meta(3)]);
  assert.equal(d.t1, true); assert.equal(d.any, true);
});
test('集計: 無効試行は数えず、一致数 / 有効試行数を出す', () => {
  const inv = meta(4); inv.valid = false;
  const root = writeTrials([meta(1), meta(2, { match: { L4: false } }), meta(3), inv]);
  const s = summarizeCondition(root, 'D-M-OA');
  assert.equal(s.valid, 3); assert.equal(s.invalid, 1);
  assert.deepEqual([s.levels.L1.match, s.levels.L4.match, s.levels.L4.mark, s.levels.L1.mark], [3, 2, '△', '○']);
  assert.deepEqual(s.unclassified, ['L4']);
  assert.equal(s.complete, false); // 食い違いがあるので10回に達するまで未完
});
test('集計: 全試行が一致なら3回で完了。3回を超えたら「10回に増やした」', () => {
  assert.equal(summarizeCondition(writeTrials([meta(1), meta(2), meta(3)]), 'D-M-OA').complete, true);
  const ten = Array.from({ length: 10 }, (_, i) => meta(i + 1, i === 0 ? { match: { L3: false } } : {}));
  const s = summarizeCondition(writeTrials(ten), 'D-M-OA');
  assert.equal(s.extended, true); assert.equal(s.complete, true); assert.equal(s.levels.L3.mark, '△');
});

'use strict';
// L4 の判定ルール比較（harness/rules_analysis.js。experiment_spec.md §13）の単体テスト。合成した記録を使い、expt_log は読まない
// （集計の全体の動作確認は、最後のテストで一時フォルダに作った合成ログを使う）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RULES, groundTruth, trialSends, scoreTrial, aggregate, loadScored, condParts } = require('../harness/rules_analysis');
const dummyExt = require('../harness/extension');

const PAN = '4242424242424242';
const entered = { cardnumber: PAN };
const PSP = 'http://psp.localhost:8081/pay';
const SINK = 'http://sinkhole.localhost:8082/c';
const MERCH_API = 'http://merchant.localhost:8080/pay-api';
const STRIPE = 'https://api.stripe.com/v1/payment_methods';
const rec = (o) => ({ method: 'POST', judge: { L3: PAN, L4b: 'deny' }, ...o });
const A = (url, pageUrl, o = {}) => rec({ url, pageUrl, top: true, ...o });
const B = (url, initiator, o = {}) => rec({ url, initiator, frameId: 0, ...o });
const ctx1 = (r) => ({ cardSends: [r] });

test('R0: 送信元のオリジンと宛先のオリジンが同じなら allow、違えば deny（案A: pageUrl、案B: initiator）', () => {
  assert.equal(RULES.R0(A(PSP, 'http://psp.localhost:8081/frame')), 'allow');
  assert.equal(RULES.R0(A(PSP, 'http://merchant.localhost:8080/checkout')), 'deny');
  assert.equal(RULES.R0(B(PSP, 'http://psp.localhost:8081')), 'allow');
  assert.equal(RULES.R0(B(SINK, 'http://merchant.localhost:8080')), 'deny');
  assert.equal(RULES.R0(A(STRIPE, 'https://js.stripe.com/v3/x.html#a=b')), 'deny'); // ホストが違えば別オリジン
  assert.equal(RULES.R0({ method: 'POST', url: 'not a url' }), null); // 判定不能
});
test('R1: 宛先ホストが決済事業者の一覧（psp.localhost、api.stripe.com）にあれば allow。ポートは見ない', () => {
  assert.equal(RULES.R1(A(PSP, 'x')), 'allow');
  assert.equal(RULES.R1(A(STRIPE, 'x')), 'allow');
  assert.equal(RULES.R1(A(MERCH_API, 'x')), 'deny'); // 正規でも一覧にない宛先（API型）は deny
  assert.equal(RULES.R1(A(SINK, 'x')), 'deny');
  assert.equal(RULES.R1(A('https://evil.api.stripe.com/x', 'x')), 'deny'); // 一覧と完全一致だけ
});
test('R2: 宛先がトップページのオリジン（merchant.localhost:8080）と同じなら allow、違えば deny', () => {
  assert.equal(RULES.R2(A(MERCH_API, 'x')), 'allow');
  assert.equal(RULES.R2(A(PSP, 'x')), 'deny');
  assert.equal(RULES.R2(A(SINK, 'x')), 'deny');
  assert.equal(RULES.R2(A('http://merchant.localhost:9999/x', 'x')), 'deny'); // ポートが違えば別オリジン
});
test('R3: パスに pay・payment・charge・checkout・token があれば allow（大文字小文字を区別せず、部分一致）。ホストやクエリは見ない', () => {
  assert.equal(RULES.R3(A(PSP, 'x')), 'allow');
  assert.equal(RULES.R3(A(MERCH_API, 'x')), 'allow');
  assert.equal(RULES.R3(A(STRIPE, 'x')), 'allow'); // /v1/payment_methods
  assert.equal(RULES.R3(A(SINK, 'x')), 'deny'); // /c
  assert.equal(RULES.R3(A('http://x.localhost/API/CheckOut', 'x')), 'allow');
  assert.equal(RULES.R3(A('http://pay.localhost/c?next=/pay', 'x')), 'deny'); // ホスト・クエリに語があっても、パスになければ deny
  assert.equal(RULES.R3(A('https://r.stripe.com/b', 'x')), 'deny');
});
test('R4: 試行内で、カード番号を含む送信の宛先が2つ以上なら全て deny、1つなら allow。宛先は host:port で数える', () => {
  const p = A(PSP, 'x'); const s = A(SINK, 'x');
  assert.equal(RULES.R4(p, { cardSends: [p] }), 'allow');
  assert.equal(RULES.R4(p, { cardSends: [s, p] }), 'deny');
  assert.equal(RULES.R4(s, { cardSends: [s, p] }), 'deny');
  assert.equal(RULES.R4(p, { cardSends: [p, p] }), 'allow'); // 同じ宛先への2件は1つ
  assert.equal(RULES.R4(A('http://psp.localhost:8082/pay', 'x'), { cardSends: [p, A('http://psp.localhost:8082/pay', 'x')] }), 'deny'); // ポートが違えば別の宛先
});

test('正解付け: sinkhole 宛て = 悪性、型ごとの正規宛先 = 正規、それ以外は null', () => {
  assert.equal(groundTruth(A(SINK, 'x'), 'D'), 'malicious');
  assert.equal(groundTruth(A(PSP, 'x'), 'I'), 'legit');
  assert.equal(groundTruth(A(MERCH_API, 'x'), 'A'), 'legit');
  assert.equal(groundTruth(A(PSP, 'x'), 'A'), null); // API 型の正規宛先は加盟店。PSP 宛てはブラウザからは出ないはず
  assert.equal(groundTruth(A(STRIPE + '?x=1', 'x'), 'S'), 'legit'); // クエリは無視
  assert.equal(groundTruth(A('https://r.stripe.com/b', 'x'), 'S'), null);
});
test('trialSends: カード番号を含む送信だけを評価対象にし、番号なし・GET は除く。正解が定義できない送信はエラーに出す', () => {
  const recs = [A(PSP, 'x'), A(SINK, 'x'), rec({ url: 'https://r.stripe.com/b', judge: { L3: null } }), { method: 'GET', url: PSP, judge: { L3: PAN } },
    A('http://other.localhost/zzz', 'x')];
  const t = trialSends(recs, { type: 'D', point: 'OA', entered, runId: 'D-M-OA-004' });
  assert.equal(t.cards.length, 3); assert.equal(t.sends.length, 2); assert.equal(t.errors.length, 1);
  assert.deepEqual(t.sends.map((s) => s.truth), ['legit', 'malicious']);
});
test('scoreTrial: 期待は 正規 = allow、悪性 = deny。R0 の再計算は記録済みの L4b と比べられる', () => {
  const recs = [A(PSP, 'http://merchant.localhost:8080/checkout-m', { judge: { L3: PAN, L4b: 'deny' } }), A(SINK, 'http://merchant.localhost:8080/checkout-m', { judge: { L3: PAN, L4b: 'deny' } })];
  const sc = scoreTrial(trialSends(recs, { type: 'D', point: 'OA', entered, runId: 'r' }));
  const legit = sc.find((s) => s.truth === 'legit'); const mal = sc.find((s) => s.truth === 'malicious');
  assert.equal(legit.results.R0.ok, false); assert.equal(mal.results.R0.ok, true); // D 型: 正規を deny と誤判定（F22）
  assert.equal(legit.results.R1.ok, true); assert.equal(mal.results.R1.ok, true);
  assert.equal(legit.results.R4.ok, false); assert.equal(mal.results.R4.ok, true); // 2つの宛先 → 全て deny
  assert.equal(legit.results.R0.out, legit.recordedL4b); // 自己確認の材料
});
test('aggregate: 型・正解・観測点・ルールごとに 正解数 / 送信数', () => {
  const recs = [A(PSP, 'http://merchant.localhost:8080/c'), A(PSP, 'http://merchant.localhost:8080/c')];
  const a = aggregate(scoreTrial(trialSends(recs, { type: 'D', point: 'OA', entered, runId: 'r' })));
  assert.deepEqual(a['D|legit|OA|R1'], { ok: 2, total: 2 });
  assert.deepEqual(a['D|legit|OA|R0'], { ok: 0, total: 2 });
});
test('条件IDの解析: OX（拡張機能なし）や未知の型は対象外', () => {
  assert.deepEqual(condParts('S-M-OB'), { type: 'S', kind: 'M', point: 'OB' });
  assert.equal(condParts('D-N-OX'), null); assert.equal(condParts('X-N-OA'), null);
});

test('loadScored: 現行版のハッシュの有効な試行だけを読み、旧版・無効は数えない（合成ログ）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-'));
  const cur = dummyExt.currentHashes('OA').combined;
  const mk = (run, combined, valid, lines) => {
    const d = path.join(root, 'D-M-OA', run); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ runId: run, valid, entered, hashes: { extension: { combined } } }));
    fs.writeFileSync(path.join(d, 'extension.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  };
  const lines = [A(SINK, 'http://merchant.localhost:8080/checkout-m'), A(PSP, 'http://merchant.localhost:8080/checkout-m')];
  mk('D-M-OA-001', 'old-hash', true, lines); mk('D-M-OA-004', cur, true, lines); mk('D-M-OA-005', cur, false, lines);
  fs.mkdirSync(path.join(root, 'D-N-OX', 'D-N-OX-001'), { recursive: true }); // OX は対象外
  const r = loadScored(root);
  assert.deepEqual(r.trials, { used: 1, oldVersion: 1, invalid: 1 });
  assert.equal(r.scored.length, 2); assert.equal(r.errors.length, 0);
});

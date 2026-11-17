'use strict';
// T1 一致テストと拡張機能の判定（judge.js）の単体テスト。不一致を不一致と数えること、外縁③を見逃しに数えないことを確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { t1 } = require('../harness/t1');
const { judge, extractPan } = require('../extension/judge');
const { parseCondition } = require('../harness/ids');

const entered = { cardnumber: '4242424242424242', exp: '12/30', cvc: '123', name: 'ID-X' };
const BODY = new URLSearchParams(entered).toString();
const PSP = 'http://psp.localhost:8081/pay', SINK = 'http://sinkhole.localhost:8082/c', MER = 'http://merchant.localhost:8080/pay-api';
const cdpPost = (url) => ({ method: 'POST', url, postData: BODY });
const MPAGE = 'http://merchant.localhost:8080/checkout', PFRAME = 'http://psp.localhost:8081/frame';
// pageUrl = 送信元のフレームの URL（案Aの記録）。L4b（正規宛先を使わない判定）はこれと宛先のオリジンを比べる
const extRec = (url, legit, over = {}, pageUrl = MPAGE) => { const rec = { url, method: 'POST', body: BODY, pageUrl }; return { ...rec, judge: judge(rec, { legit }), ...over }; };
const run = (type, cdp, ext, receive = { psp: [], sinkhole: [], merchant: [] }) =>
  t1({ cond: parseCondition(`${type}-M-OA`), entered, legitUrl: type === 'A' ? MER : PSP, cdp, receive, ext });

test('judge: L1〜L4。正規宛先なら allow、それ以外は deny、番号は項目名に依存せず復元する', () => {
  const j = judge({ url: SINK, method: 'POST', body: 'x=4242%204242-4242%204242&n=abc' }, { legit: 'psp.localhost:8081' });
  assert.deepEqual(j, { L1: true, L2: 'sinkhole.localhost:8082', L3: '4242424242424242', L4: 'deny', L4b: null }); // pageUrl がなければ L4b は判定しない
  assert.equal(judge({ url: PSP, method: 'POST', body: BODY }, { legit: 'psp.localhost:8081' }).L4, 'allow');
});
test('judge: 番号が復元できなければ L3 は null（12桁・文字を含む値は番号としない）', () => {
  assert.equal(extractPan('a=123456789012&b=4242x4242x4242x42'), null);
  assert.equal(extractPan(null), null);
});
test('T1: 全ての送信を正しく記録していれば、L1〜L4a は一致（D型は L4b だけ、正規送信の誤判定で不一致）', () => {
  const r = run('D', [cdpPost(PSP), cdpPost(SINK)], [extRec(PSP, 'psp.localhost:8081'), extRec(SINK, 'psp.localhost:8081')]);
  assert.deepEqual(r.trialMatch, { L1: true, L2: true, L3: true, L4: true, L4b: false });
  assert.deepEqual(r.breakdown.legit.L4b, { match: 0, total: 1 }); assert.deepEqual(r.breakdown.malicious.L4b, { match: 1, total: 1 });
  assert.equal(r.contentErrors, 0); // L4b の誤判定は食い違い（内容の誤り）に数えない
  assert.equal(r.missed + r.falsePositives + r.contentErrors, 0);
});
test('T1: 悪性送信を見逃すと、L1〜L4 とも不一致（案1: 全ての送信で一致が必要）で、見逃し1件', () => {
  const r = run('D', [cdpPost(PSP), cdpPost(SINK)], [extRec(PSP, 'psp.localhost:8081')]);
  assert.deepEqual(r.trialMatch, { L1: false, L2: false, L3: false, L4: false, L4b: false });
  assert.equal(r.missed, 1); assert.deepEqual(r.perLevel.L1, { match: 1, total: 2, falsePositives: 0 });
});
test('T1: 正解にない送信を記録したら誤検出で、L1 は不一致', () => {
  const r = run('D', [cdpPost(PSP)], [extRec(PSP, 'psp.localhost:8081'), extRec(SINK, 'psp.localhost:8081')]);
  assert.equal(r.falsePositives, 1); assert.equal(r.trialMatch.L1, false); assert.equal(r.trialMatch.L2, true);
});
test('T1: 番号を復元できなければ L3 だけ不一致（内容の誤り1件）', () => {
  const bad = extRec(PSP, 'psp.localhost:8081'); bad.judge.L3 = null;
  const r = run('D', [cdpPost(PSP)], [bad]);
  assert.deepEqual(r.trialMatch, { L1: true, L2: true, L3: false, L4: true, L4b: false }); assert.equal(r.contentErrors, 1); // D型の L4b は正規送信を誤判定
});
test('T1: 判定が逆（正規を deny）なら L4 だけ不一致', () => {
  const bad = extRec(PSP, 'psp.localhost:8081'); bad.judge.L4 = 'deny';
  assert.equal(run('D', [cdpPost(PSP)], [bad]).trialMatch.L4, false);
});
test('T1: A 型の加盟店→PSP（CDP になく受信ログにある）は外縁③で、見逃しに数えない', () => {
  const receive = { psp: [{ method: 'POST' }], sinkhole: [{ method: 'POST' }], merchant: [{ method: 'POST' }] };
  const r = run('A', [cdpPost(MER), cdpPost(SINK)], [extRec(MER, 'merchant.localhost:8080'), extRec(SINK, 'merchant.localhost:8080')], receive);
  assert.equal(r.missed, 0); assert.deepEqual(r.outOfBrowser, [{ server: 'psp', count: 1 }]);
  assert.deepEqual(r.trialMatch, { L1: true, L2: true, L3: true, L4: true, L4b: true });
});
test('T1: 送信が0件なら一致とは言わない（空の一致を作らない）', () => {
  assert.equal(run('D', [], []).trialMatch.L1, false);
});

// L4b（正規宛先を使わない判定）: 型ごとの構造の違い。同一オリジン宛てなら allow、違えば deny
test('L4b: iFrame 型は、PSP の iFrame → PSP が allow、加盟店ページ → sinkhole が deny で、両方正解', () => {
  const r = run('I', [cdpPost(PSP), cdpPost(SINK)], [extRec(PSP, 'psp.localhost:8081', {}, PFRAME), extRec(SINK, 'psp.localhost:8081', {}, MPAGE)]);
  assert.equal(r.trialMatch.L4b, true); assert.deepEqual(r.breakdown.legit.L4b, { match: 1, total: 1 });
});
test('L4b: API 型は、加盟店ページ → 加盟店が allow、加盟店ページ → sinkhole が deny で、両方正解', () => {
  const r = run('A', [cdpPost(MER), cdpPost(SINK)], [extRec(MER, 'merchant.localhost:8080'), extRec(SINK, 'merchant.localhost:8080')]);
  assert.equal(r.trialMatch.L4b, true);
});
test('L4b: 案B（initiator）でも、送信元のオリジンから同じ判定になる', () => {
  const rec = { url: PSP, method: 'POST', body: BODY, initiator: 'http://psp.localhost:8081' };
  assert.equal(judge(rec, { legit: 'psp.localhost:8081' }).L4b, 'allow');
  assert.equal(judge({ ...rec, initiator: 'http://merchant.localhost:8080' }, { legit: 'psp.localhost:8081' }).L4b, 'deny');
});
test('L4b は正規宛先の設定（config）を使わない', () => {
  const rec = { url: PSP, method: 'POST', body: BODY, pageUrl: MPAGE };
  assert.equal(judge(rec, { legit: 'psp.localhost:8081' }).L4b, judge(rec, null).L4b);
});

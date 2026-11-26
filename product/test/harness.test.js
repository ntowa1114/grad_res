'use strict';
// 毎試行の自動チェックと ID 採番の単体テスト。「不合格にすべき場合に不合格になること」を確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluate } = require('../harness/checks');
const { parseCondition, nextTrialNumber, identifier } = require('../harness/ids');

const ID = 'ID-D-M-OX-001-AB12';
const entered = { cardnumber: '4242424242424242', exp: '12/30', cvc: '123', name: ID };
const BODY = new URLSearchParams(entered).toString();
const rec = (server, o = {}) => ({ server, method: 'POST', path: '/x', body: BODY, ...o });
const cdpPost = (url, o = {}) => ({ method: 'POST', url, frameUrl: 'http://merchant.localhost:8080/checkout-m', postData: BODY, ...o });
const base = () => ({
  cdp: [{ method: 'GET', url: 'http://merchant.localhost:8080/checkout-m', frameUrl: null },
    cdpPost('http://psp.localhost:8081/pay'), cdpPost('http://sinkhole.localhost:8082/c')],
  receive: { merchant: [{ method: 'GET', path: '/checkout-m', body: '' }], psp: [rec('psp', { path: '/pay' })], sinkhole: [rec('sinkhole', { path: '/c' })] },
});
const run = (kind, mut) => {
  const d = base(); if (mut) mut(d);
  return evaluate({ cond: parseCondition(`D-${kind}-OX`), entered, identifier: ID, ...d });
};
const failedIds = (r) => r.checks.filter((c) => !c.ok).map((c) => String(c.id));

test('D-M-OX の正常な記録は全て合格', () => { const r = run('M'); assert.equal(r.valid, true); assert.deepEqual(failedIds(r), []); });
test('D-N-OX: sinkhole が空で、CDP にも sinkhole 宛てがなければ合格', () => {
  const r = run('N', (d) => { d.receive.sinkhole = []; d.cdp = d.cdp.filter((c) => !c.url.includes('sinkhole')); });
  assert.equal(r.valid, true);
});
test('D-N-OX: sinkhole に届いていたら #4 不合格で安全停止', () => {
  const r = run('N'); assert.ok(failedIds(r).includes('4')); assert.equal(r.safetyStop, true);
});
test('D-M-OX: sinkhole に届かなければ #4 不合格（S1 不成立）', () => {
  const r = run('M', (d) => { d.receive.sinkhole = []; d.cdp = d.cdp.filter((c) => !c.url.includes('sinkhole')); });
  assert.deepEqual(failedIds(r), ['4']);
});
test('#1: PSP の内容が CVC 抜きなら不合格', () => {
  const r = run('M', (d) => { d.receive.psp[0].body = BODY.replace(/&cvc=123/, ''); });
  assert.ok(failedIds(r).includes('1'));
});
test('#2: 正規送信が2回（CDP の sinkhole 以外の POST が2件）なら不合格', () => {
  const r = run('M', (d) => { d.cdp.push(cdpPost('http://psp.localhost:8081/pay')); });
  assert.ok(failedIds(r).includes('2'));
});
test('#2: 発信元フレームが PSP なら（D型としては）不合格', () => {
  const r = run('M', (d) => { d.cdp[1].frameUrl = 'http://psp.localhost:8081/frame'; });
  assert.ok(failedIds(r).includes('2'));
});
test('#3: 加盟店サーバーに識別子が届いたら不合格', () => {
  const r = run('M', (d) => { d.receive.merchant.push(rec('merchant', { path: '/pay' })); });
  assert.ok(failedIds(r).includes('3'));
});
test('#5: 外部ホストへの送信を検出して不合格・安全停止', () => {
  const r = run('M', (d) => { d.cdp.push({ method: 'GET', url: 'https://example.com/x', frameUrl: null }); });
  assert.ok(failedIds(r).includes('5')); assert.equal(r.safetyStop, true);
});
test('#5: 公開テスト番号以外なら不合格・安全停止', () => {
  const d = base();
  const r = evaluate({ cond: parseCondition('D-M-OX'), entered: { ...entered, cardnumber: '4929000000006' }, identifier: ID, ...d });
  assert.ok(failedIds(r).includes('5')); assert.equal(r.safetyStop, true);
});
test('P: OPTIONS が CDP にあれば無効（D54）', () => {
  const r = run('M', (d) => { d.cdp.push({ method: 'OPTIONS', url: 'http://psp.localhost:8081/pay', frameUrl: null }); });
  assert.ok(failedIds(r).includes('P')); assert.equal(r.valid, false);
});
test('P: 受信ログの preflight 印でも無効', () => {
  const r = run('M', (d) => { d.receive.psp.push({ method: 'OPTIONS', path: '/pay', body: '', preflight: true }); });
  assert.ok(failedIds(r).includes('P'));
});
test('T2: CDP と受信ログの POST 件数が違えば無効（D24）', () => {
  const r = run('M', (d) => { d.cdp = d.cdp.filter((c) => !c.url.includes('sinkhole')); });
  assert.ok(failedIds(r).includes('T2'));
});
test('T2: CDP が本文を取れなくても件数が合えば合格（取得率は別に数える）', () => {
  const r = run('M', (d) => { d.cdp.forEach((c) => { if (c.method === 'POST') c.postData = null; }); });
  assert.equal(r.valid, true); assert.deepEqual(r.cdpBodyAvailable, { available: 0, total: 2 });
});
test('I 型: 発信元フレームが PSP の iFrame なら #2 合格。加盟店ページからなら不合格', () => {
  const ok = base(); ok.cdp[1].frameUrl = 'http://psp.localhost:8081/frame';
  assert.equal(evaluate({ cond: parseCondition('I-M-OX'), entered, identifier: ID, ...ok }).valid, true);
  const bad = base(); // frameUrl は加盟店ページのまま（D型の形）
  const r = evaluate({ cond: parseCondition('I-M-OX'), entered, identifier: ID, ...bad });
  assert.ok(failedIds(r).includes('2'));
});
test('I 型: frameUrl がなければ Referer のオリジンで発信元を判定する', () => {
  const d = base(); d.cdp[1].frameUrl = null; d.cdp[1].referer = 'http://psp.localhost:8081/frame';
  assert.equal(evaluate({ cond: parseCondition('I-M-OX'), entered, identifier: ID, ...d }).valid, true);
});
test('J 型: 発信元が加盟店ページなら合格。PSP のフレームからだと不合格', () => {
  assert.equal(evaluate({ cond: parseCondition('J-M-OX'), entered, identifier: ID, ...base() }).valid, true);
  const bad = base(); bad.cdp[1].frameUrl = 'http://psp.localhost:8081/frame';
  assert.ok(failedIds(evaluate({ cond: parseCondition('J-M-OX'), entered, identifier: ID, ...bad })).includes('2'));
});
test('J 型: 加盟店サーバーに識別子が届いたら #3 不合格', () => {
  const d = base(); d.receive.merchant.push({ method: 'POST', path: '/x', body: BODY });
  assert.ok(failedIds(evaluate({ cond: parseCondition('J-M-OX'), entered, identifier: ID, ...d })).includes('3'));
});
// A 型: 正規宛先は加盟店の /pay-api。PSP への POST は加盟店サーバーから出る（CDP には出ない）
const MERCHANT_BODY_REC = (o = {}) => ({ server: 'merchant', method: 'POST', path: '/pay-api', body: BODY, ...o });
const baseA = () => ({
  cdp: [{ method: 'GET', url: 'http://merchant.localhost:8080/checkout-a-m', frameUrl: null },
    cdpPost('http://merchant.localhost:8080/pay-api', { frameUrl: 'http://merchant.localhost:8080/checkout-a-m' }), cdpPost('http://sinkhole.localhost:8082/c')],
  receive: { merchant: [{ method: 'GET', path: '/checkout-a-m', body: '' }, MERCHANT_BODY_REC()],
    psp: [rec('psp', { path: '/pay', userAgent: 'merchant-server' })], sinkhole: [rec('sinkhole', { path: '/c' })] },
});
const runA = (kind, mut) => { const d = baseA(); if (mut) mut(d); return evaluate({ cond: parseCondition(`A-${kind}-OX`), entered, identifier: ID, ...d }); };
test('A-M-OX の正常な記録は全て合格', () => { const r = runA('M'); assert.equal(r.valid, true); assert.deepEqual(failedIds(r), []); });
test('A-N-OX: sinkhole が空なら合格', () => {
  const r = runA('N', (d) => { d.receive.sinkhole = []; d.cdp = d.cdp.filter((c) => !c.url.includes('sinkhole')); });
  assert.equal(r.valid, true);
});
test('A 型 #1: 加盟店サーバーに識別子が届かなければ不合格（陽性対照）', () => {
  const r = runA('M', (d) => { d.receive.merchant = d.receive.merchant.filter((x) => x.method === 'GET'); });
  assert.ok(failedIds(r).includes('1')); assert.ok(failedIds(r).includes('3'));
});
test('A 型 #3: ブラウザから PSP へ直接 POST が出ていたら不合格（図5の誤読の場合の経路）', () => {
  const r = runA('M', (d) => { d.cdp.push(cdpPost('http://psp.localhost:8081/pay')); });
  assert.ok(failedIds(r).includes('3'));
});
test('A 型 #3: PSP の受信が加盟店サーバー発でなければ不合格', () => {
  const r = runA('M', (d) => { d.receive.psp[0].userAgent = 'Mozilla/5.0'; });
  assert.ok(failedIds(r).includes('3'));
});
test('A 型 #3: PSP に届いていなければ不合格（A3 が成立していない）', () => {
  const r = runA('M', (d) => { d.receive.psp = []; });
  assert.ok(failedIds(r).includes('3'));
});
test('A 型 #2: 宛先が PSP なら不合格（正規宛先は加盟店）', () => {
  const r = runA('M', (d) => { d.cdp[1].url = 'http://psp.localhost:8081/pay'; });
  assert.ok(failedIds(r).includes('2'));
});
// R 型: PSP のページ（リダイレクト後）から PSP へ。正規のみ（D16）
const baseR = () => ({
  cdp: [{ method: 'GET', url: 'http://merchant.localhost:8080/checkout-r', frameUrl: null },
    { method: 'GET', url: 'http://psp.localhost:8081/checkout', frameUrl: null },
    cdpPost('http://psp.localhost:8081/pay', { frameUrl: 'http://psp.localhost:8081/checkout' })],
  receive: { merchant: [{ method: 'GET', path: '/checkout-r', body: '' }], psp: [rec('psp', { path: '/pay' })], sinkhole: [] },
});
const runR = (mut) => { const d = baseR(); if (mut) mut(d); return evaluate({ cond: parseCondition('R-N-OX'), entered, identifier: ID, ...d }); };
test('R-N-OX の正常な記録は全て合格', () => { const r = runR(); assert.equal(r.valid, true); assert.deepEqual(failedIds(r), []); });
test('R 型 #2: 発信元が加盟店ページなら不合格（R3 は PSP のページから）', () => {
  const r = runR((d) => { d.cdp[2].frameUrl = 'http://merchant.localhost:8080/checkout-r'; });
  assert.ok(failedIds(r).includes('2'));
});
test('R 型 #3: 加盟店サーバーに識別子が届いたら不合格（R4）', () => {
  const r = runR((d) => { d.receive.merchant.push({ method: 'POST', path: '/x', body: BODY }); });
  assert.ok(failedIds(r).includes('3'));
});
test('R 型 #4: sinkhole に受信があれば不合格・安全停止（S7）', () => {
  const r = runR((d) => { d.receive.sinkhole.push(rec('sinkhole', { path: '/c' })); d.cdp.push(cdpPost('http://sinkhole.localhost:8082/c')); });
  assert.ok(failedIds(r).includes('4')); assert.equal(r.safetyStop, true);
});
test('未知の型は例外（黙って合格にしない）', () => {
  assert.throws(() => evaluate({ cond: { id: 'X-N-OX', type: 'X', kind: 'N', point: 'OX' }, entered, identifier: ID, ...base() }), /未実装/);
});

test('条件IDの解析: R-M-* と不正な書式は拒否', () => {
  assert.equal(parseCondition('I-M-OA').type, 'I');
  assert.throws(() => parseCondition('R-M-OX'), /作らない/);
  assert.throws(() => parseCondition('X-N-OX'), /不正/);
});
test('試行番号は、無効試行を含む既存フォルダの最大 +1 で、欠番があっても使い回さない', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ids-'));
  assert.equal(nextTrialNumber(root, 'D-M-OX'), 1);
  fs.mkdirSync(path.join(root, 'D-M-OX', 'D-M-OX-001'), { recursive: true });
  fs.mkdirSync(path.join(root, 'D-M-OX', 'D-M-OX-003'), { recursive: true });
  assert.equal(nextTrialNumber(root, 'D-M-OX'), 4);
});
test('識別子は、シードから再現でき、英大文字・数字・ハイフンだけ', () => {
  const a = identifier('D-M-OX-001', 12345);
  assert.equal(a, identifier('D-M-OX-001', 12345));
  assert.notEqual(a, identifier('D-M-OX-001', 12346));
  assert.match(a, /^ID-D-M-OX-001-[A-Z0-9]{4}$/);
});

// ---- 追加実験: 送信手段の拡張（D57、experiment_spec.md §14）。条件 T<B|G|F>-M-<観測点> ----
test('条件IDの解析: T<B|G|F>-M-* は型 D・悪性・transport つき。従来の条件は transport: null。不正な書式は拒否', () => {
  assert.deepEqual(parseCondition('TB-M-OA'), { id: 'TB-M-OA', type: 'D', kind: 'M', point: 'OA', transport: 'B' });
  assert.equal(parseCondition('TG-M-OX').transport, 'G');
  assert.equal(parseCondition('TF-M-OB').transport, 'F');
  assert.equal(parseCondition('D-M-OX').transport, null);
  for (const bad of ['TB-N-OX', 'TX-M-OX', 'T-M-OX', 'TBG-M-OX', 'TB-M-OC']) assert.throws(() => parseCondition(bad), /書式が不正/);
});

const SINK_URL = 'http://sinkhole.localhost:8082/c';
const runT = (transport, mut) => {
  const d = base();
  if (transport === 'G') { // 画像GET: 全項目はクエリ。CDP も受信ログも GET
    d.cdp[2] = { method: 'GET', url: SINK_URL + '?' + BODY, frameUrl: 'http://merchant.localhost:8080/checkout-m?t=G', type: 'Image', postData: null };
    d.receive.sinkhole = [{ server: 'sinkhole', method: 'GET', path: '/c?' + BODY, body: '' }];
  }
  if (mut) mut(d);
  return evaluate({ cond: parseCondition(`T${transport}-M-OX`), entered, identifier: ID, ...d });
};

test('TB・TF（POST の手段）: 従来の D-M-OX と同じ記録で全て合格', () => {
  for (const t of ['B', 'F']) { const r = runT(t); assert.equal(r.valid, true, t); assert.deepEqual(failedIds(r), []); }
});
test('TG（画像GET）: sinkhole の GET が、クエリに全項目を持ち、CDP の GET と一致すれば全て合格', () => {
  const r = runT('G'); assert.equal(r.valid, true); assert.deepEqual(failedIds(r), []);
});
test('TG #4: クエリから CVC が欠けていれば不合格（全項目一致が必要）', () => {
  const r = runT('G', (d) => { d.receive.sinkhole[0].path = '/c?' + BODY.replace(/&cvc=123/, ''); d.cdp[2].url = SINK_URL + '?' + BODY.replace(/&cvc=123/, ''); });
  assert.ok(failedIds(r).includes('4'));
});
test('TG #4: sinkhole の受信が POST なら不合格（手段 G は GET）。TB・TF で GET なら不合格', () => {
  assert.ok(failedIds(runT('G', (d) => { d.receive.sinkhole[0].method = 'POST'; })).includes('4'));
  assert.ok(failedIds(runT('B', (d) => { d.receive.sinkhole[0] = { server: 'sinkhole', method: 'GET', path: '/c?' + BODY, body: '' }; })).includes('4'));
});
test('TG T2: CDP に sinkhole 宛ての GET がなければ（件数が違えば）、URL が違えば、無効', () => {
  assert.ok(failedIds(runT('G', (d) => { d.cdp = d.cdp.filter((c) => !c.url.includes('sinkhole')); })).includes('T2'));
  assert.ok(failedIds(runT('G', (d) => { d.cdp[2].url = SINK_URL + '?x=1'; })).includes('T2'));
});
test('TG #5: 画像GET の宛先が範囲外のホストなら、不合格・安全停止（GET も隔離の対象）', () => {
  const r = runT('G', (d) => { d.cdp.push({ method: 'GET', url: 'http://evil.example.com/x', frameUrl: null }); });
  assert.ok(failedIds(r).includes('5')); assert.equal(r.safetyStop, true);
});

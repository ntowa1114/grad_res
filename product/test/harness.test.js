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
test('D 以外の型は未実装として例外（黙って合格にしない）', () => {
  assert.throws(() => evaluate({ cond: parseCondition('I-M-OX'), entered, identifier: ID, ...base() }), /未実装/);
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

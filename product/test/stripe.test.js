'use strict';
// 実 Stripe 版の純粋関数の単体テスト（ネットワークは使わない）。不合格にすべき場合に不合格になることを確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluateStripe, panIn, CARD_URL } = require('../stripe/checks_stripe');
const { t1Stripe } = require('../stripe/t1_stripe');
const { isAllowedHost, hostResolverArg, STRIPE_HOSTS } = require('../stripe/allowlist');
const { redact, redactDir, REDACTED } = require('../stripe/key');
const { parseStripeCondition } = require('../stripe/run_trial_stripe');
const ext = require('../stripe/ext_stripe');

const entered = { cardnumber: '4242424242424242', exp: '12/35', cvc: '123', postal: '12345' };
const BODY = 'type=card&card[number]=4242+4242+4242+4242&card[cvc]=123&key=pk_test_X';
const frame = 'https://js.stripe.com/v3/elements-inner-card.html';
const cdpCard = { method: 'POST', url: CARD_URL, frameUrl: frame, postData: BODY };
const cdpTele = { method: 'POST', url: 'https://r.stripe.com/b', frameUrl: frame, postData: 'client_id=x&events=y' };
const cdpGet = { method: 'GET', url: 'http://merchant.localhost:8080/checkout-s', frameUrl: null };
const cond = { type: 'S', kind: 'N', point: 'OX' };
const run = (o = {}) => evaluateStripe({ cond, entered, cdp: [cdpGet, cdpTele, cdpCard], receiveMerchant: [{ method: 'GET', path: '/checkout-s', body: '' }], result: 'ok:pm_', guard: 'blocked', ...o });
const failed = (r) => r.checks.filter((c) => !c.ok).map((c) => String(c.id));

test('panIn: 値から13〜19桁を取り出す（空白・ハイフン除去、項目名に依存しない）', () => {
  assert.equal(panIn(BODY), '4242424242424242');
  assert.equal(panIn('a=1234-5678-9012-3456'), '1234567890123456');
  assert.equal(panIn('a=123&b=hello'), null);
  assert.equal(panIn(null), null);
});
test('正常な記録は全て合格', () => { const r = run(); assert.equal(r.valid, true); assert.deepEqual(failed(r), []); });
test('#1: カード送信が0件・2件のとき不合格', () => {
  assert.deepEqual(failed(run({ cdp: [cdpGet, cdpTele] })), ['1']);
  assert.ok(failed(run({ cdp: [cdpGet, cdpCard, cdpCard] })).includes('1'));
});
test('#1: カード送信の宛先が api.stripe.com/v1/payment_methods でなければ不合格', () => {
  assert.ok(failed(run({ cdp: [cdpGet, { ...cdpCard, url: 'https://r.stripe.com/b' }] })).includes('1'));
});
test('#1: 発信元が js.stripe.com でなければ不合格', () => {
  assert.ok(failed(run({ cdp: [cdpGet, { ...cdpCard, frameUrl: 'http://merchant.localhost:8080/checkout-s' }] })).includes('1'));
});
test('#2: createPaymentMethod が失敗なら不合格', () => { assert.deepEqual(failed(run({ result: 'error:card_declined' })), ['2']); });
test('#3: 加盟店に POST が届いたら不合格', () => {
  assert.deepEqual(failed(run({ receiveMerchant: [{ method: 'POST', body: BODY }] })), ['3']);
});
test('#4・#5: 許可リスト外のホストが CDP にあれば不合格で、安全に関わる不合格（safetyStop）', () => {
  const r = run({ cdp: [cdpGet, cdpCard, { method: 'POST', url: 'http://sinkhole.localhost:8082/c', frameUrl: frame, postData: BODY }, { method: 'GET', url: 'https://evil.example/x' }] });
  assert.ok(failed(r).includes('4') && failed(r).includes('5')); assert.equal(r.safetyStop, true);
});
test('#5: 遮断の確認が blocked でなければ不合格', () => { assert.deepEqual(failed(run({ guard: 'reached' })), ['5']); });
test('#5: 公開テスト番号でなければ不合格', () => {
  assert.ok(failed(run({ entered: { ...entered, cardnumber: '4242424242424241' } })).includes('5'));
});
test('#P: OPTIONS があれば不合格', () => { assert.deepEqual(failed(run({ cdp: [cdpGet, cdpCard, { method: 'OPTIONS', url: CARD_URL }] })), ['P']); });
test('条件ID: S-N・S-M を受け付け、他の型は拒否する。未知の種別は例外', () => {
  assert.throws(() => evaluateStripe({ cond: { ...cond, kind: 'X' }, entered, cdp: [], receiveMerchant: [] }));
  assert.throws(() => parseStripeCondition('D-N-OX'));
  assert.equal(parseStripeCondition('S-N-OB').point, 'OB');
  assert.equal(parseStripeCondition('S-M-OA').kind, 'M');
});

// S-M（取得なしの模擬送信）
const ID = 'ID-S-M-OX-001-K7Q4';
const SINK_URL = 'http://sinkhole.localhost:8082/c';
const SINK_BODY = `cardnumber=4242424242424242&exp=${encodeURIComponent('12/35')}&cvc=123&postal=12345&name=${ID}`;
const cdpSink = { method: 'POST', url: SINK_URL, frameUrl: 'http://merchant.localhost:8080/checkout-s-m?id=' + ID, postData: SINK_BODY };
const recvSink = { method: 'POST', path: '/c', body: SINK_BODY };
const condM = { type: 'S', kind: 'M', point: 'OX' };
const runM = (o = {}) => evaluateStripe({ cond: condM, entered, identifier: ID, cdp: [cdpGet, cdpTele, cdpCard, cdpSink], receiveMerchant: [{ method: 'GET', path: '/checkout-s-m', body: '' }],
  receiveSinkhole: [recvSink], result: 'ok:pm_', guard: 'blocked', ...o });
test('S-M: 正常な記録は全て合格（sinkhole 宛ての番号つき POST は #1 の数に入らない）', () => {
  const r = runM(); assert.equal(r.valid, true); assert.deepEqual(failed(r), []); assert.ok(r.checks.some((c) => c.id === 'T2'));
});
test('S-M #4: sinkhole の受信が0件・2件なら不合格', () => {
  assert.ok(failed(runM({ receiveSinkhole: [] })).includes('4'));
  assert.ok(failed(runM({ receiveSinkhole: [recvSink, recvSink] })).includes('4'));
});
test('S-M #4: 識別子・項目が違えば不合格', () => {
  assert.ok(failed(runM({ receiveSinkhole: [{ ...recvSink, body: SINK_BODY.replace('cvc=123', 'cvc=999') }] })).includes('4'));
  assert.ok(failed(runM({ identifier: 'ID-OTHER' })).includes('4'));
});
test('S-M #T2: CDP と sinkhole の受信ログの件数が違えば不合格', () => {
  assert.ok(failed(runM({ cdp: [cdpGet, cdpTele, cdpCard] })).includes('T2'));
});
test('S-M: Stripe へのカード送信が欠ければ #1 不合格（sinkhole 宛てだけでは代用できない）', () => {
  assert.ok(failed(runM({ cdp: [cdpGet, cdpTele, cdpSink] })).includes('1'));
});
test('S-M: 許可リスト外のホストがあれば #4・#5 不合格で safetyStop', () => {
  const r = runM({ cdp: [cdpGet, cdpCard, cdpSink, { method: 'GET', url: 'https://evil.example/x' }] });
  assert.ok(failed(r).includes('4') && failed(r).includes('5')); assert.equal(r.safetyStop, true);
});
test('S-N: sinkhole へ送られたら #4 不合格（正規で悪性送信が混ざらない）', () => {
  assert.ok(failed(run({ cdp: [cdpGet, cdpTele, cdpCard, cdpSink] })).includes('4'));
});
test('S-M の加盟店ページ: send.js と模擬送信だけを足し、正規ページには入れない。模擬送信は Stripe の入力欄を読まない', () => {
  const merchantS = require('../stripe/merchant_stripe');
  const m = merchantS.checkoutPage('pk_test_X', true); const n = merchantS.checkoutPage('pk_test_X', false);
  assert.ok(m.includes('/skimmer/send.js') && m.includes('inject_send_stripe.js')); assert.ok(!n.includes('inject_send_stripe.js') && !n.includes('send.js'));
  const src = fs.readFileSync(merchantS.STATIC['/stripe_inject/inject_send_stripe.js'], 'utf8');
  assert.ok(!/contentDocument|querySelector|\.value|iframe/i.test(src.replace(/^\s*\/\/.*$/gm, '')));
});

test('許可リスト: 承認した個別ホストと localhost だけ。ワイルドカードにしない', () => {
  for (const h of STRIPE_HOSTS) assert.equal(isAllowedHost(h), true);
  assert.equal(isAllowedHost('merchant.localhost'), true);
  assert.equal(isAllowedHost('example.com'), false);
  assert.equal(isAllowedHost('evil.stripe.com'), false);
  assert.equal(isAllowedHost('stripe.com'), false);
  assert.match(hostResolverArg(), /^--host-resolver-rules=MAP \* ~NOTFOUND , EXCLUDE localhost/);
});
test('キーの置換: 値が pk_test_REDACTED になり、ファイルも書き換わる', () => {
  const key = 'pk_test_ABC123';
  assert.equal(redact(`a=${key}&b=${key}`, key), `a=${REDACTED}&b=${REDACTED}`);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'red-')); fs.writeFileSync(path.join(d, 'x.jsonl'), `{"k":"${key}"}\n`); fs.writeFileSync(path.join(d, 'y.json'), '{}');
  assert.equal(redactDir(d, key), 1); assert.ok(!fs.readFileSync(path.join(d, 'x.jsonl'), 'utf8').includes(key));
});

// T1
const J = (url, j) => ({ method: 'POST', url, judge: { L1: true, L2: new URL(url).host, L3: null, L4: new URL(url).host === 'api.stripe.com' ? 'allow' : 'deny', L4b: 'deny', ...j } });
test('T1: カード送信は L3・L4 を評価し、他の POST は other に別集計（L3・L4 に混ぜない）', () => {
  const x = t1Stripe({ entered, cdp: [cdpTele, cdpCard], ext: [J('https://r.stripe.com/b', {}), J(CARD_URL, { L3: '4242424242424242' })] });
  assert.deepEqual(x.perLevel.L3, { match: 1, total: 1 });
  assert.deepEqual(x.perLevel.L4, { match: 1, total: 1 });
  assert.deepEqual(x.perLevel.L4b, { match: 0, total: 1 }); // 正規送信で、同一オリジンでない → deny（正解は allow）
  assert.equal(x.other.total, 1); assert.equal(x.other.observed, 1);
  assert.equal(x.trialMatch.L1, true); assert.equal(x.trialMatch.L3, true); assert.equal(x.trialMatch.L4b, false);
  assert.equal(x.breakdown.legit.L4b.match, 0);
});
test('T1: 案Aがカード送信を見逃せば、見逃し1、L1 は不一致', () => {
  const x = t1Stripe({ entered, cdp: [cdpTele, cdpCard], ext: [J('https://r.stripe.com/b', {})] });
  assert.equal(x.missed, 1); assert.equal(x.trialMatch.L1, false); assert.equal(x.other.missed, 0);
});
test('T1: other の見逃しは missed（カード送信）に数えない', () => {
  const x = t1Stripe({ entered, cdp: [cdpTele, cdpCard], ext: [J(CARD_URL, { L3: '4242424242424242' })] });
  assert.equal(x.missed, 0); assert.equal(x.other.missed, 1);
});
test('T1: 記録にない送信を記録したら誤検出', () => {
  const x = t1Stripe({ entered, cdp: [cdpCard], ext: [J(CARD_URL, { L3: '4242424242424242' }), J('https://r.stripe.com/b', {})] });
  assert.equal(x.falsePositives, 1); assert.equal(x.trialMatch.L1, false);
});
test('T1: S-M の sinkhole 宛て模擬送信は、悪性側の内訳に入り、L4a は deny が正解', () => {
  const sinkExt = { method: 'POST', url: SINK_URL, judge: { L1: true, L2: 'sinkhole.localhost:8082', L3: '4242424242424242', L4: 'deny', L4b: 'deny' } };
  const x = t1Stripe({ entered, cdp: [cdpCard, cdpSink], ext: [J(CARD_URL, { L3: '4242424242424242' }), sinkExt] });
  assert.deepEqual(x.breakdown.malicious.L4, { match: 1, total: 1 }); assert.deepEqual(x.breakdown.malicious.L4b, { match: 1, total: 1 });
  assert.deepEqual(x.breakdown.legit.L4b, { match: 0, total: 1 }); assert.equal(x.missed, 0);
});
test('拡張機能の準備: Stripe 版のハッシュはダミー版と別で、使うファイルが揃う', () => {
  const dummy = require('../harness/extension');
  for (const p of ['OA', 'OB']) {
    const h = ext.currentHashes(p); assert.notEqual(h.combined, dummy.currentHashes(p).combined);
    const { dir } = ext.prepare(p); assert.ok(fs.existsSync(path.join(dir, 'manifest.json')));
    for (const f of Object.keys(h.files).filter((f) => !f.startsWith('manifest_'))) assert.ok(fs.existsSync(path.join(dir, f)), f);
  }
});

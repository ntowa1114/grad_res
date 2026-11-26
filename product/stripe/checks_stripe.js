'use strict';
// 実 Stripe 版の毎試行チェック（純粋関数）。ダミー版 checks.js の #1〜#5、#P に対応するが、Stripe の受信ログは取れないため、
// 正解記録は CDP のみ（#T2 は使えない。代わりに #1・#2・#5 で、カード送信が1件、成功、許可リスト外への通信なし、を確かめる）。
// S-N（正規）と S-M（取得なしの模擬送信。取得部は再現しない。sinkhole の受信ログがあるので、sinkhole 宛てだけ #T2 を行う）。
const { PUBLIC_TEST_PANS } = require('../harness/checks');
const { isAllowedHost } = require('./allowlist');

const CARD_URL = 'https://api.stripe.com/v1/payment_methods';
const isHttp = (u) => /^(https?|wss?):/i.test(u);
const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };
// 本文の全項目の値から、空白・ハイフンを除いて13〜19桁の数字になる値を取り出す（L3 と同じ規則）
function panIn(body) {
  if (!body) return null;
  let found = null;
  new URLSearchParams(body).forEach((v) => { const d = String(v).replace(/[\s-]/g, ''); if (!found && /^\d{13,19}$/.test(d)) found = d; });
  return found;
}

const isSinkUrl = (u) => hostOf(u) === 'sinkhole.localhost';

// S-M: 取得なしの模擬送信（inject_send_stripe.js）。sinkhole に、識別子つき・全項目一致の POST がちょうど1件届く
function sinkholeSendOk(entered, identifier, receiveSinkhole) {
  const posts = receiveSinkhole.filter((r) => r.method === 'POST' && !r.preflight);
  if (posts.length !== 1) return { ok: false, detail: `sinkhole の POST 受信 ${posts.length} 件（期待は1件）` };
  const p = new URLSearchParams(posts[0].body);
  const miss = ['cardnumber', 'exp', 'cvc', 'postal'].filter((k) => p.get(k) !== entered[k]);
  if (p.get('name') !== identifier) miss.push('name(識別子)');
  return { ok: miss.length === 0, detail: miss.length ? `不一致の項目=[${miss.join(',')}]` : '全項目一致（識別子つき）1件' };
}

function evaluateStripe({ cond, entered, cdp, receiveMerchant, receiveSinkhole = [], identifier = null, result, guard }) {
  if (cond.kind !== 'N' && cond.kind !== 'M') throw new Error(`未知の種別: ${cond.kind}`);
  const checks = []; const add = (id, name, ok, detail) => checks.push({ id, name, ok, detail });
  const posts = cdp.filter((r) => r.method === 'POST' && isHttp(r.url));

  // Stripe へのカード送信。sinkhole 宛て（S-M の模擬送信）も番号を含むので、#1 の数え方からは除く
  const cardSends = posts.filter((r) => panIn(r.postData) === entered.cardnumber && !isSinkUrl(r.url));
  const toApi = cardSends.filter((r) => r.url === CARD_URL);
  const one = toApi.length === 1 ? toApi[0] : null;
  const sender = one ? (originOf(one.frameUrl) ?? originOf(one.referer)) : null;
  add(1, 'カード送信が1件', cardSends.length === 1 && !!one && sender === 'https://js.stripe.com',
    `番号を含む POST ${cardSends.length} 件（うち ${CARD_URL} 宛て ${toApi.length} 件）${one ? `、発信元=${sender}` : ''}`);

  add(2, 'createPaymentMethod の成功', typeof result === 'string' && result.startsWith('ok:pm_'), `ページの結果表示=${result}`);

  const merchantPosts = receiveMerchant.filter((r) => r.method === 'POST');
  const merchantPan = receiveMerchant.some((r) => panIn(r.body) || JSON.stringify(r).includes(entered.cardnumber));
  add(3, '加盟店サーバーの受信', merchantPosts.length === 0 && !merchantPan, `加盟店の POST 受信 ${merchantPosts.length} 件、番号を含む受信=${merchantPan}`);

  const hosts = [...new Set(cdp.filter((r) => isHttp(r.url)).map((r) => hostOf(r.url)))];
  const bad = hosts.filter((h) => !isAllowedHost(h));
  if (cond.kind === 'N') {
    // S-N は悪性送信なし: 許可リストの外（自作 sinkhole を含む）への通信が CDP にない
    add(4, '悪性送信なし（正規）', bad.length === 0 && !hosts.some((h) => /sinkhole/.test(h)), `許可リスト外のホスト=[${bad.join(',')}]`);
  } else {
    // S-M は模擬送信: sinkhole の受信がちょうど1件（識別子つき・全項目一致）で、許可リスト外への通信がない
    const s = sinkholeSendOk(entered, identifier, receiveSinkhole);
    add(4, '模擬送信が sinkhole に1件', s.ok && bad.length === 0, `${s.detail}、許可リスト外のホスト=[${bad.join(',')}]`);
    // 受信ログと CDP の突き合わせ（sinkhole 宛てだけ。Stripe 側には受信ログがない）
    const cdpSink = posts.filter((r) => isSinkUrl(r.url));
    const recvSink = receiveSinkhole.filter((r) => r.method === 'POST' && !r.preflight);
    add('T2', 'sinkhole 宛ての CDP と受信ログの一致', cdpSink.length === recvSink.length && cdpSink.every((r) => panIn(r.postData) === entered.cardnumber),
      `CDP の sinkhole 宛て POST ${cdpSink.length} 件、受信ログ ${recvSink.length} 件`);
  }

  add(5, '隔離と番号', cdp.length > 0 && bad.length === 0 && guard === 'blocked' && PUBLIC_TEST_PANS.has(entered.cardnumber),
    `CDP の記録 ${cdp.length} 件、範囲外=[${bad.join(',')}]、名前解決の遮断の確認=${guard}、公開テスト番号=${PUBLIC_TEST_PANS.has(entered.cardnumber)}`);

  const options = cdp.filter((r) => r.method === 'OPTIONS').length;
  add('P', 'preflight なし（D54）', options === 0, `OPTIONS ${options} 件`);

  const failed = checks.filter((c) => !c.ok);
  return { checks, valid: failed.length === 0, invalidReasons: failed.map((c) => `${c.id}: ${c.name}`),
    safetyStop: checks.some((c) => (c.id === 4 || c.id === 5) && !c.ok), hostsContacted: hosts };
}
module.exports = { evaluateStripe, panIn, CARD_URL };

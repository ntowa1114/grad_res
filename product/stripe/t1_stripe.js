'use strict';
// 実 Stripe 版の T1 一致テスト（純粋関数）。ダミー版 t1.js と同じ形で返す（summarize.js で使えるように）が、評価の対象が違う:
//  - L3・L4a・L4b は、カード番号を含む送信（カード送信）だけで評価する。計測用・不正対策用の POST は、L1・L2 だけを、別に数える（other）。
//  - 正規宛先（L4a に渡す）は api.stripe.com。L4b の正解は、正規宛先なら allow（ダミー版と同じ。ルールは変えない）。
//  - 外縁③（ブラウザを通らない送信）は、Stripe 版では観測できない（受信ログがない）ので、空にする。
const { panIn } = require('./checks_stripe');
const isHttp = (u) => /^https?:/i.test(u);
const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };

function t1Stripe({ entered, legitHost = 'api.stripe.com', cdp, ext }) {
  const truth = cdp.filter((r) => r.method === 'POST' && isHttp(r.url));
  const extPosts = ext.filter((r) => r.method === 'POST');
  const used = new Set(); const perSend = [];
  for (const g of truth) {
    const idx = extPosts.findIndex((e, i) => !used.has(i) && e.url === g.url);
    const e = idx >= 0 ? extPosts[idx] : null; if (idx >= 0) used.add(idx);
    const card = panIn(g.postData) === entered.cardnumber; const legit = hostOf(g.url) === legitHost;
    const exp = legit ? 'allow' : 'deny';
    perSend.push({ url: g.url, card, legit, observed: !!e,
      L1: !!e && e.judge.L1 === true, L2: !!e && e.judge.L2 === hostOf(g.url),
      L3: !!e && e.judge.L3 === entered.cardnumber, L4: !!e && e.judge.L4 === exp, L4b: !!e && e.judge.L4b === exp });
  }
  const falsePositives = extPosts.filter((_, i) => !used.has(i));
  const cards = perSend.filter((p) => p.card); const others = perSend.filter((p) => !p.card);
  const lv = (xs, k) => ({ match: xs.filter((p) => p[k]).length, total: xs.length });
  const L = { L1: lv(cards, 'L1'), L2: lv(cards, 'L2'), L3: lv(cards, 'L3'), L4: lv(cards, 'L4'), L4b: lv(cards, 'L4b') };
  L.L1.falsePositives = falsePositives.length;
  const all = (k) => L[k].total > 0 && L[k].match === L[k].total;
  const trialMatch = { L1: all('L1') && falsePositives.length === 0, L2: all('L2'), L3: all('L3'), L4: all('L4'), L4b: all('L4b') };
  const by = (legit, k) => { const xs = cards.filter((p) => p.legit === legit); return lv(xs, k); };
  return {
    scope: 'card-sends-only', perLevel: L, trialMatch,
    missed: cards.filter((p) => !p.observed).length, falsePositives: falsePositives.length,
    contentErrors: cards.filter((p) => p.observed && !(p.L2 && p.L3 && p.L4)).length,
    breakdown: { legit: { L4: by(true, 'L4'), L4b: by(true, 'L4b') }, malicious: { L4: by(false, 'L4'), L4b: by(false, 'L4b') } },
    other: { total: others.length, observed: others.filter((p) => p.observed).length, L1: lv(others, 'L1'), L2: lv(others, 'L2'), missed: others.filter((p) => !p.observed).length },
    outOfBrowser: [], perSend,
  };
}
module.exports = { t1Stripe };

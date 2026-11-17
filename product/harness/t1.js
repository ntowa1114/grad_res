'use strict';
// T1 一致テスト（experiment_spec.md §6.5、§5.3(4)。D37）。純粋関数。拡張機能の記録と正解記録（CDP + 受信ログ）を突き合わせ、
// レベル（L1〜L4）ごとに、一致した送信数 / 送信数 と、見逃し・誤検出・内容の誤りを数える。
// 正解の送信 = CDP が記録したブラウザの POST（http）。受信ログにあって CDP にない送信（A 型の加盟店→PSP）は
// ブラウザを通らない外縁③として別に数え、見逃しには数えない（研究者の了承 2026-11-16）。
// 1試行の欄は「全ての送信で一致」のときだけ一致（案1。研究者の選択 2026-11-16）。
// 拡張機能の記録は、宛先 URL と時刻順で1件ずつ対応づける（本文の識別子は、L3 を読めない条件でも結びつけられるよう使わない）。
const { ORIGINS } = require('./checks');

const isHttp = (u) => /^(https?):/i.test(u);
const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };
const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };

function t1({ cond, entered, legitUrl, cdp, receive, ext }) {
  const legitHost = hostOf(legitUrl);
  const truth = cdp.filter((r) => r.method === 'POST' && isHttp(r.url));
  const extPosts = ext.filter((r) => r.method === 'POST');
  const used = new Set();
  const perSend = [];
  for (const g of truth) {
    const idx = extPosts.findIndex((e, i) => !used.has(i) && e.url === g.url);
    const e = idx >= 0 ? extPosts[idx] : null;
    if (idx >= 0) used.add(idx);
    const expectedL4 = hostOf(g.url) === legitHost ? 'allow' : 'deny';
    perSend.push({
      url: g.url, observed: !!e,
      L1: !!e && e.judge.L1 === true,
      L2: !!e && e.judge.L2 === hostOf(g.url),
      L3: !!e && e.judge.L3 === entered.cardnumber,
      L4: !!e && e.judge.L4 === expectedL4,   // L4a: 正規宛先を教えた場合
      L4b: !!e && e.judge.L4b === expectedL4, // L4b: 教えない場合（見える情報だけの判定）。正解は同じ（正規宛先なら allow、違えば deny）
      legit: hostOf(g.url) === legitHost,
    });
  }
  const falsePositives = extPosts.filter((_, i) => !used.has(i)); // 誤検出: 正解記録にない送信を記録した
  // 外縁③: 受信ログにあり、CDP にない POST（宛先ごとに、受信の件数 − CDP の件数）
  const outOfBrowser = [];
  for (const name of ['psp', 'sinkhole', 'merchant']) {
    const c = truth.filter((r) => originOf(r.url) === ORIGINS[name]).length;
    const s = (receive[name] || []).filter((r) => r.method === 'POST').length;
    if (s > c) outOfBrowser.push({ server: name, count: s - c });
  }
  const level = (k) => ({ match: perSend.filter((p) => p[k]).length, total: perSend.length });
  const L = { L1: level('L1'), L2: level('L2'), L3: level('L3'), L4: level('L4'), L4b: level('L4b') };
  L.L1.falsePositives = falsePositives.length;
  const trialMatch = { // 試行の欄の一致（案1: 全ての送信で一致。L1 は誤検出がないことも要る）
    L1: L.L1.total > 0 && L.L1.match === L.L1.total && falsePositives.length === 0,
    L2: L.L2.total > 0 && L.L2.match === L.L2.total,
    L3: L.L3.total > 0 && L.L3.match === L.L3.total,
    L4: L.L4.total > 0 && L.L4.match === L.L4.total,
    L4b: L.L4b.total > 0 && L.L4b.match === L.L4b.total,
  };
  // 送信の種類別の内訳（正規送信 / 悪性送信）。案1（全ての送信で一致）だけでは、正規と悪性のどちらが誤判定か分からないため
  const by = (legit, k) => { const xs = perSend.filter((p) => p.legit === legit); return { match: xs.filter((p) => p[k]).length, total: xs.length }; };
  const breakdown = { legit: { L4: by(true, 'L4'), L4b: by(true, 'L4b') }, malicious: { L4: by(false, 'L4'), L4b: by(false, 'L4b') } };
  return {
    perLevel: L, trialMatch,
    missed: perSend.filter((p) => !p.observed).length,       // 見逃し
    falsePositives: falsePositives.length,                    // 誤検出
    // 内容の誤り（観測したが L2〜L4a のどれかが違う）。L4b の誤判定は、測りたい量そのもの（教えない場合の判定）なので、食い違いには数えない（NOTES #57）
    contentErrors: perSend.filter((p) => p.observed && !(p.L2 && p.L3 && p.L4)).length,
    breakdown,
    outOfBrowser,                                              // 外縁③（見逃しに数えない）
    perSend,
  };
}

module.exports = { t1 };

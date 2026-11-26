'use strict';
// 追加実験（D57。experiment_spec.md §14）用の判定の拡張。judge.js の後に読み込み、judge() を GET に対応させる。
// judge.js 自体は変えない（本実験 E15〜E27 の拡張機能のハッシュを変えないため）。
// 変更点（GET の記録だけ）: L1 = 送信（POST または画像GET）を1件記録したか（D50 の POST 限定を、追加実験で GET に広げる）。
// L3 = 本文がないので、URL のクエリからカード番号を取り出す。L2・L4・L4b は同じ。
(function (root) {
  var base = root.__observerJudge;
  function queryOf(url) { try { return new URL(url).search.slice(1); } catch (e) { return null; } }
  function judge(rec, config) {
    var j = base.judge(rec, config);
    if (rec.method === 'GET') { j.L1 = true; j.L3 = base.extractPan(queryOf(rec.url)); }
    return j;
  }
  root.__observerJudge = { judge: judge, extractPan: base.extractPan, hostOf: base.hostOf, originOf: base.originOf };
  if (typeof module !== 'undefined') module.exports = root.__observerJudge;
})(typeof self !== 'undefined' ? self : globalThis);

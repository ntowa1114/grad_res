'use strict';
// L1〜L4 の判定（案A・案B共通。experiment_spec.md §5.3、D37、D50、D51）。拡張機能内のコードで、ブラウザの外では使わない。
// config.legit: 試行ごとに渡される正規宛先（ホスト:ポート）。D51。
(function (root) {
  // L3: 本文の全項目の値から、空白・ハイフンを除いて13〜19桁の数字になる値をカード番号として取り出す。項目名には依存しない。
  // 符号化には対応しない（D30）。復元できなければ null
  function extractPan(body) {
    if (!body) return null;
    var params;
    try { params = new URLSearchParams(body); } catch (e) { return null; }
    var found = null;
    params.forEach(function (v) {
      if (found) return;
      var d = String(v).replace(/[\s-]/g, '');
      if (/^\d{13,19}$/.test(d)) found = d;
    });
    return found;
  }
  function hostOf(url) { try { return new URL(url).host; } catch (e) { return null; } }
  function originOf(url) { try { return new URL(url).origin; } catch (e) { return null; } }
  // 1件の POST 送信の記録から、L1〜L4 の判定を作る
  function judge(rec, config) {
    var host = hostOf(rec.url);
    return {
      L1: rec.method === 'POST',                      // D50: 本文を使わず、POST を1件記録したか
      L2: host,                                       // 宛先のホスト:ポート
      L3: extractPan(rec.body),                       // 復元したカード番号。復元できなければ null
      L4: config && config.legit ? (host === config.legit ? 'allow' : 'deny') : null, // L4a（D51）: 渡された正規宛先と同じなら allow
      // L4b: 正規宛先を使わず、見える情報だけで判定する。送信元のフレームのオリジン（案A: 記録の pageUrl、案B: initiator）と、
      // 宛先のオリジンが同じなら allow、違えば deny（ルールは1つだけ。型の違いを数える道具で、ルールの巧拙を競うものではない）
      L4b: (function () {
        var sender = originOf(rec.pageUrl || rec.initiator), dest = originOf(rec.url);
        return sender && dest ? (sender === dest ? 'allow' : 'deny') : null;
      })(),
    };
  }
  root.__observerJudge = { judge: judge, extractPan: extractPan, hostOf: hostOf, originOf: originOf };
  if (typeof module !== 'undefined') module.exports = root.__observerJudge;
})(typeof self !== 'undefined' ? self : globalThis);

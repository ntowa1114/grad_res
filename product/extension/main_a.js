'use strict';
// 観測点A（MAIN world）: window.fetch を差し替え、POST の宛先・本文を取り出してから元の fetch を呼ぶ。ページの動作は変えない。
// MAIN world のコードは chrome.* を使えないので、同じ拡張機能の ISOLATED world のコード（relay_a.js）へ postMessage で渡す
// （D52 の補足。ページ側から同じ形のメッセージを偽造できる点は限界）。
(function () {
  var origFetch = window.fetch;
  function bodyToString(b) {
    if (b == null) return { kind: 'none', body: null };
    if (typeof b === 'string') return { kind: 'string', body: b };
    if (b instanceof URLSearchParams) return { kind: 'urlsearchparams', body: b.toString() };
    if (b instanceof FormData) { var p = new URLSearchParams(); b.forEach(function (v, k) { if (typeof v === 'string') p.append(k, v); }); return { kind: 'formdata', body: p.toString() }; }
    return { kind: 'other', body: null }; // Blob・ArrayBuffer 等は読まない（今の検体は使わない）
  }
  window.fetch = function (input, init) {
    try {
      var isReq = typeof Request !== 'undefined' && input instanceof Request;
      var url = new URL(isReq ? input.url : String(input), location.href).href;
      var method = String((init && init.method) || (isReq ? input.method : 'GET')).toUpperCase();
      if (method === 'POST') {
        var b = bodyToString(init && init.body);
        window.postMessage({ __observerA: true, t: Date.now(), url: url, method: method, bodyKind: b.kind, body: b.body,
          pageUrl: location.href, top: window === window.top }, '*');
      }
    } catch (e) { /* 観測の失敗でページを壊さない */ }
    return origFetch.apply(this, arguments);
  };
})();

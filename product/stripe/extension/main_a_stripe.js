'use strict';
// 観測点A（MAIN world）実 Stripe 版: ダミー版 main_a.js の fetch の横取り（同じ処理）に、XMLHttpRequest の横取りを足したもの。
// 足した理由: 段階3の測定で、Stripe の m.stripe.network の iFrame が XHR で m.stripe.com/6 へ POST するのを、fetch の横取りだけでは
// 見逃した（D35 の①案Aの実装不足の候補。研究者の方針: カード番号や不正送信の手がかりになり得る送信は拾えたほうがよい 2026-11-20）。
// 横取りするのは fetch と XHR だけ。sendBeacon・WebSocket・画像などは横取りしない（Stripe の測定では、これらの POST は出ていない。限界）。
(function () {
  var origFetch = window.fetch;
  function bodyToString(b) {
    if (b == null) return { kind: 'none', body: null };
    if (typeof b === 'string') return { kind: 'string', body: b };
    if (b instanceof URLSearchParams) return { kind: 'urlsearchparams', body: b.toString() };
    if (b instanceof FormData) { var p = new URLSearchParams(); b.forEach(function (v, k) { if (typeof v === 'string') p.append(k, v); }); return { kind: 'formdata', body: p.toString() }; }
    return { kind: 'other', body: null };
  }
  function emit(url, method, b, via) {
    window.postMessage({ __observerA: true, t: Date.now(), url: url, method: method, bodyKind: b.kind, body: b.body,
      pageUrl: location.href, top: window === window.top, via: via }, '*');
  }
  window.fetch = function (input, init) {
    try {
      var isReq = typeof Request !== 'undefined' && input instanceof Request;
      var url = new URL(isReq ? input.url : String(input), location.href).href;
      var method = String((init && init.method) || (isReq ? input.method : 'GET')).toUpperCase();
      if (method === 'POST') emit(url, method, bodyToString(init && init.body), 'fetch');
    } catch (e) { /* 観測の失敗でページを壊さない */ }
    return origFetch.apply(this, arguments);
  };
  var XO = XMLHttpRequest.prototype.open; var XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__obs = { method: String(method).toUpperCase(), url: new URL(String(url), location.href).href }; } catch (e) { this.__obs = null; }
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try { if (this.__obs && this.__obs.method === 'POST') emit(this.__obs.url, 'POST', bodyToString(body), 'xhr'); } catch (e) { /* 同上 */ }
    return XS.apply(this, arguments);
  };
})();

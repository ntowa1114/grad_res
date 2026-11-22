'use strict';
// 観測点A 強化版（D57。experiment_spec.md §14.4）: MAIN world・all_frames=true・match_about_blank。
// main_a.js の fetch の横取り（同じ処理）に、sendBeacon、画像の src（代入・setAttribute）、form の送信（submit() の呼び出しと、
// 実際に送信される submit イベント）の横取りを足したもの。観測だけをして、元の動作は変えない。観測の失敗でページを壊さない。
// MAIN world は chrome.* を使えないので、ISOLATED world の relay_a_t.js へ postMessage で渡す（D52 の補足）。
(function () {
  function bodyToString(b) {
    if (b == null) return { kind: 'none', body: null };
    if (typeof b === 'string') return { kind: 'string', body: b };
    if (b instanceof URLSearchParams) return { kind: 'urlsearchparams', body: b.toString() };
    if (b instanceof FormData) { var p = new URLSearchParams(); b.forEach(function (v, k) { if (typeof v === 'string') p.append(k, v); }); return { kind: 'formdata', body: p.toString() }; }
    return { kind: 'other', body: null }; // Blob・ArrayBuffer 等は読まない（今の検体は使わない）
  }
  function emit(rec) {
    try {
      window.postMessage(Object.assign({ __observerA: true, t: Date.now(), pageUrl: location.href, top: window === window.top }, rec), '*');
    } catch (e) { /* 観測の失敗でページを壊さない */ }
  }
  function absUrl(u) { return new URL(String(u), location.href).href; }
  function isHttp(u) { return /^https?:/i.test(u); }

  // fetch（main_a.js と同じ処理。POST だけを記録する）
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var isReq = typeof Request !== 'undefined' && input instanceof Request;
      var url = absUrl(isReq ? input.url : input);
      var method = String((init && init.method) || (isReq ? input.method : 'GET')).toUpperCase();
      if (method === 'POST') { var b = bodyToString(init && init.body); emit({ url: url, method: method, transport: 'fetch', bodyKind: b.kind, body: b.body }); }
    } catch (e) { /* 観測の失敗でページを壊さない */ }
    return origFetch.apply(this, arguments);
  };

  // sendBeacon（POST）
  var origBeacon = Navigator.prototype.sendBeacon;
  if (origBeacon) {
    Navigator.prototype.sendBeacon = function (url, data) {
      try { var b = bodyToString(data); emit({ url: absUrl(url), method: 'POST', transport: 'beacon', bodyKind: b.kind, body: b.body }); } catch (e) { /* 同上 */ }
      return origBeacon.apply(this, arguments);
    };
  }

  // 画像GET: src の代入と setAttribute('src', …)。http(s) の URL だけ記録する
  function recordImage(v) {
    var u = absUrl(v);
    if (isHttp(u)) emit({ url: u, method: 'GET', transport: 'image', bodyKind: 'none', body: null });
  }
  var srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (srcDesc && srcDesc.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true, enumerable: srcDesc.enumerable, get: srcDesc.get,
      set: function (v) { try { recordImage(v); } catch (e) { /* 同上 */ } return srcDesc.set.call(this, v); },
    });
  }
  var origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try { if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src') recordImage(value); } catch (e) { /* 同上 */ }
    return origSetAttr.apply(this, arguments);
  };

  // form の送信: POST は本文、GET はクエリに項目を入れた URL を記録する
  function recordForm(form) {
    var method = String(form.method || 'GET').toUpperCase();
    var action = absUrl(form.action);
    if (!isHttp(action)) return;
    var p = new URLSearchParams();
    new FormData(form).forEach(function (v, k) { if (typeof v === 'string') p.append(k, v); });
    if (method === 'POST') { emit({ url: action, method: 'POST', transport: 'form', bodyKind: 'formdata', body: p.toString() }); return; }
    var u = new URL(action);
    p.forEach(function (v, k) { u.searchParams.append(k, v); });
    emit({ url: u.href, method: 'GET', transport: 'form', bodyKind: 'none', body: null });
  }
  var origSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    try { recordForm(this); } catch (e) { /* 同上 */ }
    return origSubmit.apply(this, arguments);
  };
  // ボタンや requestSubmit による送信: ページの処理が preventDefault した（実際には送信されない）ものは記録しない。
  // そのため、バブリング段階（ページ側の処理の後）で、defaultPrevented を見る
  window.addEventListener('submit', function (ev) {
    try { if (ev.target instanceof HTMLFormElement && !ev.defaultPrevented) recordForm(ev.target); } catch (e) { /* 同上 */ }
  });
})();

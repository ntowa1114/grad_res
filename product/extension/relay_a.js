'use strict';
// 観測点A（ISOLATED world）: MAIN world からのメッセージを受け、L1〜L4 の判定をつけて chrome.storage.local に1件ずつ保存する（D52）。
// 保存の鍵は1件ごとにユニーク（読み書きの競合を避ける）。正規宛先は、測定スクリプトが storage の config に入れる（D51）。
(function () {
  window.addEventListener('message', function (ev) {
    if (ev.source !== window || !ev.data || ev.data.__observerA !== true) return;
    var d = ev.data;
    chrome.storage.local.get('config').then(function (r) {
      var rec = { t: d.t, observationPoint: 'A', url: d.url, method: d.method, bodyKind: d.bodyKind, body: d.body, pageUrl: d.pageUrl, top: d.top };
      rec.judge = self.__observerJudge.judge(rec, r.config || null);
      var key = 'rec:' + String(d.t).padStart(15, '0') + ':' + Math.random().toString(36).slice(2, 8);
      return chrome.storage.local.set({ [key]: rec });
    });
  });
})();

'use strict';
// 観測点A 強化版（ISOLATED world）: relay_a.js と同じ処理に、送信手段（transport）の記録を足したもの（D57）。
(function () {
  window.addEventListener('message', function (ev) {
    if (ev.source !== window || !ev.data || ev.data.__observerA !== true) return;
    var d = ev.data;
    chrome.storage.local.get('config').then(function (r) {
      var rec = { t: d.t, observationPoint: 'A', url: d.url, method: d.method, transport: d.transport, bodyKind: d.bodyKind, body: d.body, pageUrl: d.pageUrl, top: d.top };
      rec.judge = self.__observerJudge.judge(rec, r.config || null);
      var key = 'rec:' + String(d.t).padStart(15, '0') + ':' + Math.random().toString(36).slice(2, 8);
      return chrome.storage.local.set({ [key]: rec });
    });
  });
})();

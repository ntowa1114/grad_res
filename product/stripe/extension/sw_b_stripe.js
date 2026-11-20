'use strict';
// 観測点B（Service Worker）: chrome.webRequest.onBeforeRequest（非ブロッキング。requestBody あり）で POST を記録する。
// L1〜L4 の判定をつけて chrome.storage.local に1件ずつ保存する（D52）。正規宛先は、測定スクリプトが storage の config に入れる（D51）。
// リスナーは起動時に同期的に登録する（MV3 の Service Worker は止まっても、イベントで起こされる）。
// 実 Stripe 版: ダミー版 sw_b.js からの変更は、監視対象 URL（URLS）を許可リストの Stripe ホストまで広げた点だけ。判定・記録の処理は同じ。
importScripts('judge.js');
const URLS = ['http://*.localhost/*', 'https://js.stripe.com/*', 'https://api.stripe.com/*', 'https://r.stripe.com/*', 'https://m.stripe.com/*', 'https://m.stripe.network/*', 'https://merchant-ui-api.stripe.com/*', 'https://b.stripecdn.com/*'];

// requestBody から本文を作る。urlencoded は formData、それ以外は raw のバイト列を文字列にする
function bodyOf(rb) {
  if (!rb) return { kind: 'none', body: null };
  if (rb.formData) {
    const p = new URLSearchParams();
    Object.keys(rb.formData).forEach((k) => rb.formData[k].forEach((v) => p.append(k, v)));
    return { kind: 'formData', body: p.toString() };
  }
  if (rb.raw) {
    const dec = new TextDecoder();
    return { kind: 'raw', body: rb.raw.map((x) => (x.bytes ? dec.decode(x.bytes) : '')).join('') };
  }
  return { kind: 'none', body: null };
}

chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (d.method !== 'POST') return; // D50: POST だけを記録する
  const b = bodyOf(d.requestBody);
  const rec = { t: Math.round(d.timeStamp), observationPoint: 'B', url: d.url, method: d.method, bodyKind: b.kind, body: b.body,
    frameId: d.frameId, parentFrameId: d.parentFrameId, initiator: d.initiator || null, type: d.type };
  chrome.storage.local.get('config').then((r) => {
    rec.judge = self.__observerJudge.judge(rec, r.config || null);
    const key = 'rec:' + String(rec.t).padStart(15, '0') + ':' + Math.random().toString(36).slice(2, 8);
    return chrome.storage.local.set({ [key]: rec });
  });
}, { urls: URLS }, ['requestBody']);

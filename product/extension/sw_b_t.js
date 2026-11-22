'use strict';
// 観測点B 段階2（D57。experiment_spec.md §14.2）: sw_b.js（POST を記録）に、画像GET の記録を足したもの。
// 画像GET = type が image で、クエリ（?…）を持つ GET。ページや script の取得（GET）は記録しない。
// 判定のルールは【実装判断】（NOTES_assumptions.md #73）。それ以外は sw_b.js と同じ。
importScripts('judge.js', 'judge_t.js');

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
  const isPost = d.method === 'POST';
  let hasQuery = false;
  try { hasQuery = new URL(d.url).search.length > 1; } catch (e) { /* 記録しない */ }
  const isImageGet = d.method === 'GET' && d.type === 'image' && hasQuery;
  if (!isPost && !isImageGet) return;
  const b = isPost ? bodyOf(d.requestBody) : { kind: 'none', body: null };
  const rec = { t: Math.round(d.timeStamp), observationPoint: 'B', url: d.url, method: d.method, bodyKind: b.kind, body: b.body,
    frameId: d.frameId, parentFrameId: d.parentFrameId, initiator: d.initiator || null, type: d.type };
  chrome.storage.local.get('config').then((r) => {
    rec.judge = self.__observerJudge.judge(rec, r.config || null);
    const key = 'rec:' + String(rec.t).padStart(15, '0') + ':' + Math.random().toString(36).slice(2, 8);
    return chrome.storage.local.set({ [key]: rec });
  });
}, { urls: ['http://*.localhost/*'] }, ['requestBody']);

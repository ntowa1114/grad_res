'use strict';
// CDP 記録（正解記録の一つ。D18、experiment_spec.md §5.1(2)）。
// ページのセッションに加え、別プロセスの iFrame（OOPIF）には、フレームごとに別セッションを張る（NOTES #5）。
const fs = require('node:fs');

function createCdpRecorder(context, page, file) {
  fs.writeFileSync(file, '');
  const frameUrls = new Map(); // frameId -> url
  const pending = new Set();
  const attaching = new WeakMap(); // frame -> Promise<boolean>（二重にセッションを張らない）

  function write(rec) { fs.appendFileSync(file, JSON.stringify(rec) + '\n'); }

  async function attach(session, label) {
    await session.send('Network.enable');
    await session.send('Page.enable');
    try { // アタッチ前に確定済みのフレームの URL も取り込む（frameNavigated は再送されない）
      const walk = (n) => { frameUrls.set(n.frame.id, n.frame.url); (n.childFrames || []).forEach(walk); };
      walk((await session.send('Page.getFrameTree')).frameTree);
    } catch (e) { /* 取れなくても、発信元は Referer で補う */ }
    session.on('Page.frameNavigated', (e) => frameUrls.set(e.frame.id, e.frame.url));
    session.on('Network.requestWillBeSent', (e) => {
      const p = (async () => {
        const req = e.request;
        let postData = req.postData ?? null;
        let postDataSource = postData !== null ? 'event' : null;
        if (postData === null && req.hasPostData) {
          try { postData = (await session.send('Network.getRequestPostData', { requestId: e.requestId })).postData; postDataSource = 'getRequestPostData'; }
          catch (err) { postDataSource = 'error: ' + err.message; }
        }
        write({
          t: new Date().toISOString(), label, requestId: e.requestId, method: req.method, url: req.url,
          frameId: e.frameId ?? null, frameUrl: frameUrls.get(e.frameId) ?? null,
          type: e.type ?? null, initiator: e.initiator?.type ?? null,
          origin: req.headers.Origin ?? null, referer: req.headers.Referer ?? null,
          hasPostData: !!req.hasPostData, postData, postDataSource,
        });
      })();
      pending.add(p); p.finally(() => pending.delete(p));
    });
  }

  function tryAttachFrame(frame) {
    if (frame === page.mainFrame()) return Promise.resolve(false);
    if (attaching.has(frame)) return attaching.get(frame);
    const p = (async () => {
      try { const s = await context.newCDPSession(frame); await attach(s, 'frame'); return true; }
      catch (e) { attaching.delete(frame); return false; } // 親と同じプロセスの iFrame は別セッションがない。親のセッションに出る
    })();
    attaching.set(frame, p);
    return p;
  }

  return {
    async start() {
      await attach(await context.newCDPSession(page), 'page');
      page.on('frameattached', (f) => { tryAttachFrame(f); });
      page.on('framenavigated', (f) => { tryAttachFrame(f); });
    },
    // 現在ある全フレームへのセッション接続が済むまで待つ。iFrame に入力する前に呼ぶ（取りこぼし防止）
    async settle() { await Promise.all(page.frames().map(tryAttachFrame)); },
    async drain() { while (pending.size) await Promise.all([...pending]); },
  };
}

module.exports = { createCdpRecorder };

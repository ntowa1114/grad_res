'use strict';
// CDP 記録（正解記録の一つ。D18、experiment_spec.md §5.1(2)）。
// ページのセッションに加え、別プロセスの iFrame（OOPIF）には、フレームごとに別セッションを張る（NOTES #5）。
const fs = require('node:fs');

function createCdpRecorder(context, page, file) {
  fs.writeFileSync(file, '');
  const frameUrls = new Map(); // frameId -> url
  const pending = new Set();
  const seen = new WeakSet();

  function write(rec) { fs.appendFileSync(file, JSON.stringify(rec) + '\n'); }

  async function attach(session, label) {
    await session.send('Network.enable');
    await session.send('Page.enable');
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

  async function tryAttachFrame(frame) {
    if (frame === page.mainFrame() || seen.has(frame)) return;
    try { const s = await context.newCDPSession(frame); seen.add(frame); await attach(s, 'frame'); }
    catch (e) { /* 親と同じプロセスの iFrame は別セッションがない。親のセッションに出る */ }
  }

  return {
    async start() {
      await attach(await context.newCDPSession(page), 'page');
      page.on('frameattached', (f) => { tryAttachFrame(f); });
      page.on('framenavigated', (f) => { tryAttachFrame(f); });
    },
    async drain() { while (pending.size) await Promise.all([...pending]); },
  };
}

module.exports = { createCdpRecorder };

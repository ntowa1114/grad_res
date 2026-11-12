// スパイク1+2: *.localhost の名前解決、CDP で POST 本文を取れるか（親ページと別オリジン iFrame）
// product/node_modules の playwright を使う
const { chromium } = require('playwright');
const http = require('http');

const received = [];
function mkServer(name, port, handler) {
  const s = http.createServer((rq, rs) => {
    let body = '';
    rq.on('data', c => (body += c));
    rq.on('end', () => {
      received.push({ server: name, method: rq.method, url: rq.url, origin: rq.headers.origin, ct: rq.headers['content-type'], body });
      handler(rq, rs, body);
    });
  });
  return new Promise(r => s.listen(port, '127.0.0.1', () => r(s)));
}

const MERCHANT_HTML = `<!doctype html><html><body>
<form id=f><input name=cardnumber value=4242424242424242><input name=name value=ID-SPIKE-0001><button id=pay type=button>pay</button></form>
<iframe id=psp src="http://psp.localhost:8081/frame"></iframe>
<script>
document.getElementById('pay').onclick = async () => {
  const b = new URLSearchParams(new FormData(document.getElementById('f'))).toString();
  const r = await fetch('http://psp.localhost:8081/pay', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:b});
  document.title = 'psp:' + r.status + ':' + await r.text();
  await fetch('http://sinkhole.localhost:8082/c', {method:'POST', mode:'no-cors', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:b});
  document.title += ' sink-sent';
};
</script></body></html>`;
const FRAME_HTML = `<!doctype html><html><body><button id=fpay>fpay</button><script>
document.getElementById('fpay').onclick = () => fetch('/pay', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'cardnumber=4000056655665556&name=ID-SPIKE-FRAME'});
</script></body></html>`;

(async () => {
  const servers = [
    await mkServer('merchant', 8080, (q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(MERCHANT_HTML); }),
    await mkServer('psp', 8081, (q, s) => {
      if (q.url === '/frame') { s.writeHead(200, { 'Content-Type': 'text/html' }); return s.end(FRAME_HTML); }
      s.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': 'http://merchant.localhost:8080' }); s.end('ok');
    }),
    await mkServer('sinkhole', 8082, (q, s) => { s.writeHead(204); s.end(); }),
  ];

  const channel = process.argv[2];
  console.log('channel:', channel);
  const browser = await chromium.launch({ headless: true, channel });
  console.log('browser version:', browser.version());
  const context = await browser.newContext();
  const page = await context.newPage();

  const cdpLog = [];
  const attach = async (target, label) => {
    const cdp = await context.newCDPSession(target);
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', async e => {
      if (e.request.method === 'GET' && !e.request.url.includes('/pay') && !e.request.url.includes('/c')) {
        cdpLog.push({ label, method: e.request.method, url: e.request.url, frameId: e.frameId, type: e.type }); return;
      }
      const rec = { label, method: e.request.method, url: e.request.url, frameId: e.frameId, type: e.type, initiator: e.initiator && e.initiator.type, hasPostData: e.request.hasPostData, postDataInEvent: e.request.postData ?? null };
      try { rec.getRequestPostData = (await cdp.send('Network.getRequestPostData', { requestId: e.requestId })).postData; } catch (err) { rec.getRequestPostDataError = err.message; }
      cdpLog.push(rec);
    });
  };
  await attach(page, 'page');
  const oopif = [];
  page.on('frameattached', async f => {
    // OOPIF なら frame 用の CDP セッションが作れる。同一プロセスなら例外になる
    await new Promise(r => setTimeout(r, 300));
    try { await attach(f, 'frame'); oopif.push({ url: f.url(), oopif: true }); }
    catch (err) { oopif.push({ url: f.url(), oopif: false, err: err.message.split('\n')[0] }); }
  });

  await page.goto('http://merchant.localhost:8080/');
  await page.waitForTimeout(800);
  await page.click('#pay');
  await page.waitForFunction(() => document.title.includes('sink-sent'));
  const frame = page.frames().find(f => f.url().startsWith('http://psp.localhost'));
  await frame.click('#fpay');
  await page.waitForTimeout(800);
  console.log('title:', await page.title());
  let cd; try { cd = await page.evaluate(() => String(document.getElementById('psp').contentDocument)); } catch (e) { cd = 'ERR ' + e.message; }
  console.log('parent contentDocument:', cd);
  console.log('frames/oopif:', JSON.stringify(oopif));
  console.log('--- CDP ---'); cdpLog.forEach(r => console.log(JSON.stringify(r)));
  console.log('--- server received ---'); received.forEach(r => console.log(JSON.stringify(r)));
  await browser.close();
  servers.forEach(s => s.close());
})().catch(e => { console.error(e); process.exit(1); });

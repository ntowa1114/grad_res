'use strict';
// 段階1: 実 Stripe の実現性確認（1回）。拡張機能なし。正式な実験ではない（expt_log には出さない）。
// 通信先: Stripe の公式ホスト（*.stripe.com / *.stripe.network）のみ。それ以外は止めて一覧に記録する（D13 例外）。
// キーは local_key.txt から実行時に読む。出力に値を書かない（pk_test_REDACTED に置換）。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { createCdpRecorder } = require('../harness/cdp');

const OUT = process.argv[2];
if (!OUT) { console.error('使い方: node spike_stripe.js <出力ディレクトリ>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const KEY = fs.readFileSync(path.join(__dirname, 'local_key.txt'), 'utf8').trim();
if (!/^pk_test_[A-Za-z0-9]+$/.test(KEY)) { console.error('キーの形式が pk_test_ ではありません'); process.exit(2); }
const redact = (s) => (typeof s === 'string' ? s.split(KEY).join('pk_test_REDACTED') : s);

const ALLOW = /(^|\.)stripe\.(com|network)$/;
const PORT = 8090;
const PAGE = `<!doctype html><meta charset="utf-8"><title>spike</title>
<div id="card"></div><button id="pay">pay</button><pre id="out"></pre>
<script src="https://js.stripe.com/v3/"></script>
<script>
  const stripe = Stripe(${JSON.stringify(KEY)});
  const el = stripe.elements().create('card'); el.mount('#card');
  document.getElementById('pay').onclick = async () => {
    const r = await stripe.createPaymentMethod({ type: 'card', card: el });
    document.getElementById('out').textContent = r.error ? 'error:' + r.error.code : 'ok:' + r.paymentMethod.id.slice(0, 3);
  };
</script>`;

(async () => {
  const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(PAGE); });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const blocked = [];
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const local = /(^|\.)localhost$/.test(u.hostname) || u.hostname === '127.0.0.1';
    if (local || ALLOW.test(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    blocked.push({ method: route.request().method(), host: u.host });
    return route.abort();
  });
  const page = await context.newPage();
  const rawFile = path.join(OUT, 'cdp_raw.jsonl');
  const cdp = createCdpRecorder(context, page, rawFile);
  await cdp.start();
  const consoleMsgs = [];
  page.on('console', (m) => consoleMsgs.push(redact(m.text()).slice(0, 200)));
  page.on('pageerror', (e) => consoleMsgs.push('pageerror: ' + redact(e.message).slice(0, 200)));

  const jsHash = {};
  context.on('response', async (res) => {
    if (res.url().startsWith('https://js.stripe.com/v3') && !jsHash.sha256 && res.url().replace(/[?#].*/, '').endsWith('/v3/')) {
      try { const b = await res.body(); jsHash.url = res.url().replace(/[?#].*/, ''); jsHash.sha256 = crypto.createHash('sha256').update(b).digest('hex'); jsHash.fetchedAt = new Date().toISOString(); } catch (e) { /* 取れなくても続行 */ }
    }
  });

  await page.goto(`http://merchant.localhost:${PORT}/`);
  await page.waitForSelector('iframe[name^="__privateStripeFrame"]', { timeout: 30000 });
  await cdp.settle();
  const fl = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
  const num = fl.locator('input[name="cardnumber"]');
  await num.waitFor({ timeout: 30000 });
  await cdp.settle();
  await num.click(); await page.keyboard.type('4242424242424242', { delay: 30 });
  await fl.locator('input[name="exp-date"]').click(); await page.keyboard.type('1235', { delay: 30 });
  await fl.locator('input[name="cvc"]').click(); await page.keyboard.type('123', { delay: 30 });
  await fl.locator('input[name="postal"]').click().catch(() => {}); await page.keyboard.type('12345', { delay: 30 }).catch(() => {});
  await cdp.settle();
  await page.click('#pay');
  await page.waitForFunction(() => document.getElementById('out').textContent !== '', null, { timeout: 30000 }).catch(() => {});
  const result = await page.textContent('#out');
  await new Promise((r) => setTimeout(r, 3000));
  await cdp.drain();

  // 集計（本文は保存しない。カード番号の有無と、項目名だけ）
  const recs = fs.readFileSync(rawFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const PAN = '4242424242424242';
  const rows = recs.filter((r) => r.method !== 'GET' && r.method !== 'OPTIONS' || (r.method === 'OPTIONS')).map((r) => {
    const body = r.postData || '';
    const decoded = (() => { try { return decodeURIComponent(body.replace(/\+/g, ' ')); } catch (e) { return body; } })();
    const hasPan = body.replace(/[\s%20-]/g, '').includes(PAN) || decoded.replace(/[\s-]/g, '').includes(PAN);
    let keys = [];
    if (decoded && /^[\w\[\].\-]+=/.test(decoded)) keys = decoded.split('&').map((kv) => kv.split('=')[0]).slice(0, 40);
    return { method: r.method, host: new URL(r.url).host, path: new URL(r.url).pathname, type: r.type, initiator: r.initiator, label: r.label,
      frameHost: r.frameUrl ? new URL(r.frameUrl).host : null, origin: r.origin, hasBody: !!r.hasPostData, bodyLen: body.length, hasPan, formKeys: keys };
  });
  const allHosts = {};
  for (const r of recs) { const h = new URL(r.url).host; allHosts[h] = (allHosts[h] || 0) + 1; }
  const summary = { result, blocked, jsHash, userAgent: browser.version(), allHosts, nonGet: rows, console: consoleMsgs.slice(0, 20) };
  fs.writeFileSync(path.join(OUT, 'summary.json'), redact(JSON.stringify(summary, null, 2)));
  // 生ログのキーも置換して上書き
  fs.writeFileSync(rawFile, redact(fs.readFileSync(rawFile, 'utf8')));
  await browser.close(); server.close();
  console.log('完了:', path.join(OUT, 'summary.json'));
})().catch((e) => { console.error('失敗:', redact(String(e && e.stack || e))); process.exit(1); });

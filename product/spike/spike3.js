// スパイク3: MV3 拡張の読み込みと、Service Worker の chrome.storage 読み出し（D52）
// product/node_modules の playwright を使う
const { chromium } = require('playwright');
const os = require('os'), path = require('path'), fs = require('fs');
const EXT = path.join(__dirname, 'spike_ext');
const [channel, method, headlessArg] = process.argv.slice(2);
const headless = headlessArg !== 'headed';

async function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error('timeout: ' + label)), ms))]);
}

(async () => {
  console.log(`channel=${channel} method=${method} headless=${headless}`);
  let context, browser, extId;
  if (method === 'A') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-'));
    context = await chromium.launchPersistentContext(dir, { channel, headless, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  } else {
    browser = await chromium.launch({ channel, headless, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'] });
    const bcdp = await browser.newBrowserCDPSession();
    try { extId = (await bcdp.send('Extensions.loadUnpacked', { path: EXT })).id; console.log('loadUnpacked id:', extId); }
    catch (e) { console.log('loadUnpacked ERR:', e.message); }
    context = browser.contexts()[0] || await browser.newContext();
    context._bcdp = bcdp;
  }
  // Service Worker を探す（Playwright の serviceworker イベント、またはブラウザの target 一覧）
  let sw = context.serviceWorkers()[0];
  if (!sw) { try { sw = await withTimeout(context.waitForEvent('serviceworker'), 5000, 'serviceworker'); } catch (e) { console.log(e.message); } }
  console.log('sw url:', sw && sw.url());
  if (sw && !extId) extId = new URL(sw.url()).host;
  if (sw) {
    await sw.evaluate(() => chrome.storage.local.get('log').then(r => chrome.storage.local.set({ log: [...(r.log || []), { t: Date.now(), msg: 'written-by-harness' }] })));
    console.log('read via SW:', JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null))));
  }
  // 停止後の読み出し: CDP Extensions.getStorageItems（SW を介さない）と、拡張機能のページ
  const bcdp = context._bcdp || (browser ? await browser.newBrowserCDPSession() : null);
  if (bcdp && extId) {
    try { console.log('getStorageItems:', JSON.stringify(await bcdp.send('Extensions.getStorageItems', { id: extId, storageArea: 'local' }))); }
    catch (e) { console.log('getStorageItems ERR:', e.message); }
  }
  if (extId) {
    const p = await context.newPage();
    try {
      // SW を止める試み: ページの CDP から stopAllWorkers
      const pc = await context.newCDPSession(p);
      await pc.send('ServiceWorker.enable').catch(e => console.log('SW.enable ERR', e.message));
      await pc.send('ServiceWorker.stopAllWorkers').then(() => console.log('stopAllWorkers sent')).catch(e => console.log('stopAllWorkers ERR', e.message));
      await p.waitForTimeout(1500);
      console.log('sw after stop (playwright list):', context.serviceWorkers().map(w => w.url()));
      await p.goto(`chrome-extension://${extId}/reader.html`);
      console.log('read via extension page:', JSON.stringify(await p.evaluate(() => chrome.storage.local.get(null))));
    } catch (e) { console.log('ext page ERR:', e.message.split('\n')[0]); }
  }
  await (browser ? browser.close() : context.close());
})().catch(e => { console.error('FATAL', e.message.split('\n')[0]); process.exit(1); });

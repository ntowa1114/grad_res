// スパイク3b: 永続コンテキスト + Extensions.loadUnpacked、SW の停止と停止後の読み出し
// product/node_modules の playwright を使う
const { chromium } = require('playwright');
const os = require('os'), path = require('path'), fs = require('fs');
const EXT = path.join(__dirname, 'spike_ext');
const [channel, method] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(`channel=${channel} method=${method}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-'));
  const args = method === 'A' ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : ['--enable-unsafe-extension-debugging'];
  const context = await chromium.launchPersistentContext(dir, { channel, headless: true, args, ignoreDefaultArgs: ['--disable-extensions'] });
  const browser = context.browser();
  console.log('context.browser():', !!browser);
  const page = await context.newPage();
  let bcdp;
  try { bcdp = browser ? await browser.newBrowserCDPSession() : null; } catch (e) { console.log('browserCDP ERR', e.message); }
  if (!bcdp) { bcdp = await context.newCDPSession(page); console.log('using page CDP session for browser domains'); }
  let extId;
  if (method === 'B') {
    try { extId = (await bcdp.send('Extensions.loadUnpacked', { path: EXT })).id; console.log('loadUnpacked id:', extId); }
    catch (e) { console.log('loadUnpacked ERR:', e.message); }
  }
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await Promise.race([context.waitForEvent('serviceworker'), wait(5000).then(() => null)]);
  console.log('sw:', sw && sw.url());
  if (sw) extId = extId || new URL(sw.url()).host;
  if (!extId) return context.close();
  if (sw) await sw.evaluate(() => chrome.storage.local.get('log').then(r => chrome.storage.local.set({ log: [...(r.log || []), { msg: 'written-by-harness' }] })));

  const targets = async () => (await bcdp.send('Target.getTargets')).targetInfos.filter(t => t.url.startsWith('chrome-extension://')).map(t => `${t.type}:${t.url}`);
  console.log('ext targets before stop:', await targets());
  // 停止: SW の target に attach して ServiceWorker ではなく Target.closeTarget を試す
  const swT = (await bcdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extId));
  if (swT) {
    try { console.log('closeTarget:', JSON.stringify(await bcdp.send('Target.closeTarget', { targetId: swT.targetId }))); } catch (e) { console.log('closeTarget ERR', e.message); }
  }
  await wait(1500);
  console.log('ext targets after stop:', await targets());
  try { console.log('getStorageItems:', JSON.stringify(await bcdp.send('Extensions.getStorageItems', { id: extId, storageArea: 'local' }))); }
  catch (e) { console.log('getStorageItems ERR:', e.message); }
  console.log('ext targets after getStorageItems:', await targets());
  try {
    await page.goto(`chrome-extension://${extId}/reader.html`);
    console.log('read via extension page:', JSON.stringify(await page.evaluate(() => chrome.storage.local.get(null))));
  } catch (e) { console.log('ext page ERR:', e.message.split('\n')[0]); }
  await context.close();
})().catch(e => { console.error('FATAL', e.message.split('\n')[0]); process.exit(1); });

'use strict';
// 実 Stripe 版の構造チェック（1回）: Stripe の Card Element の iFrame は別オリジンで、親ページの JS から中身を読めない（SOP）。
// 確認する内容: 親ページから iFrame の contentDocument が null になること（ダミー版の構造チェック I3 と同じ形）。
// 目的: 実 Stripe 版で、入力欄を読む取得部（モデルX）が成立しない根拠を、予測ではなく実測にする（D55）。
// 通信先は許可リストの Stripe ホストと自作の加盟店だけ。入力はしない（カード番号を送らない）。
// 使い方: node stripe/structure_check_stripe.js
const { chromium } = require('playwright');
const merchant = require('./merchant_stripe');
const { hostResolverArg } = require('./allowlist');

async function main() {
  await merchant.start();
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: [hostResolverArg()] });
  let out;
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto('http://merchant.localhost:8080/checkout-s');
    await page.waitForSelector('iframe[name^="__privateStripeFrame"]', { timeout: 30000 });
    out = await page.evaluate(() => {
      const f = document.querySelector('iframe[name^="__privateStripeFrame"]');
      let doc; try { doc = f.contentDocument; } catch (e) { doc = 'threw:' + e.name; }
      return { iframeSrcHost: new URL(f.src).host, contentDocument: doc === null ? null : String(doc) };
    });
  } finally { await browser.close(); await merchant.stop(); }
  const ok = out.contentDocument === null && out.iframeSrcHost !== 'merchant.localhost:8080';
  console.log(`I3-S Stripe の iFrame（${out.iframeSrcHost}）の contentDocument = ${out.contentDocument} → ${ok ? '合格（親ページから読めない）' : '不合格'}`);
  process.exitCode = ok ? 0 : 1;
}
main().catch((e) => { console.error('失敗:', e.message); process.exitCode = 1; });

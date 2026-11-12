'use strict';
// ダイレクトポスト型の簡易動作確認（段階3。自動チェック #1〜#5 を備えた harness は段階4で作る）。
// 使い方: node test/smoke_d.js [/checkout | /checkout-m]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const merchant = require('../merchant/server');
const psp = require('../psp/server');
const sinkhole = require('../sinkhole/server');

(async () => {
  const page_path = process.argv[2] || '/checkout-m';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
  for (const s of [merchant, psp, sinkhole]) { await s.start(); s.begin('SMOKE-001', dir); }
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto('http://merchant.localhost:8080' + page_path);
    await page.fill('#cardnumber', '4242424242424242');
    await page.fill('#exp', '12/30');
    await page.fill('#cvc', '123');
    await page.fill('#name', 'ID-SMOKE-0001');
    await page.click('#pay');
    await page.waitForFunction(() => document.getElementById('result').textContent !== '');
    console.log('result:', await page.textContent('#result'));
    await page.waitForTimeout(300);
  } finally {
    await browser.close();
    for (const s of [merchant, psp, sinkhole]) { s.end(); await s.stop(); }
  }
  for (const n of ['merchant', 'psp', 'sinkhole']) {
    console.log('--- receive_' + n);
    process.stdout.write(fs.readFileSync(path.join(dir, `receive_${n}.jsonl`), 'utf8'));
  }
})();

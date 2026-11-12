'use strict';
// 構造チェックとビルド時の確認（experiment_spec.md §6.4）。EC と検体の実装が終わった時点で、型ごとに1回行う。
// コードを変えたら再実施する。対象: D型（D1、D2）、I型（I1、I2、I3、S3）、検体（S4）。結果は標準出力に出す
// （保存場所は仕様にない。NOTES_assumptions.md に実施結果を記録する）。使い方: node harness/structure_check.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const merchant = require('../merchant/server');
const psp = require('../psp/server');
const sinkhole = require('../sinkhole/server');

const M = 'http://merchant.localhost:8080';
const ID = 'ID-STRUCT-0001';
const results = [];
const add = (id, name, ok, detail) => results.push({ id, name, ok, detail });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../skimmer', f))).digest('hex');
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-'));
  for (const s of [merchant, psp, sinkhole]) { await s.start(); s.begin('STRUCT-001', dir); }
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // D1: 決済ページとフォームが加盟店サーバーから配られる。D2: カード入力欄が最上位フレームの DOM にある
    await page.goto(M + '/checkout');
    const topInputs = await page.evaluate(() => ['cardnumber', 'exp', 'cvc', 'name'].every((n) => !!document.getElementById(n)));
    const merchantGets = readJsonl(path.join(dir, 'receive_merchant.jsonl')).filter((r) => r.method === 'GET' && r.path === '/checkout');
    add('D1', 'D型: 決済ページが加盟店サーバーから配られる', merchantGets.length === 1, `加盟店の GET /checkout ${merchantGets.length} 件`);
    add('D2', 'D型: カード入力欄が最上位フレームの DOM にある', topInputs, `最上位の DOM に4欄=${topInputs}`);

    // I1: iFrame の src のオリジンが PSP。I2: 入力欄は iFrame の中にだけあり、加盟店ページ本体にはない。I3: SOP
    await page.goto(M + '/checkout-i');
    const info = await page.evaluate(() => {
      const f = document.querySelector('iframe');
      let cd; try { cd = f.contentDocument; } catch (e) { cd = 'error:' + e.name; }
      return { src: f && f.src, topInputs: document.querySelectorAll('input').length, cd: cd === null ? null : String(cd) };
    });
    add('I1', 'I型: iFrame の src のオリジンが PSP', new URL(info.src).origin === 'http://psp.localhost:8081', `src=${info.src}`);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const inFrame = frame ? await frame.evaluate(() => document.querySelectorAll('input').length) : 0;
    add('I2', 'I型: 入力欄は iFrame の中にだけある', info.topInputs === 0 && inFrame === 4, `加盟店ページ本体の input=${info.topInputs}、iFrame の input=${inFrame}`);
    add('I3', 'I型: 親ページから iFrame の contentDocument を読むと null かエラー（SOP）', info.cd === null || String(info.cd).startsWith('error:'), `contentDocument=${info.cd}`);

    // S3: モデルY は、偽フォームに入力した後、出し直しの前に、ダミーPSP の受信ログに識別子がない
    const p2 = await ctx.newPage();
    await p2.goto(M + '/checkout-i-m');
    for (const [k, v] of [['cardnumber', '4242424242424242'], ['exp', '12/30'], ['cvc', '123'], ['name', ID]]) await p2.fill('#skim-' + k, v);
    await p2.click('#skim-pay');
    await p2.waitForSelector('iframe');
    await p2.waitForTimeout(500); // 出し直し直後。ここまでに PSP へ届いたものを見る
    const pspNow = readJsonl(path.join(dir, 'receive_psp.jsonl'));
    const sinkNow = readJsonl(path.join(dir, 'receive_sinkhole.jsonl'));
    add('S3', 'モデルY: 偽フォームへの入力後、出し直しの前に PSP の受信ログに識別子がない（sinkhole には届く）',
      pspNow.every((r) => !(r.body || '').includes(ID)) && sinkNow.some((r) => (r.body || '').includes(ID)),
      `PSP の識別子つき ${pspNow.filter((r) => (r.body || '').includes(ID)).length} 件、sinkhole の識別子つき ${sinkNow.filter((r) => (r.body || '').includes(ID)).length} 件`);
  } finally {
    await browser.close();
    for (const s of [merchant, psp, sinkhole]) { s.end(); await s.stop(); }
  }

  // S4: 送信部は2つのモデルで同一。送信部のファイルは1つ（send.js）で、取得部（model_x.js、model_y.js）は
  // 自前の送信手段を持たず、共通の __skimmerSend だけを呼ぶ
  const own = ['model_x.js', 'model_y.js'].map((f) => [f, /fetch\(|XMLHttpRequest|sendBeacon|new Image/.test(fs.readFileSync(path.join(__dirname, '../skimmer', f), 'utf8')), fs.readFileSync(path.join(__dirname, '../skimmer', f), 'utf8').includes('__skimmerSend')]);
  add('S4', '送信部は2つのモデルで同一（共通の send.js だけが送信する）', own.every(([, hasOwn, usesShared]) => !hasOwn && usesShared), `send.js の SHA-256=${sha('send.js').slice(0, 12)}…。${own.map(([f, h, u]) => `${f}: 自前の送信=${h}、共通の呼び出し=${u}`).join('、')}`);

  results.forEach((r) => console.log(`${r.ok ? '合格' : '不合格'} ${r.id} ${r.name} — ${r.detail}`));
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });

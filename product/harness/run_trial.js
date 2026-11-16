'use strict';
// 1試行の実行（experiment_spec.md §1.3、§5、§6.2、§7.1）。実装済みの型は D、I、J、A（D56 の順序）。
// 使い方: node harness/run_trial.js <条件ID> [--out <出力先>]   （出力先の既定はリポジトリ直下の expt_log/）
// 観測点 OX（拡張機能なし）だけ対応。OA・OB（拡張機能の読み込み）は拡張機能の実装後（段階6以降）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const pkg = require('../package.json');
const { parseCondition, nextTrialNumber, identifier } = require('./ids');
const { createCdpRecorder } = require('./cdp');
const { evaluate } = require('./checks');
const merchant = require('../merchant/server');
const psp = require('../psp/server');
const sinkhole = require('../sinkhole/server');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SERVERS = { merchant, psp, sinkhole };
const ENTERED_BASE = { cardnumber: '4242424242424242', exp: '12/30', cvc: '123' }; // 公開テスト番号（D13）
const SETTLE_MS = 500; // 試行の最後の待ち（遅延送信を拾う。待ち時間の根拠は未確認。NOTES #24）

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

// 顧客役の操作（型ごと）。D型: 加盟店ページに入力して送信（D1〜D3）
const FIELDS = ['cardnumber', 'exp', 'cvc', 'name'];
const SKIMMER_FILES = { D: 'model_x.js', I: 'model_y.js', J: 'model_x.js', A: 'model_x.js' }; // 取得部（モデルX: D・J・A、モデルY: I。D31）
const CUSTOMER = {
  // I型: 加盟店ページの PSP の iFrame に入力する（I1、I2、I4）。悪性は、先に偽フォームへ入力し、
  // 出し直された本物の iFrame にもう一度入力する（D25、§1.3）
  async I(page, cond, entered, cdp) {
    await page.goto('http://merchant.localhost:8080' + (cond.kind === 'M' ? '/checkout-i-m' : '/checkout-i'));
    if (cond.kind === 'M') {
      for (const k of FIELDS) await page.fill('#skim-' + k, entered[k]);
      await page.click('#skim-pay');
      await page.waitForSelector('iframe');
    }
    const fl = page.frameLocator('iframe');
    await fl.locator('#cardnumber').waitFor({ timeout: 10000 });
    await cdp.settle(); // iFrame 用の CDP セッションが張れてから入力する
    for (const k of FIELDS) await fl.locator('#' + k).fill(entered[k]);
    await fl.locator('#pay').click();
    await fl.locator('#result:not(:empty)').waitFor({ timeout: 10000 });
  },
  // J型: 加盟店ページに PSP の JS がフォームを作る（J1〜J3）。作られるのを待ってから D型と同じ操作をする
  async J(page, cond, entered) {
    await page.goto('http://merchant.localhost:8080' + (cond.kind === 'M' ? '/checkout-j-m' : '/checkout-j'));
    await page.waitForSelector('#card-form', { timeout: 10000 });
    for (const k of FIELDS) await page.fill('#' + k, entered[k]);
    await page.click('#pay');
    await page.waitForFunction(() => document.getElementById('result').textContent !== '', null, { timeout: 10000 });
  },
  // A型: 加盟店ページのフォームに入力して送信する。送信先は加盟店サーバー（A1〜A3）。操作は D型と同じ
  async A(page, cond, entered) {
    await page.goto('http://merchant.localhost:8080' + (cond.kind === 'M' ? '/checkout-a-m' : '/checkout-a'));
    for (const k of FIELDS) await page.fill('#' + k, entered[k]);
    await page.click('#pay');
    await page.waitForFunction(() => document.getElementById('result').textContent !== '', null, { timeout: 10000 });
  },
  async D(page, cond, entered) {
    await page.goto('http://merchant.localhost:8080' + (cond.kind === 'M' ? '/checkout-m' : '/checkout'));
    for (const k of ['cardnumber', 'exp', 'cvc', 'name']) await page.fill('#' + k, entered[k]);
    await page.click('#pay');
    await page.waitForFunction(() => document.getElementById('result').textContent !== '', null, { timeout: 10000 });
  },
};

async function runTrial(conditionId, { outRoot = path.join(REPO_ROOT, 'expt_log') } = {}) {
  const cond = parseCondition(conditionId);
  if (!CUSTOMER[cond.type]) throw new Error(`型 ${cond.type} は未実装`);
  if (cond.point !== 'OX') throw new Error('観測点 OA・OB は拡張機能の実装後に対応する（今は OX のみ）');

  const trial = nextTrialNumber(outRoot, conditionId);
  const runId = `${conditionId}-${String(trial).padStart(3, '0')}`;
  const dir = path.join(outRoot, conditionId, runId);
  fs.mkdirSync(dir, { recursive: true });
  const seed = crypto.randomInt(0, 2 ** 32);
  const id = identifier(runId, seed);
  const entered = { ...ENTERED_BASE, name: id };
  const meta = { runId, conditionId, trial, seed, identifier: id, entered, startedAt: new Date().toISOString() };
  let browser; let error = null; let cdpFile;

  try {
    for (const s of Object.values(SERVERS)) { await s.start(); s.begin(runId, dir); }
    browser = await chromium.launch({ channel: 'chromium', headless: true }); // channel 必須（NOTES #14）
    meta.browser = { name: 'chromium', channel: 'chromium', version: browser.version(), playwright: pkg.dependencies.playwright };
    const context = await browser.newContext(); // クリーンなプロファイル
    const page = await context.newPage();
    cdpFile = path.join(dir, 'cdp.jsonl');
    const cdp = createCdpRecorder(context, page, cdpFile);
    await cdp.start();
    await CUSTOMER[cond.type](page, cond, entered, cdp);
    await page.waitForTimeout(SETTLE_MS);
    await cdp.drain();
  } catch (e) {
    error = e;
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const s of Object.values(SERVERS)) { s.end(); await s.stop().catch(() => {}); }
    meta.endedAt = new Date().toISOString();
  }

  meta.hashes = {
    extension: null, // 観測点 OX（拡張機能なし）
    skimmer: cond.kind === 'M'
      ? { 'send.js': sha256(path.join(__dirname, '../skimmer/send.js')), [SKIMMER_FILES[cond.type]]: sha256(path.join(__dirname, '../skimmer', SKIMMER_FILES[cond.type])) }
      : null, // 正規の条件はスキマーを埋め込まない
  };
  if (error) {
    meta.valid = false; meta.invalidReasons = [`harness error: ${error.message}`]; meta.checks = [];
  } else {
    const receive = Object.fromEntries(Object.keys(SERVERS).map((n) => [n, readJsonl(path.join(dir, `receive_${n}.jsonl`))]));
    const result = evaluate({ cond, entered, identifier: id, receive, cdp: readJsonl(cdpFile) });
    Object.assign(meta, result);
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return { dir, meta };
}

module.exports = { runTrial };

if (require.main === module) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const outRoot = oi >= 0 ? path.resolve(args[oi + 1]) : undefined;
  runTrial(args[0], outRoot ? { outRoot } : {}).then(({ dir, meta }) => {
    console.log(`${meta.runId}: ${meta.valid ? '有効' : '無効'}  (${dir})`);
    meta.checks.forEach((c) => console.log(`  #${c.id} ${c.ok ? '合格' : '不合格'} ${c.name} — ${c.detail}`));
    if (meta.invalidReasons?.length) console.log('  無効の理由:', meta.invalidReasons.join(' / '));
    if (meta.safetyStop) { console.log('  安全に関わる不合格。実験を止めて原因を確認する（§8）'); process.exitCode = 2; }
    else if (!meta.valid) process.exitCode = 1;
  }).catch((e) => { console.error(e); process.exitCode = 1; });
}

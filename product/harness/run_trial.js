'use strict';
// 1試行の実行（experiment_spec.md §1.3、§5、§6.2、§7.1）。実装済みの型は D、I、J、A、R（D56 の順序）。
// 使い方: node harness/run_trial.js <条件ID> [--out <出力先>]   （出力先の既定はリポジトリ直下の expt_log/）
// 観測点 OX（拡張機能なし）、OA（案A）、OB（案B）に対応。拡張機能の読み込みは harness/extension.js。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const pkg = require('../package.json');
const { parseCondition, nextTrialNumber, identifier } = require('./ids');
const { createCdpRecorder } = require('./cdp');
const { evaluate, LEGIT } = require('./checks');
const ext = require('./extension');
const { t1 } = require('./t1');
const os = require('node:os');
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
  // R型: 加盟店の購入ページでボタンを押し、加盟店の 302 で PSP のページへ移り、そこで入力して送信する（R1〜R3）
  async R(page, cond, entered) {
    await page.goto('http://merchant.localhost:8080/checkout-r');
    await Promise.all([page.waitForURL('http://psp.localhost:8081/checkout', { timeout: 10000 }), page.click('#pay')]);
    await page.waitForSelector('#card-form', { timeout: 10000 });
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

// stopSw: 試行の後、読み出しの前に Service Worker を止める確認用（D52 の【未確認】。通常の試行では使わない）
async function runTrial(conditionId, { outRoot = path.join(REPO_ROOT, 'expt_log'), stopSw = false } = {}) {
  const cond = parseCondition(conditionId);
  if (!CUSTOMER[cond.type]) throw new Error(`型 ${cond.type} は未実装`);

  const trial = nextTrialNumber(outRoot, conditionId);
  const runId = `${conditionId}-${String(trial).padStart(3, '0')}`;
  const dir = path.join(outRoot, conditionId, runId);
  fs.mkdirSync(dir, { recursive: true });
  const seed = crypto.randomInt(0, 2 ** 32);
  const id = identifier(runId, seed);
  const entered = { ...ENTERED_BASE, name: id };
  const meta = { runId, conditionId, trial, seed, identifier: id, entered, startedAt: new Date().toISOString() };
  let browser; let context; let error = null; let cdpFile; let extInfo = null; let extRecords = null;

  try {
    for (const s of Object.values(SERVERS)) { await s.start(); s.begin(runId, dir); }
    if (cond.point === 'OX') {
      browser = await chromium.launch({ channel: 'chromium', headless: true }); // channel 必須（NOTES #14）
      meta.browser = { name: 'chromium', channel: 'chromium', version: browser.version(), playwright: pkg.dependencies.playwright };
      context = await browser.newContext(); // クリーンなプロファイル
    } else {
      // 拡張機能あり: 永続コンテキスト（新しい空のプロファイル）に、--load-extension で読み込む（NOTES #15）
      extInfo = ext.prepare(cond.point);
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
      context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: ext.launchArgs(extInfo.dir), ignoreDefaultArgs: ['--disable-extensions'] });
      meta.browser = { name: 'chromium', channel: 'chromium', version: context.browser()?.version() ?? null, playwright: pkg.dependencies.playwright };
      extInfo.id = ext.idFromPath(extInfo.dir);
      // 正規宛先（D51）を config として渡す。reader.html が開けなければ（ID の誤り・読み込み失敗）ここで例外になり、無効試行になる
      await ext.configure(context, extInfo.id, { legit: new URL(LEGIT[cond.type].url).host, runId });
    }
    const page = await context.newPage();
    cdpFile = path.join(dir, 'cdp.jsonl');
    const cdp = createCdpRecorder(context, page, cdpFile);
    await cdp.start();
    await CUSTOMER[cond.type](page, cond, entered, cdp);
    await page.waitForTimeout(SETTLE_MS);
    await cdp.drain();
    if (extInfo && stopSw) meta.stopSw = await ext.stopServiceWorker(context, page, extInfo.id);
    if (extInfo) extRecords = await ext.readout(context, extInfo.id); // 試行後に読み出して extension.jsonl に書く（D52）
  } catch (e) {
    error = e;
  } finally {
    if (context && cond.point !== 'OX') await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    for (const s of Object.values(SERVERS)) { s.end(); await s.stop().catch(() => {}); }
    meta.endedAt = new Date().toISOString();
  }

  meta.hashes = {
    extension: extInfo ? extInfo.hashes : null, // 観測点 OX は拡張機能なし
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
    if (extRecords) {
      fs.writeFileSync(path.join(dir, 'extension.jsonl'), extRecords.map((r) => JSON.stringify({ runId, ...r })).join('\n') + (extRecords.length ? '\n' : ''));
      // T1 一致テスト。不一致は結果で、試行を無効にしない（無効にするのは毎試行チェックと T2 の不合格）
      meta.t1 = t1({ cond, entered, legitUrl: LEGIT[cond.type].url, cdp: readJsonl(cdpFile), receive, ext: extRecords });
    }
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return { dir, meta };
}

module.exports = { runTrial };

if (require.main === module) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const outRoot = oi >= 0 ? path.resolve(args[oi + 1]) : undefined;
  runTrial(args[0], { ...(outRoot ? { outRoot } : {}), stopSw: args.includes('--stop-sw') }).then(({ dir, meta }) => {
    console.log(`${meta.runId}: ${meta.valid ? '有効' : '無効'}  (${dir})`);
    meta.checks.forEach((c) => console.log(`  #${c.id} ${c.ok ? '合格' : '不合格'} ${c.name} — ${c.detail}`));
    if (meta.t1) {
      const x = meta.t1; const f = (k) => `${x.perLevel[k].match}/${x.perLevel[k].total}`;
      console.log(`  T1 一致（送信単位）L1 ${f('L1')} L2 ${f('L2')} L3 ${f('L3')} L4 ${f('L4')}、見逃し ${x.missed}、誤検出 ${x.falsePositives}、内容の誤り ${x.contentErrors}、外縁③ ${JSON.stringify(x.outOfBrowser)}`);
      console.log(`  T1 試行の欄（全ての送信で一致）L1 ${x.trialMatch.L1} L2 ${x.trialMatch.L2} L3 ${x.trialMatch.L3} L4 ${x.trialMatch.L4}`);
    }
    if (meta.invalidReasons?.length) console.log('  無効の理由:', meta.invalidReasons.join(' / '));
    if (meta.safetyStop) { console.log('  安全に関わる不合格。実験を止めて原因を確認する（§8）'); process.exitCode = 2; }
    else if (!meta.valid) process.exitCode = 1;
  }).catch((e) => { console.error(e); process.exitCode = 1; });
}

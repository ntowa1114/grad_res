'use strict';
// 実 Stripe 版の1試行。使い方: node stripe/run_trial_stripe.js S-N-OX|S-N-OA|S-N-OB|S-M-OX|S-M-OA|S-M-OB [--out <出力先>]（出力先の既定は expt_log/）
// 通信先は、自作の加盟店（127.0.0.1）と、許可リストの Stripe ホスト（テストモード）だけ（D13 の例外）。許可リスト外は名前解決で止める。
// ログのキーは pk_test_REDACTED に置換し、meta.json に書く。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const pkg = require('../package.json');
const { nextTrialNumber, identifier } = require('../harness/ids');
const { createCdpRecorder } = require('../harness/cdp');
const merchant = require('./merchant_stripe');
const sinkhole = require('../sinkhole/server');
const ext = require('./ext_stripe');
const { loadKey, redact, redactDir, REDACTED } = require('./key');
const { hostResolverArg, STRIPE_HOSTS } = require('./allowlist');
const { evaluateStripe } = require('./checks_stripe');
const { t1Stripe } = require('./t1_stripe');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ENTERED = { cardnumber: '4242424242424242', exp: '12/35', cvc: '123', postal: '12345' }; // 公開テスト番号（D13）
const LEGIT_HOST = 'api.stripe.com'; // L4a に渡す正規宛先（D17）
const SETTLE_MS = 3000; // Stripe の計測用 POST などの遅延送信を待つ（段階1で、結果の後も送信が続くことを確認。待ち時間の根拠は未確認）
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

function parseStripeCondition(id) {
  const m = /^S-([NM])-(OX|OA|OB)$/.exec(id);
  if (!m) throw new Error(`条件IDの書式が不正: ${id}`);
  return { id, type: 'S', kind: m[1], point: m[2] };
}

async function typeCard(page, cdp, pagePath) {
  await page.goto(`http://merchant.localhost:8080${pagePath}`);
  await page.waitForSelector('iframe[name^="__privateStripeFrame"]', { timeout: 30000 });
  await cdp.settle();
  const fl = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
  const num = fl.locator('input[name="cardnumber"]');
  await num.waitFor({ timeout: 30000 });
  await cdp.settle();
  await num.click(); await page.keyboard.type(ENTERED.cardnumber, { delay: 30 });
  await fl.locator('input[name="exp-date"]').click(); await page.keyboard.type(ENTERED.exp.replace('/', ''), { delay: 30 });
  await fl.locator('input[name="cvc"]').click(); await page.keyboard.type(ENTERED.cvc, { delay: 30 });
  await fl.locator('input[name="postal"]').click(); await page.keyboard.type(ENTERED.postal, { delay: 30 });
  await cdp.settle();
  await page.click('#pay');
  await page.waitForFunction(() => document.getElementById('result').textContent !== '', null, { timeout: 30000 });
}

async function runTrial(conditionId, { outRoot = path.join(REPO_ROOT, 'expt_log') } = {}) {
  const cond = parseStripeCondition(conditionId);
  const key = loadKey();
  const trial = nextTrialNumber(outRoot, conditionId);
  const runId = `${conditionId}-${String(trial).padStart(3, '0')}`;
  const dir = path.join(outRoot, conditionId, runId);
  fs.mkdirSync(dir, { recursive: true });
  const seed = crypto.randomInt(0, 2 ** 32);
  const meta = { runId, conditionId, trial, seed, identifier: identifier(runId, seed), entered: ENTERED, startedAt: new Date().toISOString(),
    variant: 'stripe-test-mode', allowedHosts: STRIPE_HOSTS };
  const synthetic = cond.kind === 'M'; // S-M: 取得なしの模擬送信（取得部は再現しない。inject_send_stripe.js）
  const pagePath = synthetic ? `/checkout-s-m?id=${encodeURIComponent(meta.identifier)}` : '/checkout-s';
  let browser; let context; let error = null; let extInfo = null; let extRecords = null; let result = null; let guard = 'not-run';
  const jsHash = {};
  const args = [hostResolverArg()];
  try {
    await merchant.start(); merchant.begin(runId, dir);
    if (synthetic) { await sinkhole.start(); sinkhole.begin(runId, dir); }
    if (cond.point === 'OX') {
      browser = await chromium.launch({ channel: 'chromium', headless: true, args });
      meta.browser = { name: 'chromium', channel: 'chromium', version: browser.version(), playwright: pkg.dependencies.playwright };
      context = await browser.newContext();
    } else {
      extInfo = ext.prepare(cond.point);
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
      context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [...args, ...ext.launchArgs(extInfo.dir)], ignoreDefaultArgs: ['--disable-extensions'] });
      meta.browser = { name: 'chromium', channel: 'chromium', version: context.browser()?.version() ?? null, playwright: pkg.dependencies.playwright };
      extInfo.id = ext.idFromPath(extInfo.dir);
      await ext.configure(context, extInfo.id, { legit: LEGIT_HOST, runId });
    }
    // 遮断の確認: 許可リスト外のホストへの fetch が、名前解決の失敗で終わること（通信は出ない）
    const gp = await context.newPage();
    guard = await gp.evaluate(() => fetch('https://example.com/', { mode: 'no-cors' }).then(() => 'reached', () => 'blocked'));
    await gp.close();
    if (guard !== 'blocked') throw new Error(`許可リスト外への遮断が効いていない（${guard}）。Stripe へ通信する前に止める`);
    context.on('response', async (res) => { // Stripe.js の取得日時と SHA-256（Stripe 側の更新による結果の変化を、後で追えるようにする）
      const u = res.url().replace(/[?#].*/, '');
      if (u === 'https://js.stripe.com/v3/' && !jsHash.sha256) {
        try { jsHash.url = u; jsHash.sha256 = crypto.createHash('sha256').update(await res.body()).digest('hex'); jsHash.fetchedAt = new Date().toISOString(); } catch (e) { /* 続行 */ }
      }
    });
    const page = await context.newPage();
    const cdp = createCdpRecorder(context, page, path.join(dir, 'cdp.jsonl'));
    await cdp.start();
    await typeCard(page, cdp, pagePath);
    result = await page.textContent('#result');
    await page.waitForTimeout(SETTLE_MS);
    await cdp.drain();
    if (extInfo) extRecords = await ext.readout(context, extInfo.id);
  } catch (e) { error = e; }
  finally {
    if (context && cond.point !== 'OX') await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    merchant.end(); await merchant.stop().catch(() => {});
    if (synthetic) { sinkhole.end(); await sinkhole.stop().catch(() => {}); }
    meta.endedAt = new Date().toISOString();
  }
  meta.stripeJs = jsHash;
  // S-M: 取得部はない（Stripe の入力欄は読まない）。送信部 send.js と、模擬送信 inject_send_stripe.js のハッシュを記録する
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  meta.hashes = { extension: extInfo ? extInfo.hashes : null,
    skimmer: synthetic ? Object.fromEntries(Object.entries(merchant.STATIC).map(([k, f]) => [path.basename(k), sha(f)])) : null };
  if (synthetic) meta.skimmer = { kind: 'synthetic-send', acquisition: false, note: '取得なしの模擬送信。Stripe の入力欄は読まず、偽フォームも作らない。固定の公開テスト番号と識別子を、共通の送信部から sinkhole へ1回送る' };
  const cdpRecs = readJsonl(path.join(dir, 'cdp.jsonl'));
  if (error) { meta.valid = false; meta.invalidReasons = [`harness error: ${redact(error.message, key)}`]; meta.checks = []; }
  else {
    Object.assign(meta, evaluateStripe({ cond, entered: ENTERED, cdp: cdpRecs, receiveMerchant: readJsonl(path.join(dir, 'receive_merchant.jsonl')),
      receiveSinkhole: readJsonl(path.join(dir, 'receive_sinkhole.jsonl')), identifier: meta.identifier, result, guard }));
    if (extRecords) {
      fs.writeFileSync(path.join(dir, 'extension.jsonl'), extRecords.map((r) => JSON.stringify({ runId, ...r })).join('\n') + (extRecords.length ? '\n' : ''));
      meta.t1 = t1Stripe({ entered: ENTERED, legitHost: LEGIT_HOST, cdp: cdpRecs, ext: extRecords });
    }
  }
  meta.redaction = { key: REDACTED, note: 'cdp.jsonl・extension.jsonl などに含まれる Stripe の公開可能キー（テストモード）の値を、保存後に pk_test_REDACTED へ置換した（D13 の例外の記録方針）' };
  fs.writeFileSync(path.join(dir, 'meta.json'), redact(JSON.stringify(meta, null, 2), key) + '\n');
  meta.redaction.filesRewritten = redactDir(dir, key);
  fs.writeFileSync(path.join(dir, 'meta.json'), redact(JSON.stringify(meta, null, 2), key) + '\n');
  return { dir, meta };
}
module.exports = { runTrial, parseStripeCondition };

if (require.main === module) {
  const args = process.argv.slice(2); const oi = args.indexOf('--out');
  runTrial(args[0], oi >= 0 ? { outRoot: path.resolve(args[oi + 1]) } : {}).then(({ dir, meta }) => {
    console.log(`${meta.runId}: ${meta.valid ? '有効' : '無効'}  (${dir})`);
    (meta.checks || []).forEach((c) => console.log(`  #${c.id} ${c.ok ? '合格' : '不合格'} ${c.name} — ${c.detail}`));
    if (meta.hostsContacted) console.log('  接触したホスト:', meta.hostsContacted.join(', '));
    if (meta.t1) { const x = meta.t1; const f = (k) => `${x.perLevel[k].match}/${x.perLevel[k].total}`;
      console.log(`  T1（カード送信）L1 ${f('L1')} L2 ${f('L2')} L3 ${f('L3')} L4a ${f('L4')} L4b ${f('L4b')}、見逃し ${x.missed}、誤検出 ${x.falsePositives}、内容の誤り ${x.contentErrors}`);
      console.log(`  その他の POST: ${x.other.total} 件、観測 ${x.other.observed}、L1 ${x.other.L1.match}/${x.other.L1.total}、L2 ${x.other.L2.match}/${x.other.L2.total}`); }
    if (meta.invalidReasons?.length) console.log('  無効の理由:', meta.invalidReasons.join(' / '));
    if (meta.safetyStop) { console.log('  安全に関わる不合格。止める'); process.exitCode = 2; } else if (!meta.valid) process.exitCode = 1;
  }).catch((e) => { console.error('失敗:', e.message); process.exitCode = 1; });
}

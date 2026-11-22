'use strict';
// 拡張機能の準備・読み込み・設定・読み出し（D52、D40。experiment_spec.md §5.3、§7.1）。
// 案Aと案Bは別々の試行で測るので（D40）、manifest を2つ置き、試行ごとに一時フォルダへコピーして
// 選んだ manifest を manifest.json として読み込む。コピーはビルドではない（ファイルの中身は変えない）。ハッシュは元のファイルから作る。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC = path.join(__dirname, '..', 'extension');
const FILES = { // 観測点ごとに読み込むファイル（manifest は別に選ぶ）
  OA: ['main_a.js', 'relay_a.js', 'judge.js', 'reader.html'],
  OB: ['sw_b.js', 'judge.js', 'reader.html'],
};
const MANIFEST = { OA: 'manifest_a.json', OB: 'manifest_b.json' };
// 追加実験（D57）の版。本実験の版（OA・OB）のファイルは変えず、別のファイルで作る（本実験のハッシュを変えないため）。
// OA_T = 強化版の案A（fetch・sendBeacon・画像・form を横取り）、OB_T = 案B 段階2（画像GET も記録）。案B 段階1は OB（現行）のまま
FILES.OA_T = ['main_a_t.js', 'relay_a_t.js', 'judge.js', 'judge_t.js', 'reader.html'];
FILES.OB_T = ['sw_b_t.js', 'judge.js', 'judge_t.js', 'reader.html'];
MANIFEST.OA_T = 'manifest_a_t.json';
MANIFEST.OB_T = 'manifest_b_t.json';
// 条件に使う拡張機能の版。追加実験（transport つき）の案A は強化版（OA_T）。案B は既定で現行（OB。段階1）、段階2 は override で OB_T
function variantFor(cond, override) {
  if (override) return override;
  return cond.transport && cond.point === 'OA' ? 'OA_T' : cond.point;
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// 現在の拡張機能（観測点ごと）のファイルの SHA-256 と、全体のハッシュ。集計は、現在の版の試行だけを数える（コードを変えたら取り直す。§6.2【提案】）
function currentHashes(point) {
  if (!FILES[point]) throw new Error(`観測点 ${point} に拡張機能はない`);
  const files = {};
  for (const f of [...FILES[point], MANIFEST[point]]) files[f] = sha256(fs.readFileSync(path.join(SRC, f)));
  const combined = sha256(Object.keys(files).sort().map((k) => `${k}:${files[k]}`).join('\n'));
  return { point, files, combined, settings: { world: point.startsWith('OA') ? 'MAIN' : null, all_frames: point.startsWith('OA') ? true : null, ...(point === 'OA_T' ? { match_about_blank: true } : {}) } };
}

// 一時フォルダへコピーし、{ dir, hashes } を返す。hashes は元のファイルの SHA-256（試行の meta.json に記録する。§7.1）
function prepare(point) {
  const hashes = currentHashes(point);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ext-${point}-`));
  for (const f of FILES[point]) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.copyFileSync(path.join(SRC, MANIFEST[point]), path.join(dir, 'manifest.json'));
  return { dir, hashes };
}

// 展開済み（unpacked）拡張機能の ID: フォルダのパスの SHA-256 の先頭16バイトを a〜p に写したもの（Chrome の既知の方式）。
// 合っているかは reader.html を開けるかで確認する（open で検証）
function idFromPath(dir) {
  const h = crypto.createHash('sha256').update(fs.realpathSync(dir)).digest('hex').slice(0, 32);
  return [...h].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

// 拡張機能のページ（reader.html）を開いて、storage の読み書きに使う
async function openReader(context, id) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/reader.html`);
  return page;
}

// 試行の開始前: 正規宛先（D51）と実行IDを config として渡す
async function configure(context, id, config) {
  const page = await openReader(context, id);
  await page.evaluate((c) => chrome.storage.local.set({ config: c }), config);
  await page.close();
}

// 試行の終了後: 保存された記録を全件読み出し、時刻順の配列で返す（D52。Service Worker が止まっていても読める。NOTES #7、#16）
async function readout(context, id) {
  const page = await openReader(context, id);
  const all = await page.evaluate(() => chrome.storage.local.get(null));
  await page.close();
  return Object.keys(all).filter((k) => k.startsWith('rec:')).sort().map((k) => all[k]);
}

// 確認用: 拡張機能の Service Worker の target を CDP で閉じる（D52 の【未確認】。MV3 の自然な停止と同じ状態かは未確認。NOTES #8）。
// 閉じる前後の target の数を返す
async function stopServiceWorker(context, page, id) {
  const cdp = await context.newCDPSession(page);
  const swTargets = async () => (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'service_worker' && t.url.includes(id));
  const before = await swTargets();
  for (const t of before) await cdp.send('Target.closeTarget', { targetId: t.targetId });
  await new Promise((r) => setTimeout(r, 1500));
  return { before: before.length, after: (await swTargets()).length };
}

function launchArgs(dir) {
  return [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`];
}

module.exports = { variantFor, prepare, currentHashes, idFromPath, configure, readout, stopServiceWorker, launchArgs, FILES };

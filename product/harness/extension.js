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
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// 一時フォルダへコピーし、{ dir, hashes } を返す。hashes は元のファイルの SHA-256（試行の meta.json に記録する。§7.1）
function prepare(point) {
  if (!FILES[point]) throw new Error(`観測点 ${point} に拡張機能はない`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ext-${point}-`));
  const files = {};
  for (const f of FILES[point]) { const b = fs.readFileSync(path.join(SRC, f)); fs.writeFileSync(path.join(dir, f), b); files[f] = sha256(b); }
  const m = fs.readFileSync(path.join(SRC, MANIFEST[point]));
  fs.writeFileSync(path.join(dir, 'manifest.json'), m);
  files[MANIFEST[point]] = sha256(m);
  const combined = sha256(Object.keys(files).sort().map((k) => `${k}:${files[k]}`).join('\n'));
  return { dir, hashes: { point, files, combined, settings: { world: point === 'OA' ? 'MAIN' : null, all_frames: point === 'OA' ? true : null } } };
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

function launchArgs(dir) {
  return [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`];
}

module.exports = { prepare, idFromPath, configure, readout, launchArgs, FILES };

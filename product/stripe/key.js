'use strict';
// Stripe のテスト用公開可能キーの読み込みと、ログからの置換。キーは local_key.txt（gitignore 済み）にだけある。値は表示しない。
const fs = require('node:fs');
const path = require('node:path');

function loadKey(file = path.join(__dirname, 'local_key.txt')) {
  const k = fs.readFileSync(file, 'utf8').trim();
  if (!/^pk_test_[A-Za-z0-9]+$/.test(k)) throw new Error('local_key.txt の形式が pk_test_ の公開可能キーではない');
  return k;
}
const REDACTED = 'pk_test_REDACTED';
const redact = (s, key) => (typeof s === 'string' && key ? s.split(key).join(REDACTED) : s);
// 試行フォルダ内の全ファイルのキーを置換する（D13 例外の記録方針。meta.json に置換したことを書く）
function redactDir(dir, key) {
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f); const s = fs.readFileSync(p, 'utf8');
    if (s.includes(key)) { fs.writeFileSync(p, redact(s, key)); n++; }
  }
  return n;
}
module.exports = { loadKey, redact, redactDir, REDACTED };

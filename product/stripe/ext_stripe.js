'use strict';
// 実 Stripe 版の拡張機能の準備。ダミー版の JS（relay_a.js、judge.js、reader.html）は、元のファイルをそのままコピーして使う。
// Stripe 版で別にしたのは、main_a_stripe.js（fetch に XHR の横取りを足したもの）、manifest（matches・権限）と、sw_b_stripe.js（監視対象 URL を広げたもの）だけ。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const base = require('../harness/extension');

const DUMMY = path.join(__dirname, '..', 'extension');
const OWN = path.join(__dirname, 'extension');
const SPEC = { // [コピー元, コピー先の名前]
  OA: { files: [[OWN, 'main_a_stripe.js'], [DUMMY, 'relay_a.js'], [DUMMY, 'judge.js'], [DUMMY, 'reader.html']], manifest: 'manifest_a_stripe.json' },
  OB: { files: [[OWN, 'sw_b_stripe.js'], [DUMMY, 'judge.js'], [DUMMY, 'reader.html']], manifest: 'manifest_b_stripe.json' },
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function currentHashes(point) {
  const s = SPEC[point]; if (!s) throw new Error(`観測点 ${point} に拡張機能はない`);
  const files = {};
  for (const [d, f] of s.files) files[f] = sha(fs.readFileSync(path.join(d, f)));
  files[s.manifest] = sha(fs.readFileSync(path.join(OWN, s.manifest)));
  const combined = sha(Object.keys(files).sort().map((k) => `${k}:${files[k]}`).join('\n'));
  return { point, variant: 'stripe', files, combined, settings: { world: point === 'OA' ? 'MAIN' : null, all_frames: point === 'OA' ? true : null } };
}
function prepare(point) {
  const hashes = currentHashes(point); const s = SPEC[point];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ext-stripe-${point}-`));
  for (const [d, f] of s.files) fs.copyFileSync(path.join(d, f), path.join(dir, f));
  fs.copyFileSync(path.join(OWN, s.manifest), path.join(dir, 'manifest.json'));
  return { dir, hashes };
}
module.exports = { currentHashes, prepare, idFromPath: base.idFromPath, configure: base.configure, readout: base.readout, launchArgs: base.launchArgs };

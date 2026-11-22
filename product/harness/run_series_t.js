'use strict';
// 追加実験（D57。experiment_spec.md §14）の反復実行。条件 T<B|G|F>-M-<OA|OB> を、有効な試行が3回になるまで実行する。
// 食い違い（試行間で結果が揃わない、または T1 で見逃し・誤検出・内容の誤りが1回でもある）が出た条件は、10回に増やす（D21）。
// 無効試行は回数に入れず、記録を残したまま再実行する（D24）。安全に関わる不合格（#4・#5）が出たら止める（§8）。
// 拡張機能の版は、現在の版のハッシュの試行だけを数える（旧い版の試行は記録として残し、数えない）。
// 使い方: node harness/run_series_t.js [--out <出力先>] [--ext <版: OA_T|OB|OB_T>] <条件ID> ...
const fs = require('node:fs');
const path = require('node:path');
const { runTrial } = require('./run_trial');
const { parseCondition } = require('./ids');
const { hasDiscrepancy, BASE_REPS, EXTENDED_REPS } = require('./summarize');
const ext = require('./extension');

const MAX_INVALID = 5;

function trialsOf(root, condId, variant) {
  const dir = path.join(root, condId);
  if (!fs.existsSync(dir)) return { valid: [], invalid: 0 };
  const cur = ext.currentHashes(variant).combined;
  const metas = fs.readdirSync(dir).map((n) => path.join(dir, n, 'meta.json')).filter(fs.existsSync).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
    .filter((m) => m.hashes && m.hashes.extension && m.hashes.extension.combined === cur);
  const valid = metas.filter((m) => m.valid && m.t1);
  return { valid, invalid: metas.length - valid.length };
}

async function runCondition(condId, outRoot, extVariant) {
  const cond = parseCondition(condId);
  const variant = ext.variantFor(cond, extVariant);
  for (;;) {
    const { valid, invalid } = trialsOf(outRoot, condId, variant);
    const target = hasDiscrepancy(valid).any ? EXTENDED_REPS : BASE_REPS;
    if (valid.length >= target) return { condId, variant, valid: valid.length, invalid, target };
    if (invalid >= MAX_INVALID) throw new Error(`${condId}: 無効試行が ${invalid} 件。原因を調べる`);
    const { meta } = await runTrial(condId, { outRoot, extVariant });
    console.log(`  ${meta.runId} [${variant}]: ${meta.valid ? '有効' : '無効 ' + (meta.invalidReasons || []).join(' / ')}`);
    if (meta.safetyStop) throw new Error(`${meta.runId}: 安全に関わる不合格。実験を止める（§8）`);
  }
}

module.exports = { runCondition, trialsOf };

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const outRoot = val('--out') ? path.resolve(val('--out')) : path.join(__dirname, '..', '..', 'expt_log');
  const extVariant = val('--ext');
  const conds = args.filter((a) => /^T[BGF]-M-O[AB]$/.test(a));
  (async () => {
    for (const c of conds) {
      const r = await runCondition(c, outRoot, extVariant);
      console.log(`${c} [${r.variant}]: 有効 ${r.valid}（目標 ${r.target}）、無効 ${r.invalid}`);
    }
  })().catch((e) => { console.error(e.message); process.exitCode = 2; });
}

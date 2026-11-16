'use strict';
// 反復実行（D21、§7.2）: 18条件それぞれで、有効な試行が3回になるまで実行する。食い違い（試行間で結果が揃わない、または
// T1 で見逃し・誤検出・内容の誤りが1回でもある）が出た条件は、有効な試行が10回になるまで増やす。無効試行は回数に入れず、
// 記録を残したまま再実行する（D24）。安全に関わる不合格（#4・#5）が出たら全体を止める（§8）。
// 使い方: node harness/run_series.js [--out <出力先>] [条件ID ...]   （条件ID を省略すると18条件すべて）
const path = require('node:path');
const { runTrial } = require('./run_trial');
const { conditions, hasDiscrepancy, BASE_REPS, EXTENDED_REPS } = require('./summarize');
const fs = require('node:fs');

const MAX_INVALID = 5; // 1条件で無効試行がこれに達したら止める（原因を調べる。無限に再実行しない）

function validTrials(root, cond) {
  const dir = path.join(root, cond);
  if (!fs.existsSync(dir)) return { valid: [], invalid: 0 };
  const metas = fs.readdirSync(dir).map((n) => path.join(dir, n, 'meta.json')).filter(fs.existsSync).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const valid = metas.filter((m) => m.valid && m.t1);
  return { valid, invalid: metas.length - valid.length };
}

async function runCondition(cond, outRoot) {
  for (;;) {
    const { valid, invalid } = validTrials(outRoot, cond);
    const target = hasDiscrepancy(valid).any ? EXTENDED_REPS : BASE_REPS;
    if (valid.length >= target) return { cond, valid: valid.length, invalid, target };
    if (invalid >= MAX_INVALID) throw new Error(`${cond}: 無効試行が ${invalid} 件。原因を調べる`);
    const { meta } = await runTrial(cond, { outRoot });
    console.log(`  ${meta.runId}: ${meta.valid ? '有効' : '無効 ' + (meta.invalidReasons || []).join(' / ')}`);
    if (meta.safetyStop) throw new Error(`${meta.runId}: 安全に関わる不合格。実験を止める（§8）`);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const outRoot = oi >= 0 ? path.resolve(args[oi + 1]) : path.join(__dirname, '..', '..', 'expt_log');
  const conds = args.filter((a, i) => i !== oi && i !== oi + 1 && /^[IDJAR]-[NM]-O[AB]$/.test(a));
  (async () => {
    for (const c of (conds.length ? conds : conditions())) {
      const r = await runCondition(c, outRoot);
      console.log(`${c}: 有効 ${r.valid}（目標 ${r.target}）、無効 ${r.invalid}`);
    }
  })().catch((e) => { console.error(e.message); process.exitCode = 2; });
}
module.exports = { runCondition };

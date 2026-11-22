'use strict';
// 追加実験（D57。experiment_spec.md §14.6）の結果表。expt_log/ の meta.json から機械的に作る（人の判断は入れない。D37）。
// 版（拡張機能のハッシュ）ごとに数える。旧い版の試行は数えない。
// 使い方: node harness/summarize_t.js [expt_log のパス]
const path = require('node:path');
const { trialsOf } = require('./run_series_t');
const { hasDiscrepancy, mark } = require('./summarize');

const TRANSPORTS = { B: 'sendBeacon', G: '画像GET', F: 'form.submit' };
const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L4b'];
const LABEL = { L1: 'L1', L2: 'L2', L3: 'L3', L4: 'L4a', L4b: 'L4b' };
// [観測点の見出し, 条件の観測点, 版]
const COLUMNS = [['案A 強化版', 'OA', 'OA_T'], ['案B 段階1（現行）', 'OB', 'OB'], ['案B 段階2（GET 記録つき）', 'OB', 'OB_T']];

function summarize(root, cond, variant) {
  const { valid, invalid } = trialsOf(root, cond, variant);
  const per = (f) => valid.flatMap((m) => m.t1.perSend.filter(f));
  const mal = per((p) => !p.legit), leg = per((p) => p.legit);
  const cnt = (xs, k) => `${xs.filter((p) => p[k]).length}/${xs.length}`;
  const levels = Object.fromEntries(LEVELS.map((l) => { const match = valid.filter((m) => m.t1.trialMatch[l]).length; return [l, { match, total: valid.length, mark: mark(match, valid.length) }]; }));
  return {
    cond, variant, valid: valid.length, invalid, levels, discrepancy: hasDiscrepancy(valid),
    missed: valid.reduce((a, m) => a + m.t1.missed, 0), falsePositives: valid.reduce((a, m) => a + m.t1.falsePositives, 0),
    contentErrors: valid.reduce((a, m) => a + m.t1.contentErrors, 0),
    // 悪性送信（sinkhole 宛て）と正規送信（PSP 宛て）を分けた、送信単位の一致数 / 送信数
    malicious: Object.fromEntries(['observed', ...LEVELS].map((k) => [k, cnt(mal, k)])),
    legit: Object.fromEntries(['observed', ...LEVELS].map((k) => [k, cnt(leg, k)])),
  };
}

function render(root) {
  const S = {};
  const lines = ['試行の欄（全ての送信で一致。一致数 / 有効試行数）', '', '| 手段 | 観測点・版 | 有効 | L1 | L2 | L3 | L4a | L4b | 見逃し | 誤検出 | 内容の誤り | 食い違い（試行間／T1） |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const t of Object.keys(TRANSPORTS)) for (const [name, point, variant] of COLUMNS) {
    const cond = `T${t}-M-${point}`;
    const x = S[`${cond}|${variant}`] = summarize(root, cond, variant);
    if (!x.valid && !x.invalid) continue;
    lines.push(`| ${TRANSPORTS[t]}（${t}） | ${name} | ${x.valid}${x.invalid ? `（無効 ${x.invalid}）` : ''} | ${LEVELS.map((l) => `${x.levels[l].match}/${x.levels[l].total} ${x.levels[l].mark}`).join(' | ')} | ${x.missed} | ${x.falsePositives} | ${x.contentErrors} | ${x.discrepancy.between ? '有' : '無'}／${x.discrepancy.t1 ? '有' : '無'} |`);
  }
  lines.push('', '送信単位の内訳（一致した送信数 / 送信数。悪性送信 = sinkhole 宛て、正規送信 = PSP 宛て。observed = 拡張機能が記録した送信）', '', '| 手段 | 観測点・版 | 種類 | observed | L1 | L2 | L3 | L4a | L4b |', '|---|---|---|---|---|---|---|---|---|');
  for (const t of Object.keys(TRANSPORTS)) for (const [name, point, variant] of COLUMNS) {
    const x = S[`T${t}-M-${point}|${variant}`];
    if (!x.valid) continue;
    for (const [kind, k] of [['悪性', 'malicious'], ['正規', 'legit']]) lines.push(`| ${TRANSPORTS[t]}（${t}） | ${name} | ${kind} | ${['observed', ...LEVELS].map((l) => x[k][l]).join(' | ')} |`);
  }
  const cmp = compareToOx(root).filter((r) => r.checked);
  lines.push('', `OX との内容比較（受信ログ。識別子・時刻・User-Agent を除く）: 有効 ${cmp.reduce((a, r) => a + r.checked, 0)} 件を比べ、差分 ${cmp.flatMap((r) => r.diffs).length} 件${cmp.some((r) => r.diffs.length) ? '（' + cmp.flatMap((r) => r.diffs).join('、') + '）' : ''}`);
  return { text: lines.join('\n'), S };
}

// OX の基準試行（001）との受信ログの内容比較（§6.3 と同じ考え方）。識別子・時刻・User-Agent を除く。GET はクエリも比べる
const fs = require('node:fs');
const norm = (b) => String(b || '').replace(/ID-[A-Z0-9-]+/g, 'ID');
function receiveSig(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir).filter((n) => /^receive_.*\.jsonl$/.test(n))) {
    out[f] = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse).map((x) => [x.method, norm(x.path), norm(x.body)].join(' ')).sort();
  }
  return out;
}
function compareToOx(root) {
  const res = [];
  for (const t of Object.keys(TRANSPORTS)) {
    const baseDir = path.join(root, `T${t}-M-OX`, `T${t}-M-OX-001`);
    const base = JSON.stringify(receiveSig(baseDir));
    for (const [, point, variant] of COLUMNS) {
      const cond = `T${t}-M-${point}`;
      const { valid } = trialsOf(root, cond, variant);
      res.push({ cond, variant, checked: valid.length, diffs: valid.filter((m) => JSON.stringify(receiveSig(path.join(root, cond, m.runId))) !== base).map((m) => m.runId) });
    }
  }
  return res;
}

module.exports = { summarize, render, compareToOx };

if (require.main === module) console.log(render(path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'expt_log'))).text);

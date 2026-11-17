'use strict';
// 結果表の集計（experiment_spec.md §5.3。D37）。expt_log/ の全試行の meta.json から、機械的に作る。人の判断は入れない。
// 欄 = 一致数 / 有効な試行数（無効試行は数えない。D24）。○ = 全試行で一致、× = 全試行で不一致、△ = その中間。
// 食い違いが出て10回に増やした条件は必ず△（D37）。不可観測の分類（①②③）は機械では決めず、不一致の欄は「分類未了」と表示する（D35）。
// 集計の対象は、現在の拡張機能のハッシュの試行だけ（コードを変えたら取り直す。§6.2【提案】）。旧い版の試行は記録として残し、数えない。
// 使い方: node harness/summarize.js [expt_log のパス]
const fs = require('node:fs');
const path = require('node:path');

const TYPES = ['D', 'I', 'J', 'A', 'R'];
const POINTS = ['OA', 'OB'];
const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L4b'];
const LEVEL_LABEL = { L1: 'L1', L2: 'L2', L3: 'L3', L4: 'L4a', L4b: 'L4b' }; // L4a = 正規宛先を教えた場合（D51）、L4b = 教えない場合
const ext = require('./extension');
const TYPE_NAME = { D: 'ダイレクトポスト', I: 'iFrame', J: 'JavaScriptフォーム', A: 'API', R: 'URLリダイレクト' };
const BASE_REPS = 3; const EXTENDED_REPS = 10; // D21（2026-11-16 に20回から10回へ）

function conditions() { // 測定の条件 18（R-M は作らない。D16、D41）
  const out = [];
  for (const t of TYPES) for (const k of (t === 'R' ? ['N'] : ['N', 'M'])) for (const p of POINTS) out.push(`${t}-${k}-${p}`);
  return out;
}

function loadTrials(root, cond) {
  const dir = path.join(root, cond);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((n) => path.join(dir, n, 'meta.json')).filter(fs.existsSync).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
}

// 食い違い（D21 / §7.2）: ①試行間で結果（L1〜L4 の一致の組）が揃わない、②T1 で見逃し・誤検出・内容の誤りが1回でもある
function hasDiscrepancy(validTrials) {
  const vec = (m) => LEVELS.map((l) => m.t1.trialMatch[l]).join(',');
  const between = new Set(validTrials.map(vec)).size > 1;
  const t1 = validTrials.some((m) => m.t1.missed + m.t1.falsePositives + m.t1.contentErrors > 0);
  return { between, t1, any: between || t1 };
}

function mark(match, total) { return total === 0 ? '-' : match === total ? '○' : match === 0 ? '×' : '△'; }

// 現在の版の試行だけに絞る（opts.filter === false で、ハッシュを見ない。単体テスト用）
function currentOnly(cond, trials, opts = {}) {
  if (opts.filter === false) return trials;
  const cur = ext.currentHashes(cond.split('-')[2]).combined;
  return trials.filter((m) => m.hashes && m.hashes.extension && m.hashes.extension.combined === cur);
}

function summarizeCondition(root, cond, opts = {}) {
  const allTrials = loadTrials(root, cond);
  const all = currentOnly(cond, allTrials, opts);
  const oldVersion = allTrials.length - all.length; // 旧い版の試行（数えない）
  const valid = all.filter((m) => m.valid && m.t1);
  const invalid = all.length - valid.length;
  const d = hasDiscrepancy(valid);
  const extended = valid.length > BASE_REPS; // 3回を超えて実行した = 食い違いで10回に増やした
  const levels = {};
  for (const l of LEVELS) {
    const match = valid.filter((m) => m.t1.trialMatch[l]).length;
    // 記号は件数だけから決める。D37 の「10回に増やした条件は必ず△」は、10回すべて一致（10/10）の場合に ○ と食い違うように読める。
    // 仕様から読み切れないので、その場合は件数どおり ○ とし、「10回に増やした」列で示す（NOTES に記録）
    levels[l] = { match, total: valid.length, mark: mark(match, valid.length) };
  }
  const sum = (f) => valid.reduce((a, m) => a + f(m), 0);
  return {
    cond, valid: valid.length, invalid, oldVersion, discrepancy: d,
    breakdown: ['legit', 'malicious'].reduce((o, k) => ({ ...o, [k]: ['L4', 'L4b'].reduce((oo, l) => ({ ...oo, [l]: valid.reduce((a, m) => { const b = (m.t1.breakdown || {})[k]?.[l] || { match: 0, total: 0 }; return { match: a.match + b.match, total: a.total + b.total }; }, { match: 0, total: 0 }) }), {}) }), {}), extended, levels,
    missed: sum((m) => m.t1.missed), falsePositives: sum((m) => m.t1.falsePositives), contentErrors: sum((m) => m.t1.contentErrors),
    outOfBrowser: sum((m) => (m.t1.outOfBrowser || []).reduce((a, o) => a + o.count, 0)),
    cdpBody: valid.reduce((a, m) => ({ a: a.a + m.cdpBodyAvailable.available, t: a.t + m.cdpBodyAvailable.total }), { a: 0, t: 0 }),
    complete: valid.length >= (d.any ? EXTENDED_REPS : BASE_REPS),
    unclassified: LEVELS.filter((l) => levels[l].match < valid.length),
  };
}

// OX の基準試行（001）との受信ログの内容比較（§6.3）。識別子・時刻・User-Agent を除く
function bodyNorm(b) { return String(b || '').replace(/ID-[A-Z0-9-]+/g, 'ID'); }
function receiveSig(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir).filter((n) => /^receive_.*\.jsonl$/.test(n))) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    out[f] = lines.map((x) => [x.method, String(x.path).split('?')[0], bodyNorm(x.body)].join(' ')).sort();
  }
  return out;
}
function compareToOx(root, cond, opts = {}) {
  const [t, k] = cond.split('-');
  const baseDir = path.join(root, `${t}-${k}-OX`, `${t}-${k}-OX-001`);
  if (!fs.existsSync(baseDir)) return { checked: 0, diffs: ['OX の基準試行がない'] };
  const base = JSON.stringify(receiveSig(baseDir));
  const trials = currentOnly(cond, loadTrials(root, cond), opts).filter((m) => m.valid);
  const diffs = trials.filter((m) => JSON.stringify(receiveSig(path.join(root, cond, m.runId))) !== base).map((m) => m.runId);
  return { checked: trials.length, diffs };
}

function render(root, opts = {}) {
  const S = Object.fromEntries(conditions().map((c) => [c, summarizeCondition(root, c, opts)]));
  const lines = [];
  lines.push('| 型 | 送信 | ' + POINTS.flatMap((p) => LEVELS.map((l) => `${p === 'OA' ? '案A' : '案B'} ${LEVEL_LABEL[l]}`)).join(' | ') + ' |');
  lines.push('|---|---|' + POINTS.flatMap(() => LEVELS.map(() => ':---:')).join('|') + '|');
  for (const t of TYPES) for (const k of (t === 'R' ? ['N'] : ['N', 'M'])) {
    const cells = POINTS.flatMap((p) => LEVELS.map((l) => { const x = S[`${t}-${k}-${p}`].levels[l]; return `${x.match}/${x.total} ${x.mark}`; }));
    lines.push(`| ${TYPE_NAME[t]} | ${k === 'N' ? '正規' : '悪性'} | ${cells.join(' | ')} |`);
  }
  lines.push('', '| 条件 | 有効 | 無効 | 食い違い（試行間／T1） | 10回に増やした | 見逃し | 誤検出 | 内容の誤り | 外縁③ | CDP 本文取得 | 不一致のレベル（分類） |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of conditions()) {
    const x = S[c];
    lines.push(`| ${c} | ${x.valid} | ${x.invalid}${x.oldVersion ? `（旧版 ${x.oldVersion} 件は対象外）` : ''} | ${x.discrepancy.between ? '有' : '無'}／${x.discrepancy.t1 ? '有' : '無'} | ${x.extended ? '○' : '-'} | ${x.missed} | ${x.falsePositives} | ${x.contentErrors} | ${x.outOfBrowser} | ${x.cdpBody.a}/${x.cdpBody.t} | ${x.unclassified.length ? x.unclassified.map((l) => LEVEL_LABEL[l]).join(',') + '（分類未了）' : '-'} |`);
  }
  lines.push('', '送信の種類別の判定の内訳（一致した送信数 / 送信数。L4a = 正規宛先を教えた場合、L4b = 教えない場合）', '', '| 条件 | 正規送信 L4a | 正規送信 L4b | 悪性送信 L4a | 悪性送信 L4b |', '|---|---|---|---|---|');
  for (const c of conditions()) {
    const b = S[c].breakdown; const f = (x) => (x.total ? `${x.match}/${x.total}` : '-');
    lines.push(`| ${c} | ${f(b.legit.L4)} | ${f(b.legit.L4b)} | ${f(b.malicious.L4)} | ${f(b.malicious.L4b)} |`);
  }
  const cmp = conditions().map((c) => [c, compareToOx(root, c, opts)]);
  lines.push('', `OX との内容比較（§6.3。受信ログ、識別子・時刻・User-Agent を除く）: 有効試行 ${cmp.reduce((a, [, r]) => a + r.checked, 0)} 件を比べ、差分 ${cmp.flatMap(([, r]) => r.diffs).length} 件${cmp.some(([, r]) => r.diffs.length) ? '（' + cmp.flatMap(([, r]) => r.diffs).join('、') + '）' : ''}`);
  const incomplete = conditions().filter((c) => !S[c].complete);
  lines.push(`規定の試行数に未達の条件: ${incomplete.length ? incomplete.join('、') : 'なし'}`);
  return { text: lines.join('\n'), S, cmp };
}

module.exports = { conditions, summarizeCondition, hasDiscrepancy, mark, render, BASE_REPS, EXTENDED_REPS };

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'expt_log'));
  console.log(render(root).text);
}

'use strict';
// L4 の判定ルールの比較（experiment_spec.md §13。結果を見る前に固定したルール R0〜R4）。
// 既存の extension.jsonl（拡張機能が記録した、送信ごとの項目）に、後からルールを当てはめて採点し直す。**新しい試行は行わない。読み取りのみ。**
// 評価の単位は送信。カード番号を含む送信だけを評価する（番号を含まない Stripe の計測用 POST は、正解が定義できないので除く）。
// 正解: 正規宛先への送信 = 正規（allow が正解）、sinkhole 宛て = 悪性（deny が正解）。どちらでもない送信は、集計に混ぜずエラーとして報告する。
// 対象の試行: 現行版の拡張機能（meta.json の hashes.extension.combined が現在の版と同じもの）で、有効なものだけ。旧版は除く。
// 使い方: node harness/rules_analysis.js [expt_log のパス]
const fs = require('node:fs');
const path = require('node:path');
const dummyExt = require('./extension');
const stripeExt = require('../stripe/ext_stripe');

const TOP_ORIGIN = 'http://merchant.localhost:8080'; // R2: トップページのオリジン。記録にない情報を、実験設定の定数で補う（§13.3）
const PSP_HOSTS = ['psp.localhost', 'api.stripe.com']; // R1: 既知の決済事業者のホスト。実験で使った2つだけ
const PAY_WORDS = /pay|payment|charge|checkout|token/i; // R3: 決済を示す語（部分一致）
const SINKHOLE_HOST = 'sinkhole.localhost:8082';
const LEGIT_URL = { D: 'http://psp.localhost:8081/pay', I: 'http://psp.localhost:8081/pay', J: 'http://psp.localhost:8081/pay', R: 'http://psp.localhost:8081/pay',
  A: 'http://merchant.localhost:8080/pay-api', S: 'https://api.stripe.com/v1/payment_methods' };

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };
const hostnameOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return ''; } };
const stripQuery = (u) => String(u).replace(/[?#].*$/, '');

// ルール。引数: rec = 送信1件の記録、ctx = { cardSends: その試行のカード番号を含む送信の全件 }。戻り値: 'allow' | 'deny' | null（判定不能）
const RULES = {
  R0: (rec) => { // 送信元フレームのオリジンと宛先のオリジンが同じなら allow（現行の L4b。案A: pageUrl、案B: initiator）
    const s = originOf(rec.pageUrl || rec.initiator); const d = originOf(rec.url);
    return s && d ? (s === d ? 'allow' : 'deny') : null;
  },
  R1: (rec) => { const h = hostnameOf(rec.url); return h ? (PSP_HOSTS.includes(h) ? 'allow' : 'deny') : null; },
  R2: (rec) => { const d = originOf(rec.url); return d ? (d === TOP_ORIGIN ? 'allow' : 'deny') : null; },
  R3: (rec) => (rec.url ? (PAY_WORDS.test(pathOf(rec.url)) ? 'allow' : 'deny') : null),
  R4: (rec, ctx) => { // 同一の試行で、カード番号を含む送信が2つ以上の異なる宛先へ出たら、全て deny
    const dests = new Set(ctx.cardSends.map((r) => hostOf(r.url)));
    return dests.size > 1 ? 'deny' : 'allow';
  },
};
const RULE_IDS = Object.keys(RULES);

// 正解付け。'legit' | 'malicious' | null（どちらでもない）
function groundTruth(rec, type) {
  if (hostOf(rec.url) === SINKHOLE_HOST) return 'malicious';
  if (stripQuery(rec.url) === LEGIT_URL[type]) return 'legit';
  return null;
}
const EXPECTED = { legit: 'allow', malicious: 'deny' };

// 1試行の記録（extension.jsonl の行の配列）と、その試行の情報から、評価対象の送信を作る
function trialSends(records, { type, point, entered, runId }) {
  const cards = records.filter((r) => r.method === 'POST' && r.judge && r.judge.L3 === entered.cardnumber);
  const errors = []; const sends = [];
  for (const r of cards) {
    const truth = groundTruth(r, type);
    if (!truth) { errors.push({ runId, url: r.url, reason: '正規でも悪性でもない（正解が定義できない）' }); continue; }
    sends.push({ rec: r, truth, type, point, runId });
  }
  return { sends, cards, errors };
}

// 全ルールで採点する。戻り値: 送信ごとの { type, point, truth, results: {R0: {out, ok}, ...} }
function scoreTrial({ sends, cards }) {
  const ctx = { cardSends: cards };
  return sends.map((s) => ({ type: s.type, point: s.point, truth: s.truth, runId: s.runId,
    recordedL4b: s.rec.judge.L4b,
    results: Object.fromEntries(RULE_IDS.map((id) => { const out = RULES[id](s.rec, ctx); return [id, { out, ok: out === EXPECTED[s.truth] }]; })) }));
}

function condParts(id) { const m = /^([RIDJAS])-([NM])-(OA|OB)$/.exec(id); return m ? { type: m[1], kind: m[2], point: m[3] } : null; }
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const currentCombined = (type, point) => (type === 'S' ? stripeExt : dummyExt).currentHashes(point).combined;

// expt_log から、現行版・有効な試行の送信を読み込む
function loadScored(root) {
  const scored = []; const errors = []; const trials = { used: 0, oldVersion: 0, invalid: 0 };
  for (const cond of fs.readdirSync(root).sort()) {
    const cp = condParts(cond); if (!cp) continue;
    const cur = currentCombined(cp.type, cp.point);
    for (const run of fs.readdirSync(path.join(root, cond)).sort()) {
      const mf = path.join(root, cond, run, 'meta.json'); const ef = path.join(root, cond, run, 'extension.jsonl');
      if (!fs.existsSync(mf)) continue;
      const meta = JSON.parse(fs.readFileSync(mf, 'utf8'));
      if (!(meta.hashes && meta.hashes.extension && meta.hashes.extension.combined === cur)) { trials.oldVersion++; continue; }
      if (!meta.valid || !fs.existsSync(ef)) { trials.invalid++; continue; }
      const t = trialSends(readJsonl(ef), { type: cp.type, point: cp.point, entered: meta.entered, runId: meta.runId });
      errors.push(...t.errors); scored.push(...scoreTrial(t)); trials.used++;
    }
  }
  return { scored, errors, trials };
}

// 集計: key = 型|正規/悪性|観測点|ルール → { ok, total }
function aggregate(scored) {
  const a = {};
  for (const s of scored) for (const id of RULE_IDS) {
    const k = [s.type, s.truth, s.point, id].join('|');
    a[k] = a[k] || { ok: 0, total: 0 }; a[k].total++; if (s.results[id].ok) a[k].ok++;
  }
  return a;
}

const TYPE_ORDER = ['D', 'I', 'J', 'A', 'R', 'S'];
const TYPE_NAME = { D: 'ダイレクトポスト', I: 'iFrame', J: 'JavaScriptフォーム', A: 'API', R: 'URLリダイレクト', S: '実 Stripe' };
const KIND_NAME = { legit: '正規送信', malicious: '悪性送信' };

function render(root) {
  const { scored, errors, trials } = loadScored(root);
  const a = aggregate(scored); const L = [];
  L.push(`対象: 現行版・有効な ${trials.used} 試行（旧版 ${trials.oldVersion} 試行、無効・記録なし ${trials.invalid} 試行は対象外）、カード番号を含む ${scored.length} 送信`, '');
  L.push('各欄は 正解数 / 送信数（正解 = 正規は allow、悪性は deny）。R0 = 現行の L4b、R1 = 決済事業者の一覧、R2 = トップページのオリジンと比べる、R3 = パスの語、R4 = 複数の宛先', '');
  L.push('| 型 | 送信 | ' + ['OA', 'OB'].flatMap((p) => RULE_IDS.map((id) => `${p === 'OA' ? '案A' : '案B'} ${id}`)).join(' | ') + ' |');
  L.push('|---|---|' + ['OA', 'OB'].flatMap(() => RULE_IDS.map(() => ':---:')).join('|') + '|');
  for (const t of TYPE_ORDER) for (const kind of ['legit', 'malicious']) {
    if (!['OA', 'OB'].some((p) => a[[t, kind, p, 'R0'].join('|')])) continue;
    const cells = ['OA', 'OB'].flatMap((p) => RULE_IDS.map((id) => { const x = a[[t, kind, p, id].join('|')]; return x ? `${x.ok}/${x.total}` : '-'; }));
    L.push(`| ${TYPE_NAME[t]} | ${KIND_NAME[kind]} | ${cells.join(' | ')} |`);
  }
  const r0diff = scored.filter((s) => s.results.R0.out !== s.recordedL4b).length;
  L.push('', `自己確認: R0 の再計算と、記録済みの L4b の不一致 ${r0diff} 件（0 のはず）`);
  L.push(`正解が定義できない送信（集計から除外）: ${errors.length} 件${errors.length ? ' — ' + errors.slice(0, 3).map((e) => `${e.runId} ${e.url}`).join('、') : ''}`);
  L.push('', '注意:',
    '- R1 の一覧は、実験で使った決済事業者2つだけ（実在の拡張機能が持つ一覧の網羅性・更新は測っていない）。',
    '- R2 のトップページのオリジンは、実験設定の定数で補った（記録にない情報。実在の拡張機能はタブの URL から取得できる）。',
    '- R3 は、sinkhole のパスが実装者の選択に依存する。攻撃者は決済を示す語を含むパスにして回避できるので、結果が自明に分かれる可能性がある。',
    '- R4 は、悪性送信の後に正規の送信も行われるスキマーに限って成り立つ。悪性の試行では、正規の送信も deny になる（誤判定として数える）。',
    '- 自作EC・自作スキマー・各3回の記録の再評価（【観測】）。実在のスキマー・実在の拡張機能へは一般化しない。');
  return { text: L.join('\n'), scored, errors, trials, aggregate: a, r0diff };
}

module.exports = { RULES, RULE_IDS, groundTruth, trialSends, scoreTrial, aggregate, loadScored, render, condParts, LEGIT_URL };

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'expt_log'));
  console.log(render(root).text);
}

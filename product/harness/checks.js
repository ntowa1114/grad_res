'use strict';
// 毎試行の自動チェック #1〜#5（experiment_spec.md §6.2）と、受信ログ・CDP の突き合わせ（D24、§6.5 T2）。
// 純粋関数。入力は記録（配列）だけで、ブラウザやサーバーには触れない。
// 実装済みの型は D、I、J、A、R（D56 の順序。全5型）。未知の型は例外にする（黙って合格にしない）。
const PUBLIC_TEST_PANS = new Set([ // 公開テスト番号（私が選んだ一覧。NOTES_assumptions.md #23）
  '4242424242424242', '4000056655665556', '5555555555554444', '2223003122003222',
  '378282246310005', '6011111111111117', '4111111111111111',
]);
const ORIGINS = {
  merchant: 'http://merchant.localhost:8080', psp: 'http://psp.localhost:8081', sinkhole: 'http://sinkhole.localhost:8082',
};
// 正規宛先と、発信元のオリジン（§3.3、毎試行 #2）。D型は加盟店ページから、I型は PSP の iFrame から出る
const LEGIT = {
  D: { url: ORIGINS.psp + '/pay', senderOrigin: ORIGINS.merchant },
  I: { url: ORIGINS.psp + '/pay', senderOrigin: ORIGINS.psp },
  J: { url: ORIGINS.psp + '/pay', senderOrigin: ORIGINS.merchant }, // PSP の JS は加盟店ページ内で動くので、発信元は加盟店
  R: { url: ORIGINS.psp + '/pay', senderOrigin: ORIGINS.psp }, // PSP のページ（リダイレクト後）から PSP へ。R3。悪性は作らない（D16）
  A: { url: ORIGINS.merchant + '/pay-api', senderOrigin: ORIGINS.merchant }, // A2: ブラウザ → 加盟店サーバー（正規宛先は加盟店。D17）
};
const MERCHANT_SERVER_UA = 'merchant-server'; // A3: 加盟店サーバーが PSP へ送るときの User-Agent（merchant/server.js。NOTES #38）

const fields = (body) => Object.fromEntries(new URLSearchParams(body || ''));
function sameAsEntered(rec, entered) {
  if (rec.method !== 'POST') return false;
  const f = fields(rec.body);
  const keys = Object.keys(entered);
  return Object.keys(f).length === keys.length && keys.every((k) => f[k] === entered[k]);
}
const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
const isHttp = (u) => /^(https?|wss?):/i.test(u);

function evaluate({ cond, entered, identifier, receive, cdp }) {
  if (!LEGIT[cond.type]) throw new Error(`型 ${cond.type} の自動チェックは未実装`);
  const legit = LEGIT[cond.type];
  const checks = [];
  const add = (id, name, ok, detail) => checks.push({ id, name, ok, detail });

  const cdpPosts = cdp.filter((r) => r.method === 'POST' && isHttp(r.url));

  // #1 正規送信の受け手: D・I・J・R は PSP、A は加盟店サーバーの受信ログに識別子が1件届き、内容が入力した全項目（CVC を含む）と一致する
  const isA = cond.type === 'A';
  const recvName = isA ? 'merchant' : 'psp';
  const withIdAt = receive[recvName].filter((r) => (r.body || '').includes(identifier));
  add(1, '正規送信の受け手', withIdAt.length === 1 && sameAsEntered(withIdAt[0], entered),
    `${recvName} の識別子つき受信 ${withIdAt.length} 件、内容一致=${withIdAt.length === 1 ? sameAsEntered(withIdAt[0], entered) : '-'}`);

  // #2 正規宛先と発信元: CDP の POST のうち、sinkhole 以外はちょうど1件で、正規宛先、発信元フレームが加盟店
  const nonSink = cdpPosts.filter((r) => originOf(r.url) !== ORIGINS.sinkhole);
  const one = nonSink.length === 1 ? nonSink[0] : null;
  const sender = one ? (originOf(one.frameUrl) ?? originOf(one.referer)) : null;
  add(2, '正規宛先と発信元', !!one && one.url === legit.url && sender === legit.senderOrigin,
    `sinkhole 以外の CDP の POST ${nonSink.length} 件${one ? `、宛先=${one.url}、発信元=${sender}` : ''}`);

  // #3 加盟店サーバーの受信: D・I・J型は識別子が届かない（D3、I5、J3）。
  // A型は、加盟店に識別子が届き（A2。陽性対照）、PSP の受信が加盟店サーバー発（A3）で、ブラウザからの PSP 宛て POST が CDP にない
  const merchantWithId = receive.merchant.filter((r) => JSON.stringify(r).includes(identifier));
  if (!isA) {
    add(3, '加盟店サーバーの受信', merchantWithId.length === 0, `加盟店の識別子つき受信 ${merchantWithId.length} 件`);
  } else {
    const pspWithIdA = receive.psp.filter((r) => (r.body || '').includes(identifier));
    const fromMerchant = pspWithIdA.length === 1 && pspWithIdA[0].userAgent === MERCHANT_SERVER_UA && !pspWithIdA[0].origin && !pspWithIdA[0].referer && sameAsEntered(pspWithIdA[0], entered);
    const browserToPsp = cdpPosts.filter((r) => originOf(r.url) === ORIGINS.psp).length;
    add(3, '加盟店サーバーの受信（API型）', merchantWithId.length >= 1 && fromMerchant && browserToPsp === 0,
      `加盟店の識別子つき受信 ${merchantWithId.length} 件、PSP の識別子つき受信 ${pspWithIdA.length} 件（加盟店サーバー発・内容一致=${fromMerchant}）、CDP の PSP 宛て POST ${browserToPsp} 件`);
  }

  // #4 悪性送信: M は sinkhole に識別子が届き、内容が全項目一致。N は sinkhole の受信ログが空
  if (cond.kind === 'M') {
    const withId = receive.sinkhole.filter((r) => (r.body || '').includes(identifier));
    const ok = withId.length >= 1 && withId.every((r) => sameAsEntered(r, entered)) && withId.length === receive.sinkhole.length;
    add(4, '悪性送信', ok, `sinkhole の受信 ${receive.sinkhole.length} 件、うち識別子つき ${withId.length} 件、全て内容一致=${withId.every((r) => sameAsEntered(r, entered))}`);
  } else {
    add(4, '悪性送信（正規では sinkhole が空）', receive.sinkhole.length === 0, `sinkhole の受信 ${receive.sinkhole.length} 件`);
  }

  // #5 隔離と番号: CDP の全送信先が localhost と *.localhost のみ。入力したカード番号が公開テスト番号のみ
  const hosts = cdp.filter((r) => isHttp(r.url)).map((r) => new URL(r.url).hostname);
  const badHosts = [...new Set(hosts.filter((h) => !(h === 'localhost' || h.endsWith('.localhost'))))];
  add(5, '隔離と番号', cdp.length > 0 && badHosts.length === 0 && PUBLIC_TEST_PANS.has(entered.cardnumber),
    `CDP の記録 ${cdp.length} 件、範囲外のホスト=[${badHosts.join(',')}]、公開テスト番号=${PUBLIC_TEST_PANS.has(entered.cardnumber)}`);

  // preflight（D54）: OPTIONS が1件でもあれば設計の誤り
  const optionsCount = cdp.filter((r) => r.method === 'OPTIONS').length
    + Object.values(receive).flat().filter((r) => r.method === 'OPTIONS' || r.preflight).length;
  add('P', 'preflight なし（D54）', optionsCount === 0, `OPTIONS ${optionsCount} 件`);

  // 正解記録の検証（D24、T2）: CDP と受信ログの POST が、宛先ごとに同数で、CDP が本文を取れた分は一致
  const xc = [];
  let bodyAvail = 0; let bodyTotal = 0;
  for (const name of ['psp', 'sinkhole', 'merchant']) {
    const c = cdpPosts.filter((r) => originOf(r.url) === ORIGINS[name]);
    const s = receive[name].filter((r) => r.method === 'POST');
    // A型の PSP 宛ては加盟店サーバーから出る（ブラウザの外。外縁③）ので、CDP には出ない。件数は #3 で確認する
    if (isA && name === 'psp') { if (c.length !== 0) xc.push(`psp: ブラウザからの POST が CDP に ${c.length} 件`); continue; }
    if (c.length !== s.length) xc.push(`${name}: POST 件数 CDP=${c.length} 受信=${s.length}`);
    c.forEach((r) => { bodyTotal++; if (r.postData !== null) bodyAvail++; });
    const sBodies = s.map((r) => r.body).sort();
    const cBodies = c.filter((r) => r.postData !== null).map((r) => r.postData).sort();
    if (cBodies.length && JSON.stringify(cBodies) !== JSON.stringify(sBodies.slice(0, cBodies.length)) && c.length === s.length) xc.push(`${name}: 本文が不一致`);
  }
  add('T2', '受信ログと CDP の突き合わせ（D24）', xc.length === 0, xc.length ? xc.join(' / ') : `一致（CDP が本文を取れた POST ${bodyAvail}/${bodyTotal}）`);

  const failed = checks.filter((c) => !c.ok);
  return {
    checks,
    valid: failed.length === 0,
    invalidReasons: failed.map((c) => `${c.id}: ${c.name}`),
    safetyStop: checks.some((c) => (c.id === 4 || c.id === 5) && !c.ok), // #4・#5 の不合格は実験を止める（§6.2、§8）
    cdpBodyAvailable: { available: bodyAvail, total: bodyTotal },
  };
}

module.exports = { evaluate, PUBLIC_TEST_PANS, ORIGINS, LEGIT };

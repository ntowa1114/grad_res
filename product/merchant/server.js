'use strict';
// 加盟店 merchant.localhost:8080。
// ダイレクトポスト型（D。D1〜D3）:  /checkout（正規）  /checkout-m（悪性。スキマー model_x.js を埋め込む）
// iFrame 型（I。I1、I2）:           /checkout-i（正規）  /checkout-i-m（悪性。スキマー model_y.js を埋め込む）
// R 型（R1〜R4）:                   /checkout-r（購入ページ。入力欄なし）→ /redirect-r（302）→ PSP の /checkout
// A 型（A1〜A3）:                   /checkout-a（正規）  /checkout-a-m（悪性。model_x.js）。送信先は加盟店の /pay-api（PSP へ中継）
//   J 型（J1〜J3）:                   /checkout-j（正規）  /checkout-j-m（悪性。model_x.js）。入力欄は PSP の psp.js が作る
//   I 型の加盟店ページに決済機能はなく、PSP の iFrame だけを置く。
// 2つの違いは <script> の有無だけ。カード入力欄は加盟店ページの中にあり、送信は fetch で PSP へ直接出す（D49）。
// 加盟店サーバーはカード情報を受け取らない（D3）。受信ログ receive_merchant.jsonl には GET だけが残るはず。
const fs = require('node:fs');
const path = require('node:path');
const { createReceiver } = require('../common/receiver');

const SKIMMER_DIR = path.join(__dirname, '..', 'skimmer');
const PSP_PAY_URL = 'http://psp.localhost:8081/pay';
const http = require('node:http');

function checkoutPage(withSkimmer) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>checkout</title></head>
<body>
<form id="card-form" autocomplete="off">
  <input id="cardnumber" name="cardnumber" placeholder="card number">
  <input id="exp" name="exp" placeholder="MM/YY">
  <input id="cvc" name="cvc" placeholder="CVC">
  <input id="name" name="name" placeholder="name">
  <button id="pay" type="submit">pay</button>
</form>
<p id="result"></p>
<script>
document.getElementById('card-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var body = new URLSearchParams();
  ['cardnumber', 'exp', 'cvc', 'name'].forEach(function (n) { body.append(n, document.getElementById(n).value); });
  fetch(${JSON.stringify(PSP_PAY_URL)}, { method: 'POST', body: body })
    .then(function (r) { document.getElementById('result').textContent = 'psp:' + r.status; })
    .catch(function (e) { document.getElementById('result').textContent = 'error:' + e; });
});
</script>
${withSkimmer ? '<script src="/skimmer/send.js"></script>\n<script src="/skimmer/model_x.js"></script>\n' : ''}</body></html>
`;
}

function iframePage(withSkimmer) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>checkout</title></head>
<body>
<iframe src="http://psp.localhost:8081/frame" width="420" height="200"></iframe>
${withSkimmer ? '<script src="/skimmer/send.js"></script>\n<script src="/skimmer/model_y.js"></script>\n' : ''}</body></html>
`;
}

// J 型（J1〜J3）: 元の HTML に入力欄はなく、PSP の JS（psp.js）が実行時にフォームを作る。加盟店ページに決済処理はない
function jsFormPage(withSkimmer) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>checkout</title></head>
<body>
<div id="payment-mount"></div>
<script src="http://psp.localhost:8081/psp.js"></script>
${withSkimmer ? '<script src="/skimmer/send.js"></script>\n<script src="/skimmer/model_x.js"></script>\n' : ''}</body></html>
`;
}

// A 型（A1〜A3）: 決済ページとフォームは加盟店が配る。送信は同一オリジンの fetch で加盟店の /pay-api へ（A2。D49）。
// 加盟店サーバーが PSP の /pay へ中継する（A3。ブラウザの外。外縁③）。
function apiPage(withSkimmer) {
  return checkoutPage(withSkimmer).replace(JSON.stringify(PSP_PAY_URL), JSON.stringify('/pay-api'));
}

// A3: 加盟店サーバー → PSP。Node の名前解決は *.localhost を引けない場合があるので 127.0.0.1 へ、Host だけ PSP にする。
// 送信元を PSP の受信ログで区別できるよう User-Agent に merchant-server を付ける（Origin は付けない）
function forwardToPsp(body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: 8081, path: '/pay', method: 'POST',
      headers: { host: 'psp.localhost:8081', 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body), 'user-agent': 'merchant-server' },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(body);
  });
}

// R 型（R1〜R4）: /checkout-r は購入ページ（カード入力欄なし。R2）。ボタンで /redirect-r へ行き、加盟店が 302 で PSP の
// /checkout へ誘導する（PCI §2.1.2 手順1「redirect command」。302 とする点は私の解釈。NOTES #42）。悪性ページは作らない（D16）
function redirectPage() {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>checkout</title></head>
<body>
<p>cart: 1 item</p>
<form id="go" action="/redirect-r" method="get"><button id="pay" type="submit">pay</button></form>
</body></html>
`;
}

const STATIC = { '/skimmer/send.js': 'send.js', '/skimmer/model_x.js': 'model_x.js', '/skimmer/model_y.js': 'model_y.js' };

module.exports = createReceiver({
  name: 'merchant',
  defaultPort: 8080,
  async respond(req, body) {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/checkout') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: checkoutPage(false) };
    if (req.method === 'GET' && url === '/checkout-m') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: checkoutPage(true) };
    if (req.method === 'GET' && url === '/checkout-i') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: iframePage(false) };
    if (req.method === 'GET' && url === '/checkout-i-m') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: iframePage(true) };
    if (req.method === 'GET' && url === '/checkout-j') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: jsFormPage(false) };
    if (req.method === 'GET' && url === '/checkout-j-m') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: jsFormPage(true) };
    if (req.method === 'GET' && url === '/checkout-a') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: apiPage(false) };
    if (req.method === 'GET' && url === '/checkout-a-m') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: apiPage(true) };
    if (req.method === 'GET' && url === '/checkout-r') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: redirectPage() };
    if (req.method === 'GET' && url === '/redirect-r') return { status: 302, headers: { location: 'http://psp.localhost:8081/checkout' }, body: '' };
    if (req.method === 'POST' && url === '/pay-api') {
      try { return { status: await forwardToPsp(body), body: 'ok' }; } catch (e) { return { status: 502, body: 'psp unreachable' }; }
    }
    if (req.method === 'GET' && STATIC[url]) {
      return { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' }, body: fs.readFileSync(path.join(SKIMMER_DIR, STATIC[url])) };
    }
    return { status: 404, body: 'not found' };
  },
});
if (require.main === module) module.exports.start().then((p) => console.log('merchant listening on 127.0.0.1:' + p));

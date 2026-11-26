'use strict';
// 実 Stripe 版の加盟店 merchant.localhost:8080。/checkout-s: Stripe.js の Card Element を置き、createPaymentMethod を呼ぶだけ
// （シークレットキーは使わない。決済の確定・課金・顧客の作成はしない）。キーは起動時に local_key.txt から読み、ページに埋め込む。
// 加盟店サーバーはカード情報を受け取らない。受信ログには GET だけが残るはず。
// /checkout-s-m（悪性 S-M 用）: 同じページに、共通の送信部 send.js と、取得なしの模擬送信 inject_send_stripe.js を足しただけ
// （Stripe の入力欄は読まない。偽フォームも作らない）。
const fs = require('node:fs');
const path = require('node:path');
const { createReceiver } = require('../common/receiver');
const { loadKey } = require('./key');

let page = null; let pageM = null;
const STATIC = {
  '/skimmer/send.js': path.join(__dirname, '..', 'skimmer', 'send.js'),
  '/stripe_inject/inject_send_stripe.js': path.join(__dirname, 'inject_send_stripe.js'),
};
function checkoutPage(key, synthetic = false) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>checkout-s</title></head>
<body>
<div id="card"></div>
<button id="pay" type="button">pay</button>
<p id="result"></p>
<script src="https://js.stripe.com/v3/"></script>
${synthetic ? '<script src="/skimmer/send.js"></script>\n<script src="/stripe_inject/inject_send_stripe.js"></script>\n' : ''}<script>
var stripe = Stripe(${JSON.stringify(key)});
var el = stripe.elements().create('card');
el.mount('#card');
document.getElementById('pay').addEventListener('click', function () {
  stripe.createPaymentMethod({ type: 'card', card: el }).then(function (r) {
    document.getElementById('result').textContent = r.error ? 'error:' + r.error.code : 'ok:' + r.paymentMethod.id.slice(0, 3);
  });
});
</script>
</body></html>`;
}

const html = (body) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body });
const receiver = createReceiver({
  name: 'merchant', defaultPort: 8080,
  respond: async (req) => {
    const p = req.url.split('?')[0];
    if (req.method === 'GET' && p === '/checkout-s') return html(page);
    if (req.method === 'GET' && p === '/checkout-s-m') return html(pageM);
    if (req.method === 'GET' && STATIC[p]) return { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' }, body: fs.readFileSync(STATIC[p]) };
    return { status: 404, body: 'not found' };
  },
});
const start = async (o) => { const k = loadKey(); page = checkoutPage(k); pageM = checkoutPage(k, true); return receiver.start(o); };
module.exports = { ...receiver, start, checkoutPage, STATIC };

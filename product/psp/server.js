'use strict';
// ダミーPSP psp.localhost:8081（D54）。加盟店オリジンからの正規送信にだけ CORS を許可する。
// /frame: I型の iFrame の中身（カード入力フォーム。I1、I2）。送信は同一オリジンの fetch で /pay へ（D49）。
const { createReceiver } = require('../common/receiver');

const FRAME_PAGE = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>psp frame</title></head>
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
  fetch('/pay', { method: 'POST', body: body })
    .then(function (r) { document.getElementById('result').textContent = 'psp:' + r.status; })
    .catch(function (e) { document.getElementById('result').textContent = 'error:' + e; });
});
</script>
</body></html>
`;

module.exports = createReceiver({
  name: 'psp',
  defaultPort: 8081,
  corsAllowOrigin: 'http://merchant.localhost:8080',
  respond(req) {
    if (req.method === 'GET' && req.url.split('?')[0] === '/frame') {
      return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: FRAME_PAGE };
    }
    return { status: 200, body: 'ok' };
  },
});
if (require.main === module) module.exports.start().then((p) => console.log('psp listening on 127.0.0.1:' + p));

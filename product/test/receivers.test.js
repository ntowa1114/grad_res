'use strict';
// ダミーPSP・sinkhole の最小テスト（D36、D48）。ブラウザは使わない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const psp = require('../psp/server');
const sinkhole = require('../sinkhole/server');

const BODY = 'cardnumber=4242424242424242&exp=12%2F30&cvc=123&name=ID-I-M-OA-003-K7Q4';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'recv-'));
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const post = (port, p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
  method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
});

test('本文の全項目（CVC を含む）が加工されずに残る。実行IDで別ファイルに分かれる', async () => {
  const port = await psp.start({ port: 0 });
  try {
    const d1 = tmp(), d2 = tmp();
    psp.begin('D-N-OX-001', d1);
    await post(port, '/pay', BODY, { origin: 'http://merchant.localhost:8080' });
    psp.end();
    psp.begin('D-N-OX-002', d2);
    psp.end();
    const r1 = lines(path.join(d1, 'receive_psp.jsonl'));
    assert.equal(r1.length, 1);
    assert.equal(r1[0].runId, 'D-N-OX-001');
    assert.equal(r1[0].body, BODY);
    assert.equal(r1[0].method, 'POST');
    assert.equal(r1[0].path, '/pay');
    assert.equal(r1[0].origin, 'http://merchant.localhost:8080');
    assert.equal(r1[0].server, 'psp');
    assert.deepEqual(lines(path.join(d2, 'receive_psp.jsonl')), []); // 空ファイルはある
  } finally { await psp.stop(); }
});

test('試行外に届いたものはログに書かれず strays に残る', async () => {
  const port = await sinkhole.start({ port: 0 });
  try {
    await post(port, '/c', BODY);
    assert.equal(sinkhole.strays().length, 1);
  } finally { await sinkhole.stop(); }
});

test('PSP は加盟店オリジンにだけ CORS を許可し、sinkhole は許可しない', async () => {
  const pp = await psp.start({ port: 0 });
  const sp = await sinkhole.start({ port: 0 });
  try {
    const ok = await post(pp, '/pay', BODY, { origin: 'http://merchant.localhost:8080' });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://merchant.localhost:8080');
    const other = await post(pp, '/pay', BODY, { origin: 'http://evil.localhost:1' });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    const s = await post(sp, '/c', BODY, { origin: 'http://merchant.localhost:8080' });
    assert.equal(s.headers.get('access-control-allow-origin'), null);
  } finally { await psp.stop(); await sinkhole.stop(); }
});

test('OPTIONS は preflight 印付きで記録され、CORS ヘッダは返さない（D54）', async () => {
  const port = await psp.start({ port: 0 });
  try {
    const d = tmp();
    psp.begin('D-N-OX-001', d);
    const res = await fetch(`http://127.0.0.1:${port}/pay`, { method: 'OPTIONS', headers: { origin: 'http://merchant.localhost:8080' } });
    psp.end();
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const r = lines(path.join(d, 'receive_psp.jsonl'));
    assert.equal(r.length, 1);
    assert.equal(r[0].preflight, true);
  } finally { await psp.stop(); }
});

test('127.0.0.1 だけで待ち受ける（D13）', async () => {
  const port = await psp.start({ port: 0 });
  try {
    const addr = await new Promise((ok) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); ok(res.socket.remoteAddress); });
      req.on('error', () => ok(null));
    });
    assert.equal(addr, '127.0.0.1');
    const external = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
    if (external) {
      const reached = await new Promise((ok) => {
        const req = http.get({ host: external.address, port, path: '/', timeout: 1500 }, () => ok(true));
        req.on('error', () => ok(false)); req.on('timeout', () => { req.destroy(); ok(false); });
      });
      assert.equal(reached, false);
    }
  } finally { await psp.stop(); }
});

'use strict';
// 受信サーバーの共通部品（D18、experiment_spec.md §5.1(1)）。
// 1リクエスト = 1行の JSON を receive_<サーバー名>.jsonl に追記する。本文は加工せず全文を残す。
// 127.0.0.1 だけで待ち受ける（D13）。実行IDの切り替えは begin()/end() で行う（HTTP の制御口は作らない）。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function createReceiver({ name, defaultPort, corsAllowOrigin = null, respond }) {
  let run = null; // { runId, file }
  const strays = []; // 試行外（begin 前・end 後）に届いた記録。ログには書かない
  let server = null;

  function record(entry) {
    if (run) fs.appendFileSync(run.file, JSON.stringify({ runId: run.runId, ...entry }) + '\n');
    else strays.push(entry);
  }

  function handler(req, res) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const origin = req.headers['origin'] || null;
      const preflight = req.method === 'OPTIONS';
      record({
        t: new Date().toISOString(),
        server: name,
        method: req.method,
        path: req.url,
        origin,
        referer: req.headers['referer'] || null,
        contentType: req.headers['content-type'] || null,
        body,
        // D54: OPTIONS は送信に数えず、設計の誤りの検出用に印を付ける
        ...(preflight ? { preflight: true } : {}),
      });
      if (preflight) { res.writeHead(204); res.end(); return; } // CORS ヘッダなし = 事前確認は失敗させる
      const headers = { 'content-type': 'text/plain; charset=utf-8' };
      if (corsAllowOrigin && origin === corsAllowOrigin) headers['access-control-allow-origin'] = corsAllowOrigin;
      const r = respond ? respond(req, body) : { status: 200, body: 'ok' };
      res.writeHead(r.status, { ...headers, ...(r.headers || {}) });
      res.end(r.body);
    });
  }

  return {
    name,
    async start({ port = defaultPort } = {}) {
      server = http.createServer(handler);
      await new Promise((ok, ng) => { server.once('error', ng); server.listen(port, '127.0.0.1', ok); });
      return server.address().port;
    },
    async stop() {
      if (!server) return;
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
      server = null;
    },
    begin(runId, dir) {
      fs.mkdirSync(dir, { recursive: true });
      run = { runId, file: path.join(dir, `receive_${name}.jsonl`) };
      fs.writeFileSync(run.file, ''); // 空でもファイルを作る（「届かなかった」を、ファイルなしと区別する）
    },
    end() { run = null; },
    strays: () => strays.slice(),
  };
}

module.exports = { createReceiver };

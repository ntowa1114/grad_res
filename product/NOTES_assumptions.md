# 実装中の仮定・未確認事項の記録

実装作業（Claude Code）で置いた仮定、未確認のまま残した事項、実装して分かったことを、出た順に追記する。
研究方針の正本は `research_docs/research_decisions.md`。ここは作業記録で、決定ではない。
`research_docs/` へ移すかは、研究者に確認してから行う。

タグ: 【観測】実測した事実 / 【仮説】未検証の予測 / 【未確認】資料・実測から判断できない / 【実装判断】決定の対象外の実装上の選択

| # | 日付 | 段階 | タグ | 内容 | 根拠（D番号・実測・一般知識の別） | 影響範囲 | 研究者の確認 |
|---|---|---|---|---|---|---|---|
| 1 | 2026-11-12 | 段階0 | 【観測】 | Playwright 1.65.0 同梱の Chromium（chromium-1254、158.0.8127.18）は、この PC では起動できない。Windows の Smart App Control が有効（`VerifiedAndReputablePolicyState`=1）で、未署名の実行ファイルとしてブロックされる（CodeIntegrity ログ 3033/3077） | 実測 | ブラウザの選択全体 | 未 |
| 2 | 2026-11-12 | 段階0 | 【観測】 | Playwright のブラウザは、実際には `AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\ms-playwright` に置かれていた（Claude アプリのパッケージ内の仮想化パス。CodeIntegrity ログのパス） | 実測 | 再現手順の記述 | 未 |
| 3 | 2026-11-12 | 段階1 | 【観測】 | `merchant/psp/sinkhole.localhost` は、Chrome 157.0.8103.39 と Edge 157.0.4341.46 で名前解決でき、127.0.0.1 で待ち受けたサーバーに届いた（D54） | 実測（spike1、各1回） | D54 | 未 |
| 4 | 2026-11-12 | 段階1 | 【観測】 | CDP の `Network.requestWillBeSent` の `request.postData` と `Network.getRequestPostData` の両方で、`fetch` の POST 本文（urlencoded）を取得できた。`no-cors` の sinkhole 宛ても取得できた。OPTIONS は出なかった（サーバー受信・CDP の両方） | 実測（spike1、Chrome/Edge 各1回） | §5.1、D54、T2 | 未 |
| 5 | 2026-11-12 | 段階1 | 【観測】 | `psp.localhost` の iFrame は、別プロセスの iFrame（OOPIF）だった。iFrame 内からの POST は、ページの CDP セッションには出ず、iFrame 用の CDP セッション（`context.newCDPSession(frame)`）にだけ出た。iFrame の文書の GET は、ページのセッションに出た。親ページからの `contentDocument` は `null` | 実測（spike1） | I型の CDP 記録（§5.1(2)）、I3 | 未 |
| 6 | 2026-11-12 | 段階1 | 【観測】 | 拡張機能の読み込み: Chrome 157 は `--load-extension`（方式A）では読み込まれない。`--enable-unsafe-extension-debugging` + CDP `Extensions.loadUnpacked`（方式B）と、永続コンテキスト（`launchPersistentContext`）の組み合わせで読み込めた。Edge 157 は方式A・Bとも読み込めた。いずれも headless | 実測（spike3/3b、各1回） | D52、D53、ブラウザの選択 | 未 |
| 7 | 2026-11-12 | 段階1 | 【観測】 | Service Worker で `chrome.storage.local` の読み書きができた。CDP `Target.closeTarget` で SW の target が一覧から消えた後も、拡張機能のページ（`chrome-extension://<id>/reader.html`）から `chrome.storage.local.get` で全件を読み出せた。CDP `Extensions.getStorageItems` は「No associated browser context」で失敗。`ServiceWorker.stopAllWorkers`（ページから）では SW は止まらなかった | 実測（spike3/3b） | D52、U-10 | 未 |
| 8 | 2026-11-12 | 段階1 | 【未確認】 | `Target.closeTarget` 後の SW が、MV3 の自然な停止（アイドル30秒など）と同じ状態かは確かめていない | — | D52 | 未 |
| 9 | 2026-11-12 | 段階1 | 【仮説】 | Chrome 正式版が 137 前後で `--load-extension` を廃止したという点は一般知識で、資料にない。今回の Chrome 157 で方式Aが効かなかったことと矛盾しない | 一般知識 | — | 未 |
| 10 | 2026-11-12 | 段階1 | 【観測】 | unpacked の拡張機能の ID は、読み込んだフォルダのパスで変わった（scratchpad と `product/spike/` で別の ID）。`meta.json` には ID ではなくハッシュで版を記録する | 実測 | §7.1 | 未 |
| 11 | 2026-11-12 | 段階1 | 【実装判断】 | 実行環境を WSL2（Ubuntu 26.04）+ Playwright 同梱 Chromium にする（研究者の選択）。理由: ブラウザのバージョンを Playwright の版で固定でき、自動更新で変わらない。Windows では Smart App Control で同梱 Chromium が動かない（#1）。リポジトリは WSL の Linux 側に clone して作業する（`/mnt/c` は遅く、改行コードが混ざりやすいため） | 研究者の選択（2026-11-12） | 全体。`research_docs/` への反映は未（研究者に確認してから） | 済 |
| 12 | 2026-11-12 | 段階1 | 【未確認】 | WSL2 上で、Smart App Control の影響を受けずに同梱 Chromium が動くか。`--load-extension` が使えるか。いずれも未実測で、WSL 上でスパイクをやり直して確かめる | 一般知識からの予測 | 段階1のやり直し | 未 |

## 引き継ぎ（2026-11-12。Windows のセッションから WSL のセッションへ）

### 依頼の範囲（研究者の指示の要約）
- ダイレクトポスト型（D）の縦切りの、拡張機能なしの基準試行（`D-N-OX`、`D-M-OX`。各1回）まで。XHR はしない（D38①）。拡張機能（案A・案B）の本実装は次のセッション。
- 作るもの（D53）: `product/` の `merchant/`、`psp/`、`sinkhole/`、`skimmer/`（モデルX の取得部と共通の送信部。`fetch`、`no-cors`）、`harness/`（顧客役の自動操作、識別子の発行、受信ログ・CDP の記録、毎試行の自動チェック #1〜#5、`meta.json`）。ログは `expt_log/`（D39 の形式）。
- 守ること: 変更してよいのは `product/` と `expt_log/`。原本は変更しない。`research_docs/` を更新するときは先に研究者に確認する。`.env` を読まない。テストを勝手にスキップしない。D13（`*.localhost` のみ、公開テスト番号のみ）。全送信は単純リクエスト（D54。OPTIONS が出たら試行は無効）。正規送信は `fetch`（D49）。実測と予測を区別する。
- 進め方: 小さく段階的に。1段階ごとに報告して確認を取る。仮定・未確認はこのファイルに追記する（研究者の承認済みの運用）。

### 終わったこと
- 段階0: `product/package.json`（Playwright 1.65.0 を固定）。`node_modules/` は git に入れない（`.gitignore`）。Linux 側で `npm ci` で作り直す。
- 段階1（Windows で実施）: 上の表 #1〜#10。スパイクは `product/spike/`（`spike1.js`: 名前解決・CDP の本文・OOPIF、`spike3.js`・`spike3b.js`: 拡張機能の読み込みと `chrome.storage`、`spike_ext/`: 最小の MV3 拡張）。
  - 実行例: `node spike/spike1.js`（引数なしで同梱 Chromium）、`node spike/spike3b.js "" A`（同梱 Chromium、`--load-extension`）。`channel` 引数に `chrome`／`msedge` を渡すと、インストール済みのブラウザを使う。

### 次にやること
1. WSL 上で `npm ci` と `npx playwright install chromium` を実行し、スパイク1・3b を同梱 Chromium でやり直す（#12）。結果を表に追記して研究者に報告する。
2. 研究者の確認後、段階2（`sinkhole/` と `psp/` から）に進む。I型に備え、CDP は OOPIF ごとにセッションを張る設計にする（#5）。拡張機能の記録の読み出しは、拡張機能のページから `chrome.storage.local.get` で行う案が有力（#7）。
3. 研究者に確認すること: 実行環境が WSL2 + Chromium になったことを `research_docs/`（`experiment_spec.md` §11 など）に書くか。

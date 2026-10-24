# CLAUDE.md（研究支援のための作業ルール）

卒業研究（EC決済におけるカード情報送信の消費者側観測可能性）の支援用ルールです。長い研究内容は書かず、参照先を示します。
**パスはすべてリポジトリ直下からの相対パスで書きます**（例: `research_docs/README.md`）。直下の `CLAUDE.md` から読み込まれても解決できるようにするためです。

## 1. 作業前に読むファイル

1. `research_docs/README.md`（概要、ファイル一覧、出典の略称、論点ごとの正本）
2. `research_docs/research_decisions.md`（決まっていること・未確定のこと）
3. 作業内容に応じて次を読む
   - 用語・観測レベル: `research_docs/observation_model.md`
   - 実験: `research_docs/experiment_index.md`、原本 `260930_poc実験9月の結果.md`
   - 先行研究: `research_docs/literature/`
   - 主張・根拠・未解決事項: `research_docs/analysis/`

## 2. 原本と正本

- リポジトリ直下の既存資料（引き継ぎ資料、PDF、実験記録、xlsx）は**原本**です。変更・削除・移動しません。
- 研究方針の最新は `研究引き継ぎ_確定事項_2026-10-24.md` です。`卒論進捗発表_v5_内容まとめ.md` は 10/19 時点のスナップショットで、方針の正本ではありません。
- 実験の生ログ・詳細は原本が正本で、`research_docs/experiment_index.md` は要約と参照のみです。
- 資料間の矛盾は、勝手にどちらかを正しいと判断せず、統合もしません。`research_docs/analysis/open_issues.md` に両方の内容と出典を記録します。

## 3. 事実・解釈・仮説の区別

記述にはタグを付けます。

| タグ | 意味 |
|---|---|
| 【観測】 | 研究者が実測した事実（条件付き） |
| 【解釈】 | 観測に対する研究者の解釈 |
| 【仮説】 | 未検証の予測。仕様からの推測を含む |
| 【決定】 | 研究方針として決めた事項 |
| 【提案】 | 提案段階で、未決定の事項 |
| 【文献】 | 先行研究・公式文書の主張 |
| 【未確認】 | 資料から判断できない事項 |

- 先行研究の主張と、自分の研究で確認した結果を混ぜない。
- 未検証の仮説を確定事項として書かない。
- 資料にない情報を推測で補わない。不足は「未確認」と書く。
- **決定の「理由」も同様です。** 資料に理由が書かれていない決定は、理由を補わず「理由の記載なし（未確認）」と書く。
- 実験結果は条件（環境、平文か否か、`all_frames` など）とセットで書く。「観測できた」を一般化しない。
- 引き継ぎ資料にしか根拠がない事項（例: 実 Stripe での確認）は、その旨を明記する。

## 4. 説明スタイル（研究者の要望）

出典: `研究引き継ぎ_確定事項_2026-10-24.md` 付録「説明スタイルの要望」。要点だけを写す。詳細は原本を参照すること。

- 前提から説明する。過去の会話や専門知識を覚えている前提にしない。
- 専門用語・略称・独自記号は、初出時に意味を説明してから使う。
- 抽象的な主張には、具体例と「なぜそうなるか」の理由を付ける。
- 一度に一つの論点だけ説明する（技術解説・研究上の判断・実験計画を分けて、順番に）。
- 結論と根拠を分け、断定には理由を示す。仮説や未検証の判断は、そう明記する。

## 5. 実験記録の扱い

- 実験結果の数値・条件を変更・創作しない。
- 既存ログを丸写しせず、要約と原本への参照（ファイル名と見出し）を書く。
- 新しい実験を記録するときは、`research_docs/experiment_index.md` に ID・条件・結果・参照先を追加し、実施済みと未実施を区別する。
- 新しい実験の詳細ログの置き場所は、まだ決まっていない。記録を作る前に、研究者に置き場所を確認する。
- 「観測できなかった」は、①案Aの実装不足、②MV3の構造的限界、③ブラウザを通らない外縁、のどれかを区別して書く。（`research_docs/observation_model.md`）
- 実測済みか、仕様からの予測かを必ず区別する。

## 6. コード変更時のルール

- PoC コード（`pocv1`）は本リポジトリにありません。コードを扱う場合は、対象の所在を確認してから始める。
- 変更前に作業計画を示し、承認を得る。大量の変更を一度にしない。
- 指示されていないファイルを変更しない。`.env` を読み取らない・変更しない。
- テストを勝手にスキップしない。
- 安全方針を守る: 自PC内の隔離環境のみ。送信先は自作ダミーサーバーのみ。実在のカード番号を使わない（公開テスト番号のみ）。本物の攻撃コードを実行しない。（`研究引き継ぎ_確定事項_2026-10-24.md` §7）

## 7. 作業完了時の報告

- 変更・作成したファイルと、その内容を報告する。
- 主要な情報の出典を示す。
- 資料から判断できず「未確認」として残した事項と、元資料と矛盾し得る事項を報告する。
- 重複や不整合の有無を確認した結果を示す。
- 更新が必要になる他のファイルを示す。
- 作業完了後は `/clear` を促す。長いセッションでは `/compact` を提案する。

## 8. 文書の更新ルール

何が変わったかに応じて、次のファイルを更新する。方針の変更は上書きせず、旧→新を追記する。

| 変わったこと | 更新するファイル |
|---|---|
| 研究方針・設計の決定、変更 | `research_docs/research_decisions.md`（旧→新、理由、日付を追記）。影響する `research_docs/research_plan.md`、`research_docs/observation_model.md` |
| 決済方式の分類（4型/5型）の確定 | `research_docs/research_decisions.md`（Q1）、`research_docs/observation_model.md` §3、`research_docs/research_plan.md` §5、`research_docs/literature/pci_dss_ecommerce_2017.md` §4、`research_docs/analysis/open_issues.md`（E-1） |
| 符号化・難読化の扱いの確定 | `research_docs/research_decisions.md`（Q2）、`research_docs/observation_model.md` §5、`research_docs/analysis/open_issues.md`（E-2） |
| RQ・評価基準（○/△/×）の確定 | `research_docs/research_plan.md` §4、`research_docs/observation_model.md` §2, §6、`research_docs/research_decisions.md`（Q3, Q4）、`research_docs/analysis/open_issues.md`（U-1, U-2） |
| 新しい実験の実施 | `research_docs/experiment_index.md`、`research_docs/analysis/findings.md`。未実施の項目に当たる場合は未実施表から移す |
| 先行研究・資料の追加 | `research_docs/literature/` に1件1ファイル。`research_docs/README.md` の一覧と出典略称に追記 |
| 未確認事項・矛盾の解消 | `research_docs/analysis/open_issues.md`（解消の経緯を残し、削除しない）。関連ファイルの【未確認】表記も更新 |

- ID の体系: 決定は D1〜、方針変更は C1〜、決定に関わる論点は Q1〜（`research_docs/research_decisions.md`）。矛盾は E-1〜、未確認事項は U-1〜（`research_docs/analysis/open_issues.md`）。実験は E1〜E5（`research_docs/experiment_index.md`。矛盾の E-1〜 とはハイフンの有無で区別する）。

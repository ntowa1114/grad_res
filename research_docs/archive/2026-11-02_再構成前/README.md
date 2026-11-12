# 研究ナレッジベース README

卒業研究「EC決済ページにおけるカード情報送信の消費者側観測可能性の評価」（佐古研究室）の整理資料です。
既存資料を整理・再構成したもので、新しい研究内容は含みません。資料にない情報は「未確認」と記載しています。

作成日: 2026-10-24（整理時点の資料に基づく）

## 1. 研究の概要

- **何をする研究か:** 消費者側ブラウザ拡張（Manifest V3）が、EC決済におけるカード情報の送信を、決済方式ごとにどこまで観測・判定できるかを測定する。（[H §0]）
- **背景:** Magecart（Webスキミング）では、正規ECサイトに埋め込まれたスキマーがカード情報を攻撃者サーバーへも送る。消費者側の対策は限られる。（[S P4-P9]）
- **重心:** 検知器の精度向上ではなく、「どこまで観測・判定でき、どこで見えなくなるか」の境界を示すこと。（[H §1]）
- **観測点:** 拡張機能の案A（ページ内で fetch を横取り）と案B（webRequest）。（[H §5]）
- **現状:** 実測は PoC（直接送信型・iframeホスト型の2方式、平文送信のみ）まで。検体作成と本測定は未着手。（[P], [H §8]）

詳細は `research_plan.md` を参照。

## 2. ファイルの役割

状態: 作成済み

| ファイル | 役割 | 正本とする情報 |
|---|---|---|
| `README.md` | 入口。概要、ファイル一覧、資料の参照方法 | （なし） |
| `CLAUDE.md` | Claude Code 向けの作業ルールと参照先 | 作業ルール |
| `research_plan.md` | 背景、目的、研究課題、対象範囲、貢献 | 研究計画の記述 |
| `research_decisions.md` | 意思決定と変更の経緯、理由、未確定事項 | 方針・設計判断 |
| `observation_model.md` | 用語、観測レベル L1〜L4、検体設計、前提条件 | 用語・観測モデルの定義 |
| `experiment_index.md` | 実験の一覧、条件、結果の要約、未実施との区別 | 実験の索引（生ログは原本） |
| `literature/bower_2019.md` | Bower (2019) の整理 | 同論文の主張の要約 |
| `literature/pci_dss_ecommerce_2017.md` | PCI DSS 補足文書の整理 | 同文書の主張の要約 |
| `literature/riskiq_inside_magecart_2018.md` | RiskIQ/Flashpoint 報告書の整理（スキマーのグループごとの挙動） | 同報告書の主張の要約 |
| `analysis/findings.md` | 判明したこと、卒論で主張できること（候補）と根拠の対応 | 主張と根拠の対応表 |
| `analysis/open_issues.md` | 未解決事項、情報不足、資料間の矛盾 | 未解決事項の一覧 |

### 論点ごとの正本

同じ論点が複数のファイルに出るときは、次を正本とします。他のファイルは要約か参照です。食い違いを見つけたら、正本を優先し、`analysis/open_issues.md` に記録します。

| 論点 | 正本（本ディレクトリ内） | 原本 |
|---|---|---|
| 用語、L1〜L4、検体の3軸、MV3 の変更点 | `observation_model.md` | [H §2-§5, §10] |
| 決定とその理由、変更の経緯 | `research_decisions.md` | [H] |
| 実験の条件・結果 | `experiment_index.md`（要約） | [P]（ログ・詳細）、[H §8] |
| 判明したこと・主張と根拠 | `analysis/findings.md` | [P], [H] |
| 未解決事項・矛盾 | `analysis/open_issues.md` | 各原本 |
| Bower・PCI の主張 | `literature/` | [B], [BJ], [PCI] |
| 研究の背景・目的・範囲 | `research_plan.md` | [H], [S] |

何が変わったら、どのファイルを更新するかは `CLAUDE.md` §8 に表があります。

## 3. 研究資料の参照方法

リポジトリ直下の既存資料は原本で、変更しません。本ディレクトリの記述が原本と食い違う場合は、原本が優先です（食い違いは `analysis/open_issues.md` に記録します）。

本ディレクトリでは、出典を次の略称で示します。リンクは `research_docs/` からの相対パスです。

| 略称 | 原本 | 性格 |
|---|---|---|
| [H] | [研究引き継ぎ_確定事項_2026-10-24.md](../研究引き継ぎ_確定事項_2026-10-24.md) | 現時点で最新の決定事項。研究方針の一次資料 |
| [P] | [260930_poc実験9月の結果.md](../260930_poc実験9月の結果.md) | PoC の実験記録。実験結果の一次資料 |
| [S] | [卒論進捗発表_v5_内容まとめ.md](../卒論進捗発表_v5_内容まとめ.md) | 10/19 発表のスライド内容（スナップショット。一部が [H] と食い違う） |
| [X] | [参考文献リスト.xlsx](../参考文献リスト.xlsx) | 文献リスト（一部の行が壊れている） |
| [B] | [BowerT-Industry-project-identifying-JavaScript-skimmers-on-high-value-websites.pdf](../BowerT-Industry-project-identifying-JavaScript-skimmers-on-high-value-websites.pdf) | Bower 論文（英語原文） |
| [BJ] | [Bower先行研究論文(日本語).pdf](../Bower先行研究論文%28日本語%29.pdf) | Bower 論文の非公式日本語訳 |
| [PCI] | [best_practices_securing_ecommerce.pdf](../best_practices_securing_ecommerce.pdf) | PCI DSS 補足文書（2017年4月） |
| [RQ] | [Flashpoint_RiskIQ_Inside_MageCart.pdf](../参考文献/論文原文/Flashpoint_RiskIQ_Inside_MageCart.pdf) | RiskIQ/Flashpoint 報告書（2018年。[S P25] の [9]） |

- 節番号は「§」、ページは「p.」、スライドは「P」で示します。
- PoC のコード（`https://github.com/ntowa1114/pocv1`）は本リポジトリに含まれません。[H §11]
- `product/` は空です（2026-10-24）。研究者の方針で、PoC は実施済みの事実として扱い、実験対象（5型のEC、検体、拡張機能、測定）の実装はまだ無いものとして設計します。決済方式は PCI の5型です（`research_decisions.md` C6）。
- `参考文献/論文原文/` に、PCI 文書と Bower 論文の PDF の写しがあります（リポジトリ直下にも同じ PDF が残っています）。
- `.git/` は管理用ディレクトリで、研究資料ではありません。

## 4. 出典・記述の区別

本ディレクトリの記述は、次のタグで性格を区別します。詳細は `CLAUDE.md` を参照。
【観測】【解釈】【仮説】【決定】【提案】【文献】【未確認】

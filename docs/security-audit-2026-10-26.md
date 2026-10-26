# 依存関係の脆弱性調査（2026-10-26）

## 対応結果

以下の調査は修正前の状態を記録したもの。対応では依存と既存の overrides を修正版へ更新し、`bun audit` と `bun audit --production` はともに検出ゼロになった。

MCP は `@hono/mcp` の独自 transport を SDK 標準の Web Standards transport に置き換えた。リクエストごとに server と transport を生成し、JSON で応答する。SDK のバッチ上限（100件）、本文上限（64 KiB）、tool 引数の要素上限（16件）を適用する。現在の tool はファイルの内容ではなくパス・URL・ラベルだけを受け取る。永続セッションやサーバー起点の通知は使わないため、GET の SSE 接続は 405 を返す。

公式 SDK クライアントの接続・ツール一覧・反復呼び出し、同一 RPC ID を使うクライアントの並行実行、本文上限（Content-Length なし・過少申告・超過申告）、バッチ上限、tool 引数上限の回帰テストを追加した。

バックエンド単体テスト435件、Webテスト311件、lint、両方の TypeScript チェック、knip、type-coverage、depcruise、Web build、frozen install を確認した。Web build はチャンクサイズの警告あり。CI の audit を必須にし、Web の型チェックとテストも実行する。

## 結論

対応を推奨する。特に Hono の CORS 処理は、このリポジトリで使用している機能と公表された影響条件が一致する。MCP SDK と Vite も更新対象。ただし監査の検出数は実際に攻撃可能な問題の数ではなく、利用機能・実行環境による切り分けが必要。

依存バージョンは `bun.lock` を確認した。アプリケーションコード・依存関係の変更や攻撃再現は行っていない。

## 監査結果

同日に実施した `bun audit --json` と `bun audit --production --json` の結果。重大度は監査データベースの分類で、アプリ固有の到達性評価ではない。

| 範囲 | 検出パッケージ | advisory の検出数 | Critical | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 開発依存を含む全体 | 22 | 87 | 3 | 33 | 45 | 6 |
| production | 13 | 66 | 2 | 22 | 38 | 4 |

監査の JSON は作業環境の `/tmp/panopticon-audit-all.json`、`/tmp/panopticon-audit-prod.json`。同じ advisory が複数パッケージに現れる場合があり、検出数は重複排除した脆弱性件数ではない。

## 優先する対応

### Hono 4.12.18

2026-08-03 公表の [GHSA-8j4g-w8fx-2239](https://github.com/honojs/hono/security/advisories/GHSA-8j4g-w8fx-2239) は、`allowHeaders` 未指定の CORS middleware で長い `Access-Control-Request-Headers` による CPU 消費・サービス妨害が発生する問題。4.12.34 で修正。

`web/server-app.ts` は全ルートに `cors()` を適用し、`allowHeaders` を指定していないため、該当する処理を使用している。Origin の制限だけで解消する問題ではない。既存 middleware の実装にも対象の正規表現を確認した。Hono を修正版へ更新する対応を優先する。

2026-09-29 公表の [GHSA-5r4p-p66f-jhc7](https://github.com/honojs/hono/security/advisories/GHSA-5r4p-p66f-jhc7) は `serveStatic` の二重デコードで静的パスに限定した middleware を迂回する問題。影響範囲は 4.12.4 以上 4.13.11 未満。リポジトリは `serveStatic` を使うが、公開用の `web/dist` を配信しており、この advisory の「静的ディレクトリの一部を middleware で保護する」条件は確認できない。Hono の更新先は少なくとも 4.13.11 以上を候補にし、全監査結果を再確認する。

### MCP SDK 1.29.0

2026-10-15 公表の [GHSA-46jr-4wx8-v453](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453) は、HTTP で受信した tool 引数の検証によるメモリ枯渇。影響範囲は 1.3.0 以上 1.32.0 未満。**1.32.0 への更新だけでは対策にならず**、`McpServer` の `maxToolInputElements` と受信 body の上限設定が公式の修正手順に含まれる。

このリポジトリは HTTP の `/mcp` と `McpServer` を使用している。現在の tool は主にスカラー引数なので、advisory が特に高リスクとする配列・record 引数への実際の到達性は未検証。接続元を限定する Host guard はあるが、受信した入力の計算量・サイズ制限とは別の防御である。

transport は SDK 標準 transport ではなく `@hono/mcp` 0.2.5 の `StreamableHTTPTransport`。その実装は `ctx.req.json()` で body を読むため、SDK 更新で transport の body 制限まで反映されるとは判断できない。更新時にはこの境界も確認する。

同日公表の [GHSA-f897-62hf-6gxq](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-f897-62hf-6gxq) も body サイズ・JSON-RPC batch 数の制限に関する問題。SDK 側の影響範囲は 1.10.0 以上 1.30.1 未満だが、本リポジトリの独自 transport への修正適用は別途確認が必要。

### Vite 8.0.13（開発時）

2026-10-06 公表の [GHSA-rq7h-c2jc-7f22](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22) は `server.fs.allow` 外のファイルが配信されうる問題。8.0.13 は影響範囲に入り、8.1.6 / 8.2.4 / 8.3.3 などで修正。外部から到達できる開発サーバー、特定の import パス、非 Windows などの条件がある。

`web/vite.config.ts` は通常 `127.0.0.1` に bind するが `HOST` で変更可能。本番の静的ファイル配信と Vite 開発サーバーは区別する。更新推奨だが、通常の production 起動で直ちにこの問題が到達可能と確認したものではない。

[GHSA-fx2h-pf6j-xcff](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)（2026-06-01）は 8.0.13 がバージョン範囲に入るが Windows / NTFS 固有条件があり、現在の Linux 環境ではその条件を確認していない。[GHSA-vfpm-58rq-9qcg](https://github.com/vitejs/vite/security/advisories/GHSA-vfpm-58rq-9qcg)（2026-10-06）は 8.2 / 8.3 系の問題で、8.0.13 は範囲外。

## React の最近の公表との関係

2026-10-14 に React は [RSC の未認証リモートコード実行 GHSA-xqc2-xf4c-x3h3](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3) と [Server Functions の DoS GHSA-h3gv-c5rc-p453](https://github.com/react/react/security/advisories/GHSA-h3gv-c5rc-p453) を公表した。対象は `react-server-dom-webpack` / `react-server-dom-parcel` / `react-server-dom-turbopack`。19.2 系の修正版は 19.2.9。

このリポジトリは React / React DOM 19.2.6 を利用するが、`web/src/client/main.tsx` の `createRoot` で動くクライアント SPA。ロックファイルに Next.js、`react-server-dom-*`、RSC 用 bundler plugin はなく、今回の RSC advisory の対象構成ではないと判断する。React の数字が同じという理由だけで RSC の脆弱性対象にはならない。

`@google/genai` 1.52.0 自体については、確認時点で [公式 security ページ](https://github.com/googleapis/js-genai/security) に公表済み advisory はなかった。ただし推移依存まで安全だという意味ではなく、監査で検出された推移依存は別途更新する必要がある。

## 対応時の確認事項

1. Hono、MCP SDK、Vite と検出された推移依存を更新し、既存の overrides も再評価する。
2. MCP の公式修正手順に沿って受信境界の設定を確認する。現在使う `@hono/mcp` transport まで含めて判断する。
3. audit を再実行し、残る検出を到達性と修正版の有無で整理する。
4. 既存のテスト、typecheck、web build を実施する。今回は調査のみなので未実施。

CI の audit は `continue-on-error: true` の情報表示扱いなので、現状の CI 成功は脆弱性検出ゼロを保証しない。

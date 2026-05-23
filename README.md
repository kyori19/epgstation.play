# epgstation.play

Cloudflare Workers 上で `/.play/` 配下に追加フロントエンドを配信し、EPGStation 録画の再生位置リジューム UI を提供する実装です。

## できること

- `/.play/` で React フロントエンドを表示
- `/.play/api/resume/:recordingId` で再生位置を D1 に保存/取得
- トップページで「新規録画一覧」を表示し、サムネイル・説明冒頭・再生位置(未視聴/視聴済み含む)を確認して録画選択
- 再生位置保存タイミングは 5 分ごと + pause/ended + 画面遷移/バックグラウンド (visibilitychange/pagehide/unload)

## 前提

- Cloudflare Access 配下の単一ユーザー利用（ユーザー識別なし）
- 動画は Workers 経由ではなく EPGStation の既存 URL へ直接アクセス（Range Request）
- 録画 ID がないエピソードは再生不可

## セットアップ

```bash
npm install
```

`wrangler.toml` の以下を設定してください（ローカル実行/手動 deploy 時）。

1. `database_id` を実際の D1 Database ID に置換
2. 本番ドメインの `/.play/*` を `routes` に設定
> GitHub Actions の `deploy.yml` は `CLOUDFLARE_D1_DATABASE_ID` と `CLOUDFLARE_PLAY_ROUTE` を使って `wrangler.toml` のプレースホルダを自動置換します。

## D1 マイグレーション

ローカル:

```bash
npm run d1:migrate:local
```

リモート:

```bash
npm run d1:migrate:remote
```

## 開発

フロントエンド開発:

```bash
npm run dev
```

Worker 開発:

```bash
npm run dev:worker
```

## ビルド / デプロイ

```bash
npm run build
npm run deploy
```

## CI/CD (GitHub Actions)

以下の workflow を追加しています。

- `ci.yml`: PR と `master` push で `npm ci` + `npm run build`
- `deploy.yml`: `master` push と `workflow_dispatch` で Cloudflare Workers へデプロイ

### 必要な Secrets

Repository または Environment (`production`) に以下を設定してください。

- `CLOUDFLARE_API_TOKEN` (最小権限スコープ推奨)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID` (本番 D1 Database ID)
- `CLOUDFLARE_PLAY_ROUTE` (例: `example.com/.play*`)

### デプロイ運用

- 自動デプロイ: `master` へ push で実行
- 手動デプロイ: Actions から `workflow_dispatch` を実行
- D1 マイグレーション: `master` push 時は自動実行、手動実行時は `apply_migrations=true` の場合のみ実行
- deploy workflow は `wrangler.toml` の `database_id` プレースホルダを `CLOUDFLARE_D1_DATABASE_ID` で置換してから実行
- deploy workflow は `wrangler.toml` の `routes` プレースホルダを `CLOUDFLARE_PLAY_ROUTE` で置換してから実行

### セキュリティ/安定運用ポリシー

- workflow は `permissions: contents: read` で最小権限化
- `environment: production` を利用
- `concurrency` で同時デプロイ競合を防止
- Action は公式 action のメジャーバージョン固定を使用

## API の補足

- EPGStation API はフロントエンドから直接呼び出します（認証付き環境を前提）。
- Worker は `/.play/api/resume/:recordingId` と SPA 配信を担当します。

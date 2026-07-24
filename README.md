# TDR BGS図鑑

東京ディズニーリゾートのBGS、トリビア、プロップス、写真、関連施設を管理する個人用PWAです。
データはブラウザのIndexedDBへ保存され、通常利用にサーバーは必要ありません。

## 開発環境

- Node.js 22
- pnpm 10.28.0
- React
- TypeScript
- Vite

## 開発を始める

```powershell
pnpm install
pnpm run dev
```

表示されたローカルURLをブラウザで開きます。

## ビルド確認

変更をGitHubへ送る前に必ず実行してください。

```powershell
pnpm run build
```

TypeScriptの検査だけを行う場合：

```powershell
pnpm run typecheck
```

## GitHub運用

- このリポジトリを正本として管理します。
- 機能変更はブランチで行い、Pull Requestで確認してから`main`へ統合します。
- Pull RequestではGitHub Actionsが自動的にビルドを確認します。
- `main`へ反映されるとGitHub Pagesの公開処理が自動実行されます。
- ZIPファイルや`dist`フォルダーはGitへ登録しません。

## Netlify

Netlifyを使用する場合は、このGitHubリポジトリをNetlifyへ接続してください。
`netlify.toml`により、ビルドコマンドと公開フォルダーが自動設定されます。

- Build command: `pnpm run build`
- Publish directory: `dist`

手動でファイルを選んでアップロードする必要はありません。

## 個人データのバックアップ

施設、写真、タグ、お気に入り、履歴はIndexedDBに保存されるため、GitHubには登録されません。
アプリの設定メニューからJSONバックアップを出力し、別途保管してください。

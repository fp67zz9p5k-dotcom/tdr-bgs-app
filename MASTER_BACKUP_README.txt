TDR BGS図鑑 完全保管版

この保管版には次のものが含まれます。

・React + TypeScript + Viteの開発ソース
・package.json / pnpm-lock.yaml
・PWAアイコン、Manifest、Service Worker
・最新の本番ビルド（dist）
・Netlifyへ公開するためのファイル一式

再開方法

1. このZIPを展開する
2. workフォルダーで pnpm install
3. pnpm run build
4. PCプレビューは pnpm run dev

Netlifyへ公開する方法

「NETLIFY_UPLOAD」フォルダーの中身を、フォルダー構造を維持したまま公開してください。
assetsフォルダーとindex.htmlは必ず同じ階層に置いてください。

重要：個人データについて

施設、写真、タグ、お気に入り、履歴などの実データはブラウザのIndexedDBに保存されています。
これらは開発ソースや公開ファイルには含まれません。
アプリの設定メニューからJSONバックアップを出力し、この保管版ZIPと一緒に保存してください。

# TDR BGS図鑑

東京ディズニーリゾートのBGS・トリビア・プロップスを記録する個人用PWAです。
データはサーバーへ送らず、このアプリを開いたブラウザのIndexedDBに保存します。

## Windowsで起動

Node.js（LTS版）をインストールした後、PowerShellでこのフォルダを開きます。

```powershell
npm install
npm run dev
```

表示された `http://localhost:5173` をブラウザで開いてください。

## 配布用ファイルを作る

```powershell
npm run build
```

`dist` フォルダに配布用ファイルが生成されます。PWAとしてiPhoneに追加するには、
このフォルダをHTTPSで公開する必要があります（無料ホスティングを利用可能）。

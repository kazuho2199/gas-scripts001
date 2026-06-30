# gas-scripts001

Google Apps Script (GAS) を管理・開発するためのプロジェクト。

## プロジェクト概要

- **目的**: Google Apps Script のスクリプトを GitHub で一元管理する
- **管理ツール**: [clasp](https://github.com/google/clasp) (Google の公式 CLI)

## セットアップ

```bash
npm install -g @google/clasp
clasp login
```

## 開発フロー

1. ローカルでスクリプトを編集
2. `clasp push` で GAS にアップロード
3. 変更を GitHub にプッシュ（下記 Git 運用ルール参照）

## Git 運用ルール

**コードを変更するたびに、必ず GitHub にプッシュすること。**

```bash
git add <変更ファイル>
git commit -m "コミットメッセージ"
git push origin main
```

### コミットメッセージの規則

- `feat: ` — 新機能追加
- `fix: ` — バグ修正
- `refactor: ` — リファクタリング
- `docs: ` — ドキュメント変更
- `chore: ` — その他の変更（依存関係など）

### 注意事項

- `clasp push` と `git push` はセットで実行する
- `.clasp.json` や `appsscript.json` もコミット対象に含める
- `node_modules/` は `.gitignore` で除外する
- スクリプト ID などの機密情報は `.env` 管理し、コミットしない

## ファイル構成

```
gas-scripts001/
├── CLAUDE.md          # このファイル
├── .gitignore
├── .clasp.json        # clasp 設定（スクリプト ID）
├── appsscript.json    # GAS マニフェスト
└── src/               # スクリプト本体
    └── *.gs / *.ts
```

## よく使うコマンド

| コマンド | 説明 |
|---|---|
| `clasp push` | ローカル → GAS にアップロード |
| `clasp pull` | GAS → ローカルにダウンロード |
| `clasp open` | ブラウザで GAS エディタを開く |
| `clasp logs` | 実行ログを確認 |
| `git push origin main` | GitHub にプッシュ |

# SSH Terminal

## What This Is

ブラウザベースの SSH ターミナルクライアント。xterm.js でターミナル描画、Rust 製 WebSocket プロキシ経由で SSH サーバーに接続。プロキシは静的ファイル配信も兼ねるため、1プロセスでフロントエンド + バックエンドを提供。

想定用途: 既存の監視画面等から Tampermonkey 経由で IP をクリック → SSH Terminal が開き自動接続。

## Current Status

実装済み・動作確認済み。

## Architecture

```
Browser (React + xterm.js)
    │ WebSocket (ws://localhost:3001/ws)
    │ Static files (http://localhost:3001/)
Rust Proxy Server (axum + russh) ← 1プロセスで両方配信
    │ TCP/SSH
Remote SSH Server
    │ (踏み台経由)
    └── Target hosts (ssh <target> を自動実行)
```

- Wasm は不使用（フロントに CPU bound な処理がないため除去済み）
- ブラウザは raw TCP 不可 → WebSocket プロキシが必須
- プロキシはタスクトレイ常駐アプリ（停止/起動/ポート変更）

## Features

- SSH 接続（パスワード認証）
- xterm.js ターミナル（WebGL, 256色, CJK 対応）
- 複数セッション管理（最大10、左パネルで切替）
- **マルチターミナル表示**: グリッド/タブ切替
  - グリッド: 全ターミナル同時表示（台数で自動レイアウト）
  - タブ: 1台フォーカス表示
  - グリッド内クリック → タブモードでフォーカス
- **URL パラメータ自動接続**: `?host=&category=&group=&targets=`
- **認証情報管理**: config.toml で category × group → credentials
- **踏み台 SSH**: targets 指定で bastion 経由の多段接続
- **接続履歴**: localStorage に保存、ダイアログで選択
- **タスクトレイ**: 停止/起動/ポート変更
- スクロールバック検索（Ctrl+Shift+F、JS 正規表現）
- リサイズ追従（PTY 同期）

## Auth Resolution (category / group)

config.toml で認証情報を管理。呼び出し側は category（と任意で group）を指定。

```toml
# config.toml の場所: %APPDATA%/ssh-terminal-proxy/config.toml

port = 3001
host = "0.0.0.0"

# category のみ指定時 → _default グループが使われる
[auth."monitoring.example.com"."_default"]
username = "admin"
password = "xxxxx"
port = 22

# category + group 指定時 → 完全一致優先、なければ _default フォールバック
[auth."monitoring.example.com"."web-servers"]
username = "web-admin"
password = "yyyyy"
port = 22
```

解決優先順位:
1. `category` + `group` → auth テーブル（group なければ `_default`）
2. `profile` → profiles テーブル
3. `username` + `password` → 直接指定

## URL Parameters

```
http://localhost:3001/?host=10.0.0.1&category=monitoring&group=web&targets=app01,app02
```

| Param | Required | Description |
|-------|----------|-------------|
| `host` | Yes | 接続先 IP（踏み台） |
| `category` | No* | auth 解決用カテゴリ |
| `group` | No | auth 解決用グループ（省略時 `_default`） |
| `profile` | No* | プロファイル名（category の代替） |
| `targets` | No | カンマ区切りホスト名（踏み台から `ssh <target>` 自動実行） |

*category か profile のいずれかが必要（直接 username/password を渡す場合は不要）

## WebSocket Protocol

```
Client → Server:
  { type: "connect", host, port?, username?, password?, profile?, category?, group?, command?, cols?, rows? }
  { type: "data", data }        // base64 encoded
  { type: "resize", cols, rows }
  { type: "disconnect" }

Server → Client:
  { type: "connected", session_id? }
  { type: "data", data }        // base64 encoded
  { type: "error", message }
  { type: "disconnected", reason? }
```

## REST API

- `GET /api/profiles` → プロファイル名一覧（パスワードは返さない）
- `GET /api/config-path` → config.toml のファイルパス

## Project Structure

```
ssh-terminal/
├── src/                          # Frontend (React + TypeScript)
│   ├── App.tsx                   # Root: セッション管理、URL自動接続、レイアウト
│   ├── components/
│   │   ├── Header.tsx            # ヘッダー、レイアウト切替ボタン
│   │   ├── SessionPanel.tsx      # 左パネル（セッション一覧）
│   │   ├── Terminal.tsx          # xterm.js ラッパー
│   │   ├── ConnectDialog.tsx     # 接続ダイアログ（プロファイル選択、履歴）
│   │   ├── SearchBar.tsx         # スクロールバック検索
│   │   └── TerminalGrid.module.css # グリッドレイアウト CSS
│   ├── core/
│   │   ├── websocket.ts          # WebSocket クライアント
│   │   ├── sessionManager.ts     # セッション生成、WS URL 取得
│   │   └── connectionHistory.ts  # 接続履歴（localStorage）
│   ├── styles/globals.css        # デザインシステム
│   └── types/ssh.ts              # 型定義
│
├── server/                       # Rust プロキシサーバー
│   ├── Cargo.toml
│   ├── .cargo/config.toml        # MSVC ターゲット指定
│   └── src/
│       ├── main.rs               # トレイアプリ起動、tokio ランタイム
│       ├── server.rs             # axum ルーター、静的ファイル配信
│       ├── ws_handler.rs         # WebSocket ↔ SSH ブリッジ
│       ├── ssh_session.rs        # russh セッション管理
│       ├── config.rs             # 設定ファイル管理（profiles, auth）
│       └── tray.rs               # システムトレイ UI
│
├── dist/                         # npm run build の出力（サーバーが配信）
└── public/favicon.svg
```

## Tech Stack

| Layer | Technology | License |
|-------|-----------|---------|
| Build | Vite | MIT |
| UI | React 18 + TypeScript | MIT |
| Terminal | xterm.js + @xterm/addon-webgl + @xterm/addon-fit | MIT |
| Styling | CSS Modules | — |
| Icons | Lucide React | MIT |
| Font (Terminal) | JetBrains Mono | OFL |
| Font (UI) | Inter | OFL |
| Server | axum + tokio | MIT |
| SSH | russh | Apache 2.0 |
| Tray | tray-icon + tao | MIT |
| Config | toml + dirs | MIT |

## Development Commands

```bash
# フロントエンドビルド
npm install
npm run build        # dist/ に出力

# サーバービルド（MSVC Build Tools 必要）
cd server
cargo build

# 統合起動（1プロセス: フロントエンド配信 + WebSocket プロキシ）
./server/target/x86_64-pc-windows-msvc/debug/ssh-terminal-server.exe
# → http://localhost:3001/ でアクセス

# 開発時（フロントのみホットリロード）
npm run dev          # Vite dev server (localhost:5173)
# + 別ターミナルでサーバー起動
```

## Build Environment (Windows)

- **MSVC Build Tools** 必須（`winget install Microsoft.VisualStudio.2022.BuildTools`）
- cargo build 時に MSVC link.exe が PATH にある必要:
  ```bash
  export PATH="/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64:$HOME/.cargo/bin:$PATH"
  ```
- Git Bash の `/usr/bin/link.exe` が MSVC の link.exe を隠すため、MSVC パスを先頭に置く
- `.cargo/config.toml` で `target = "x86_64-pc-windows-msvc"` を指定済み

## Key Design Decisions

- Wasm は除去済み（フロントに CPU bound 処理がないため）
- ダークモード主体（DICOM Viewer と共通カラーパレット）
- ライセンス: MIT/Apache 2.0 のみ、GPL 除外
- 1プロセス統合（フロントエンド配信 + WebSocket プロキシ）
- 認証情報はサーバー側 config.toml で管理（ブラウザにパスワードを露出しない）
- category/group の命名は呼び出し側の実装詳細に依存しない汎用名

## Future Extensions

- 鍵認証対応
- SFTP ファイル転送
- ポートフォワーディング
- Tampermonkey スクリプト（別プロジェクト）

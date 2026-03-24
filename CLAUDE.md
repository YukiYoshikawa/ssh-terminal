# SSH Terminal

## What This Is

ブラウザベースの SSH ターミナルクライアント。xterm.js でターミナル描画、Rust WebSocket プロキシ経由で SSH サーバーに接続。WebAssembly の可能性を探る試行プロジェクト。将来的に商用利用を目指す。

## Current Status: 設計完了・実装未開始

## Architecture

```
Browser (React + xterm.js + Rust Wasm)
    │ WebSocket
Rust Proxy Server (axum + russh)
    │ TCP/SSH
Remote SSH Server
```

- ブラウザは raw TCP 不可 → WebSocket プロキシが必須
- SSH プロトコル処理はサーバーサイド (russh)
- Wasm は鍵生成・テキスト検索で活用

## Project Structure

```
ssh-terminal/
├── src/                    # Frontend (React + TypeScript)
│   ├── components/         # Header, SessionPanel, Terminal, ConnectDialog, SearchBar
│   ├── core/               # websocket.ts, sessionManager.ts, keygen.ts
│   ├── styles/             # globals.css (DICOM Viewer と共通デザインシステム)
│   └── types/              # ssh.ts
├── wasm/                   # Rust → Wasm
│   └── src/
│       ├── keygen.rs       # Ed25519/RSA鍵生成
│       └── search.rs       # スクロールバック正規表現検索
└── server/                 # Rust WebSocket-SSH プロキシ
    └── src/
        ├── main.rs         # axum サーバー
        ├── ws_handler.rs   # WebSocket ハンドラー
        └── ssh_session.rs  # russh SSH セッション管理
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
| Wasm | Rust + wasm-pack | MIT/Apache 2.0 |
| Key gen (Wasm) | ed25519-dalek | MIT/Apache 2.0 |
| Regex (Wasm) | regex crate | MIT/Apache 2.0 |
| Server | axum + tokio | MIT |
| SSH Protocol | russh | Apache 2.0 |
| WebSocket | tokio-tungstenite | MIT |

## MVP Features

1. SSH接続 (パスワード認証)
2. xterm.js ターミナル表示 (WebGL, 256色, CJK対応)
3. 複数セッション管理 (最大10、左パネルで切替)
4. SSH鍵生成 — Wasm (Ed25519)
5. スクロールバック検索 — Wasm (正規表現)
6. リサイズ追従 (PTY同期)

## WebSocket Protocol

```
Client → Server: connect, data, resize, disconnect
Server → Client: connected, data, error, disconnected
```

## Key Design Decisions

- Wasm は「活きる場所にだけ」使う (鍵生成=暗号計算、検索=大量テキスト処理)
- ダークモード主体 (DICOM Viewer と共通カラーパレット)
- ライセンス: MIT/Apache 2.0 のみ、GPL 除外
- MVP はパスワード認証。鍵認証は将来追加

## Future Extensions

- 鍵認証対応 (Wasm生成キーでSSH接続)
- SFTP ファイル転送
- セッションプロファイル保存 (localStorage)
- スプリットターミナル
- ポートフォワーディング

## Design Documents

- `docs/superpowers/specs/2026-03-24-ssh-terminal-design.md`

## Development Commands

```bash
# Frontend
npm install
npm run dev          # Vite dev server

# Wasm
npm run wasm:build   # wasm-pack build

# Server
cd server
cargo run            # WebSocket proxy (default: ws://localhost:3001)
```

## Environment Notes (Windows)

- wasm-pack: npm グローバルインストール版を使用
- Rust: stable toolchain, wasm32-unknown-unknown target
- Node.js LTS

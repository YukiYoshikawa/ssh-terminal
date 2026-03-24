# SSH Terminal

ブラウザベースの SSH ターミナルクライアント。Rust 製 WebSocket プロキシ経由で SSH サーバーに接続し、xterm.js でターミナルを描画する。

## Features

- **SSH 接続** — パスワード認証、プロファイルベース認証
- **マルチターミナル** — グリッド/タブ切替で複数セッションを同時表示
- **URL パラメータ自動接続** — 外部ツール（Tampermonkey 等）からワンクリックで SSH 接続
- **踏み台 SSH** — bastion ホスト経由で複数ターゲットに自動接続
- **認証情報管理** — サーバー側 config.toml で category × group ベースの認証解決
- **タスクトレイ常駐** — 起動/停止/ポート変更をトレイから操作
- **1プロセス統合** — フロントエンド配信 + WebSocket プロキシを1つのサーバーで提供

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://rustup.rs/)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Windows, C++ workload)

### Build

```bash
# フロントエンド
npm install
npm run build

# サーバー
cd server
cargo build --release
```

### Run

```bash
./server/target/x86_64-pc-windows-msvc/release/ssh-terminal-server.exe
```

ブラウザで http://localhost:3001/ を開く。

## Configuration

設定ファイル: `%APPDATA%/ssh-terminal-proxy/config.toml`

```toml
port = 3001
host = "0.0.0.0"

# プロファイル認証（profile パラメータで指定）
[profiles.dev]
username = "testuser"
password = "password123"
port = 22

# カテゴリ × グループ認証（category + group パラメータで指定）
# group 省略時は _default が使われる
[auth."monitoring.example.com"."_default"]
username = "admin"
password = "xxxxx"
port = 22

[auth."monitoring.example.com"."web-servers"]
username = "web-admin"
password = "yyyyy"
port = 22
```

## URL Parameters

外部ツールから URL パラメータで自動接続できる。

```
http://localhost:3001/?host=10.0.0.1&category=monitoring.example.com&group=web-servers
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `host` | Yes | 接続先 IP アドレス |
| `category` | No* | 認証解決用カテゴリ |
| `group` | No | 認証解決用グループ（省略時 `_default`） |
| `profile` | No* | プロファイル名（category の代替） |
| `targets` | No | カンマ区切りホスト名（踏み台から各ホストへ自動 SSH） |

\* `category` か `profile` のいずれかが必要（手動接続時は不要）

### Examples

```
# 単一ホスト接続
http://localhost:3001/?host=10.0.0.1&category=prod

# 踏み台経由で複数ホストに接続（グリッド表示）
http://localhost:3001/?host=10.0.0.1&category=prod&group=web&targets=app01,app02,db01
```

## Architecture

```
Browser (React + xterm.js)
    │
    │ http://localhost:3001/     ← 静的ファイル配信
    │ ws://localhost:3001/ws     ← WebSocket
    │
Rust Proxy Server (axum + russh)
    │
    │ TCP/SSH
    │
SSH Server (踏み台)
    ├── ssh app01
    ├── ssh app02
    └── ssh db01
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ws` | WebSocket | SSH セッション |
| `/api/profiles` | GET | プロファイル名一覧 |
| `/api/config-path` | GET | config.toml のファイルパス |

## Development

```bash
# フロントエンド（ホットリロード）
npm run dev

# サーバー（別ターミナル）
cd server
cargo run
```

開発時はフロントエンドが localhost:5173、サーバーが localhost:3001 で動作し、Vite のプロキシ設定で WebSocket が転送される。

## License

MIT

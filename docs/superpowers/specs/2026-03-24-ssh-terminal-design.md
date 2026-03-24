# SSH Terminal - Design Specification

## Overview

WebAssembly の可能性を探る試行プロジェクトとして、ブラウザベースの SSH ターミナルクライアントを構築する。xterm.js でターミナル UI を描画し、Rust 製 WebSocket プロキシサーバー経由で SSH サーバーに接続する。Wasm は SSH 鍵生成やスクロールバック検索など意味のある箇所に活用。DICOM Viewer と同じダークプロフェッショナルデザインを共有する。

## Architecture

```
Browser
├── React + TypeScript (UI)
│   ├── ConnectDialog — 接続情報入力
│   ├── Terminal (xterm.js) — ターミナル描画
│   └── SessionPanel — セッション一覧・切替
├── Rust Wasm Module
│   ├── SSH鍵生成 (Ed25519/RSA)
│   ├── スクロールバック検索 (正規表現)
│   └── ANSIパース/フィルタ
└── WebSocket
        │
WebSocket Proxy Server (Rust)
├── axum + tokio-tungstenite
├── WebSocket ←→ SSH TCP bridge
└── russh (SSH2 protocol)
        │
SSH Server (remote)
```

### Why This Architecture

- ブラウザは raw TCP 不可 → WebSocket プロキシが必須
- SSH プロトコル処理はサーバーサイド（russh）で行い、フロントは端末描画に専念
- Wasm は暗号計算（鍵生成）とテキスト処理（検索）で活用 — Wasm が活きる場所にだけ使う方針

### Wasm Usage Policy

| Processing | Wasm | Reason |
|-----------|------|--------|
| SSH key pair generation (Ed25519/RSA) | **Yes** | Cryptographic computation, browser-side security |
| Scrollback search (regex) | **Yes** | Fast regex over large text buffers |
| ANSI parse/filter | **Yes** | CPU-bound parse of terminal output |
| SSH connection/protocol | No | Requires TCP; server-side only |
| Terminal rendering | No | xterm.js WebGL renderer is optimal |

## UI Design

### Color Palette

Shared with DICOM Viewer:

| Usage | Color |
|-------|-------|
| Background (deepest) | `#0a0a0f` |
| Background (panel) | `#12131a` |
| Background (surface) | `#1a1b26` |
| Border | `#2a2b3a` |
| Text (primary) | `#e0e0e8` |
| Text (secondary) | `#8888a0` |
| Accent | `#4a9eff` |
| Accent (error) | `#ff6b6b` |
| Accent (success) | `#4ecdc4` |

### Layout

```
┌──────────────────────────────────────────────────┐
│  ■ SSH Terminal    [user@host]   [+] [≡]    [⛶] │ ← Header (40px)
├──────────┬───────────────────────────────────────┤
│          │                                       │
│ Sessions │   $ ls -la                            │
│ ──────── │   total 48                            │
│ ▶ web-01 │   drwxr-xr-x  5 user user 4096 ...  │
│   db-01  │   -rw-r--r--  1 user user  220 ...   │
│   app-01 │   $ _                                 │
│          │                                       │
│          │                                       │
│ ──────── │                                       │
│ [+ New]  │                                       │
│          │                                       │
├──────────┤                                       │
│  160px   │                                       │
└──────────┴───────────────────────────────────────┘
             ↑ xterm.js (flexible)
```

- Session panel (left 160px): Session list, collapsible
- Main area (center): xterm.js terminal with WebGL renderer
- Connect dialog: Modal for host/port/user/auth input
- Fullscreen mode supported

### Visual Quality

- Same gradients, shadows, animations as DICOM Viewer
- Terminal font: JetBrains Mono (OFL) — best monospace font
- UI font: Inter (OFL) — shared with DICOM Viewer
- Icons: Lucide React (MIT)

## Connection Flow

```
1. User clicks [+ New]
2. Connect dialog appears
   - Host / Port (default: 22)
   - Username
   - Auth method: Password (MVP) / Key auth (future)
3. Frontend → WebSocket connect to proxy with connection info
4. Proxy → russh establishes SSH connection
5. Bidirectional data stream begins
6. xterm.js renders terminal output
```

### WebSocket Protocol

```typescript
// Client → Server
{ type: 'connect', host: string, port: number, username: string, password: string }
{ type: 'data', data: string }       // terminal input
{ type: 'resize', cols: number, rows: number }
{ type: 'disconnect' }

// Server → Client
{ type: 'connected' }
{ type: 'data', data: string }       // terminal output
{ type: 'error', message: string }
{ type: 'disconnected', reason: string }
```

## Project Structure

### Frontend

```
ssh-terminal/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Header.module.css
│   │   ├── SessionPanel.tsx
│   │   ├── SessionPanel.module.css
│   │   ├── Terminal.tsx
│   │   ├── Terminal.module.css
│   │   ├── ConnectDialog.tsx
│   │   ├── ConnectDialog.module.css
│   │   ├── SearchBar.tsx
│   │   └── SearchBar.module.css
│   ├── core/
│   │   ├── websocket.ts           # WebSocket connection management
│   │   ├── sessionManager.ts      # Multi-session state
│   │   └── keygen.ts              # Wasm key generation bridge
│   ├── styles/
│   │   └── globals.css            # Shared design system
│   └── types/
│       └── ssh.ts                 # Type definitions
├── wasm/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── keygen.rs              # Ed25519/RSA key generation
│       └── search.rs              # Scrollback regex search
└── public/
    └── favicon.svg
```

### Backend (Server)

```
ssh-terminal/server/
├── Cargo.toml
└── src/
    ├── main.rs                    # axum server startup
    ├── ws_handler.rs              # WebSocket handler
    ├── ssh_session.rs             # russh SSH session management
    └── config.rs                  # Server configuration
```

## Tech Stack

| Layer | Technology | License | Rationale |
|-------|-----------|---------|-----------|
| Build | Vite | MIT | Shared with DICOM Viewer |
| UI | React 18 + TypeScript | MIT | Shared |
| Terminal | xterm.js + @xterm/addon-webgl + @xterm/addon-fit | MIT | De facto browser terminal |
| Styling | CSS Modules | — | Shared |
| Icons | Lucide React | MIT | Shared |
| Font (Terminal) | JetBrains Mono | OFL | Best monospace |
| Font (UI) | Inter | OFL | Shared |
| Wasm | Rust + wasm-pack | MIT/Apache 2.0 | Shared |
| Key gen (Wasm) | ed25519-dalek, rsa | MIT/Apache 2.0 | Cryptographic libraries |
| Regex (Wasm) | regex crate | MIT/Apache 2.0 | Fast regex engine |
| Server | axum + tokio | MIT | Async Rust web framework |
| SSH Protocol | russh | Apache 2.0 | Pure Rust SSH2 implementation |
| WebSocket | tokio-tungstenite | MIT | Async WebSocket |

### License Policy

MIT / Apache 2.0 only. No LGPL/GPL dependencies.

## MVP Specification

| # | Feature | Detail | Acceptance Criteria |
|---|---------|--------|---------------------|
| 1 | SSH connection | Host/user/password authentication via proxy | Can connect to an SSH server and get a shell |
| 2 | Terminal display | xterm.js WebGL rendering, 256 colors, CJK support | Terminal renders correctly with Japanese text |
| 3 | Multiple sessions | Left panel session list, click to switch, max 10 | Can open multiple SSH sessions and switch between them |
| 4 | SSH key generation (Wasm) | Ed25519 key pair generated in browser, download as files | Generate and download id_ed25519 + id_ed25519.pub |
| 5 | Scrollback search (Wasm) | Ctrl+Shift+F opens search bar, regex support | Can search terminal history with regex |
| 6 | Resize tracking | Browser resize syncs PTY dimensions | Terminal reflows on window resize |

## Error Handling

- **Connection failed**: Dialog shows reason (timeout / auth failure / network error / proxy down)
- **Disconnected**: Terminal overlay "Connection lost. [Reconnect] [Close]"
- **Proxy stopped**: All sessions receive disconnect notification
- **Invalid host/port**: Client-side validation before sending to proxy

## Future Extensions

- **Key authentication**: Upload private key or use Wasm-generated key for SSH auth
- **SFTP file transfer**: Browse and transfer files over SSH
- **Session persistence**: Save connection profiles in localStorage
- **Split terminals**: Multiple terminals in one session (tmux-like)
- **Port forwarding**: SSH tunnel via proxy

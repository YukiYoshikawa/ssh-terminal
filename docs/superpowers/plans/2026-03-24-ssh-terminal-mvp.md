# SSH Terminal MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based SSH terminal client with xterm.js frontend, Rust WebSocket proxy, and Rust Wasm modules for key generation and search.

**Architecture:** React + xterm.js frontend communicates via WebSocket with a Rust (axum) proxy server that bridges to SSH servers using russh. Wasm modules handle Ed25519 key generation and scrollback regex search.

**Tech Stack:** Vite, React 18, TypeScript, xterm.js, CSS Modules, Rust (axum + russh + wasm-pack)

---

## File Structure

```
ssh-terminal/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
│
├── src/
│   ├── main.tsx                      # Entry point
│   ├── App.tsx                       # Root: session state, layout orchestration
│   ├── components/
│   │   ├── Header.tsx                # App header with connection info
│   │   ├── Header.module.css
│   │   ├── SessionPanel.tsx          # Left panel: session list
│   │   ├── SessionPanel.module.css
│   │   ├── Terminal.tsx              # xterm.js wrapper
│   │   ├── Terminal.module.css
│   │   ├── ConnectDialog.tsx         # Connection form modal
│   │   ├── ConnectDialog.module.css
│   │   ├── SearchBar.tsx             # Wasm-powered search (Ctrl+Shift+F)
│   │   └── SearchBar.module.css
│   ├── core/
│   │   ├── websocket.ts              # WebSocket connection class
│   │   └── sessionManager.ts         # Session CRUD + state
│   ├── styles/
│   │   └── globals.css               # Design system (shared palette)
│   └── types/
│       └── ssh.ts                    # Type definitions
│
├── wasm/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                    # Wasm exports
│       ├── keygen.rs                 # Ed25519 key generation
│       └── search.rs                 # Regex search over text buffer
│
├── server/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                   # axum server + CORS
│       ├── ws_handler.rs             # WebSocket ↔ SSH bridge
│       └── ssh_session.rs            # russh session wrapper
│
└── public/
    └── favicon.svg
```

---

## Task 1: Backend — Rust WebSocket-SSH Proxy Server

**Files:**
- Create: `server/Cargo.toml`
- Create: `server/src/main.rs`
- Create: `server/src/ws_handler.rs`
- Create: `server/src/ssh_session.rs`

- [ ] **Step 1: Create server Cargo.toml**

```toml
[package]
name = "ssh-terminal-server"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = { version = "0.8", features = ["ws"] }
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.6", features = ["cors"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
russh = "0.50"
russh-keys = "0.50"
async-trait = "0.1"
tracing = "0.1"
tracing-subscriber = "0.3"
futures = "0.3"
```

- [ ] **Step 2: Create ssh_session.rs — SSH client handler**

```rust
use async_trait::async_trait;
use russh::*;
use russh_keys::key;
use std::sync::Arc;
use tokio::sync::mpsc;

pub struct SshClient {
    pub sender: mpsc::UnboundedSender<Vec<u8>>,
}

#[async_trait]
impl client::Handler for SshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Accept all server keys (MVP — add known_hosts in future)
        Ok(true)
    }

    async fn data(
        &mut self,
        _channel: ChannelId,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let _ = self.sender.send(data.to_vec());
        Ok(())
    }
}

pub struct SshSession {
    pub handle: client::Handle<SshClient>,
    pub channel_id: ChannelId,
}

impl SshSession {
    pub async fn connect(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        sender: mpsc::UnboundedSender<Vec<u8>>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let config = Arc::new(client::Config::default());
        let handler = SshClient { sender };

        let mut handle = client::connect(config, (host, port), handler).await?;

        let auth_result = handle
            .authenticate_password(username, password)
            .await?;

        if !auth_result {
            return Err("Authentication failed".into());
        }

        let channel = handle.channel_open_session().await?;
        let channel_id = channel.id();
        channel.request_pty(
            false, "xterm-256color", 80, 24, 0, 0, &[],
        ).await?;
        channel.request_shell(false).await?;

        Ok(SshSession { handle, channel_id })
    }

    pub async fn send_data(&self, data: &[u8]) -> Result<(), russh::Error> {
        self.handle.data(self.channel_id, data.into()).await
    }

    pub async fn resize(&self, cols: u32, rows: u32) -> Result<(), russh::Error> {
        self.handle
            .window_change(self.channel_id, cols, rows, 0, 0)
            .await
    }

    pub async fn close(self) {
        let _ = self.handle.disconnect(Disconnect::ByApplication, "", "en").await;
    }
}
```

- [ ] **Step 3: Create ws_handler.rs — WebSocket handler**

```rust
use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{error, info};

use crate::ssh_session::SshSession;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "connect")]
    Connect {
        host: String,
        port: u16,
        username: String,
        password: String,
    },
    #[serde(rename = "data")]
    Data { data: String },
    #[serde(rename = "resize")]
    Resize { cols: u32, rows: u32 },
    #[serde(rename = "disconnect")]
    Disconnect,
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ServerMessage {
    #[serde(rename = "connected")]
    Connected,
    #[serde(rename = "data")]
    Data { data: String },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "disconnected")]
    Disconnected { reason: String },
}

fn server_msg(msg: &ServerMessage) -> Message {
    Message::Text(serde_json::to_string(msg).unwrap().into())
}

pub async fn handle_websocket(socket: WebSocket) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Wait for connect message
    let connect_msg = match ws_receiver.next().await {
        Some(Ok(Message::Text(text))) => {
            match serde_json::from_str::<ClientMessage>(&text) {
                Ok(msg) => msg,
                Err(e) => {
                    let _ = ws_sender.send(server_msg(&ServerMessage::Error {
                        message: format!("Invalid message: {}", e),
                    })).await;
                    return;
                }
            }
        }
        _ => return,
    };

    let (host, port, username, password) = match connect_msg {
        ClientMessage::Connect { host, port, username, password } => {
            (host, port, username, password)
        }
        _ => {
            let _ = ws_sender.send(server_msg(&ServerMessage::Error {
                message: "Expected connect message".into(),
            })).await;
            return;
        }
    };

    info!("Connecting to {}:{} as {}", host, port, username);

    // Channel for SSH output → WebSocket
    let (ssh_tx, mut ssh_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // Establish SSH connection
    let session = match SshSession::connect(&host, port, &username, &password, ssh_tx).await {
        Ok(s) => {
            let _ = ws_sender.send(server_msg(&ServerMessage::Connected)).await;
            info!("Connected to {}:{}", host, port);
            s
        }
        Err(e) => {
            error!("SSH connection failed: {}", e);
            let _ = ws_sender.send(server_msg(&ServerMessage::Error {
                message: format!("Connection failed: {}", e),
            })).await;
            return;
        }
    };

    let session = std::sync::Arc::new(session);
    let session_write = session.clone();

    // Task: SSH output → WebSocket
    let mut send_task = tokio::spawn(async move {
        while let Some(data) = ssh_rx.recv().await {
            let text = String::from_utf8_lossy(&data).to_string();
            if ws_sender.send(server_msg(&ServerMessage::Data { data: text })).await.is_err() {
                break;
            }
        }
    });

    // Task: WebSocket input → SSH
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                        match client_msg {
                            ClientMessage::Data { data } => {
                                if let Err(e) = session_write.send_data(data.as_bytes()).await {
                                    error!("SSH send error: {}", e);
                                    break;
                                }
                            }
                            ClientMessage::Resize { cols, rows } => {
                                let _ = session_write.resize(cols, rows).await;
                            }
                            ClientMessage::Disconnect => break,
                            _ => {}
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    info!("Session closed for {}:{}", host, port);
}
```

- [ ] **Step 4: Create main.rs — axum server**

```rust
mod ssh_session;
mod ws_handler;

use axum::{extract::WebSocketUpgrade, response::IntoResponse, routing::get, Router};
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber;

async fn ws_upgrade(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(ws_handler::handle_websocket)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::init();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/ws", get(ws_upgrade))
        .layer(cors);

    let addr = "0.0.0.0:3001";
    println!("SSH Terminal Proxy listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

- [ ] **Step 5: Build and verify server compiles**

```bash
cd c:/Users/yukiv/develop/AntiGravity/Workspace/Was_trial/ssh-terminal/server
export PATH="$HOME/.cargo/bin:$PATH"
cargo build 2>&1
```

Expected: Compiles successfully.

- [ ] **Step 6: Init git and commit**

```bash
cd c:/Users/yukiv/develop/AntiGravity/Workspace/Was_trial/ssh-terminal
git init
```

Create `.gitignore`:
```
node_modules/
dist/
wasm/pkg/
wasm/target/
server/target/
.superpowers/
*.log
```

```bash
git add server/ .gitignore CLAUDE.md docs/
git commit -m "feat: add Rust WebSocket-SSH proxy server with axum + russh"
```

---

## Task 2: Frontend — Project Scaffolding

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`

- [ ] **Step 1: Initialize Vite project**

```bash
cd c:/Users/yukiv/develop/AntiGravity/Workspace/Was_trial/ssh-terminal
export PATH="/c/Program Files/nodejs:/c/Users/yukiv/AppData/Roaming/npm:$PATH"
npm create vite@latest . -- --template react-ts
```

Overwrite existing files if prompted (only docs/server/CLAUDE.md exist).

- [ ] **Step 2: Install dependencies**

```bash
npm install @xterm/xterm @xterm/addon-webgl @xterm/addon-fit lucide-react
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 4: Configure Vite for Wasm**

Replace `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  assetsInclude: ['**/*.wasm'],
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 5: Add npm scripts to package.json**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:run": "vitest run",
    "wasm:build": "cd wasm && wasm-pack build --target web --out-dir pkg",
    "server": "cd server && cargo run"
  }
}
```

- [ ] **Step 6: Verify project starts**

```bash
npm run dev
```

Expected: Vite dev server on http://localhost:5174 (5173 may be taken by DICOM viewer).

- [ ] **Step 7: Commit**

```bash
git add package.json vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json index.html src/ public/
git commit -m "chore: scaffold Vite + React + TS project with xterm.js deps"
```

---

## Task 3: Design System & Type Definitions

**Files:**
- Create: `src/styles/globals.css`
- Create: `src/types/ssh.ts`
- Create: `public/favicon.svg`

- [ ] **Step 1: Create globals.css**

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');

:root {
  --bg-deep: #0a0a0f;
  --bg-panel: #12131a;
  --bg-surface: #1a1b26;
  --border: #2a2b3a;
  --text-primary: #e0e0e8;
  --text-secondary: #8888a0;
  --accent: #4a9eff;
  --accent-hover: #5eadff;
  --accent-error: #ff6b6b;
  --accent-success: #4ecdc4;
  --accent-warning: #ffd93d;
  --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  --header-height: 40px;
  --panel-left-width: 160px;
  --transition: 200ms ease-out;
}

*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  overflow: hidden;
}

body {
  font-family: var(--font-ui);
  background: var(--bg-deep);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
```

- [ ] **Step 2: Create ssh.ts types**

```typescript
export interface SshConnectionInfo {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface SshSession {
  id: string;
  label: string;           // user@host
  connectionInfo: SshConnectionInfo;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

// WebSocket protocol messages
export type ClientMessage =
  | { type: 'connect'; host: string; port: number; username: string; password: string }
  | { type: 'data'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'disconnect' };

export type ServerMessage =
  | { type: 'connected' }
  | { type: 'data'; data: string }
  | { type: 'error'; message: string }
  | { type: 'disconnected'; reason: string };
```

- [ ] **Step 3: Create favicon.svg**

Same medical-cross style but with a terminal prompt icon:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#12131a"/><text x="3" y="12" font-family="monospace" font-size="11" fill="#4a9eff">&gt;_</text></svg>
```

- [ ] **Step 4: Update index.html**

```html
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>SSH Terminal</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Commit**

```bash
git add src/styles/ src/types/ public/ index.html
git commit -m "feat: add design system, type definitions, and favicon"
```

---

## Task 4: WebSocket Client & Session Manager

**Files:**
- Create: `src/core/websocket.ts`
- Create: `src/core/sessionManager.ts`

- [ ] **Step 1: Create websocket.ts**

```typescript
import type { ClientMessage, ServerMessage } from '../types/ssh';

export class SshWebSocket {
  private ws: WebSocket | null = null;
  private onMessage: (msg: ServerMessage) => void;
  private onClose: () => void;

  constructor(
    onMessage: (msg: ServerMessage) => void,
    onClose: () => void,
  ) {
    this.onMessage = onMessage;
    this.onClose = onClose;
  }

  connect(wsUrl: string): void {
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        this.onMessage(msg);
      } catch (e) {
        console.error('Invalid server message:', e);
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.onClose();
    };

    this.ws.onerror = () => {
      this.onMessage({ type: 'error', message: 'WebSocket connection failed' });
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    if (this.ws) {
      this.send({ type: 'disconnect' });
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
```

- [ ] **Step 2: Create sessionManager.ts**

```typescript
import type { SshSession, SshConnectionInfo } from '../types/ssh';

let nextId = 1;

export function createSession(info: SshConnectionInfo): SshSession {
  return {
    id: `session-${nextId++}`,
    label: `${info.username}@${info.host}`,
    connectionInfo: info,
    status: 'connecting',
  };
}

export function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/
git commit -m "feat: add WebSocket client and session manager"
```

---

## Task 5: UI Components — Header, SessionPanel, ConnectDialog

**Files:**
- Create: `src/components/Header.tsx`, `Header.module.css`
- Create: `src/components/SessionPanel.tsx`, `SessionPanel.module.css`
- Create: `src/components/ConnectDialog.tsx`, `ConnectDialog.module.css`

- [ ] **Step 1: Create Header component**

Header with app title, active session label, and fullscreen toggle. Same style as DICOM Viewer header.

- [ ] **Step 2: Create ConnectDialog component**

Modal with host, port, username, password fields. Dark-themed form with validation. Shows error messages on failed connection.

- [ ] **Step 3: Create SessionPanel component**

Left panel with session list. Each session shows status icon (green=connected, yellow=connecting, red=error, gray=disconnected) and label. Click to switch. [+ New] button at bottom. Disconnect button per session.

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.* src/components/SessionPanel.* src/components/ConnectDialog.*
git commit -m "feat: add Header, SessionPanel, and ConnectDialog components"
```

---

## Task 6: Terminal Component (xterm.js)

**Files:**
- Create: `src/components/Terminal.tsx`, `Terminal.module.css`

- [ ] **Step 1: Create Terminal component**

xterm.js wrapper with:
- WebGL addon for GPU-accelerated rendering
- Fit addon for auto-resize
- Theme matching design system colors
- `onData` callback for user input → WebSocket
- `write()` method exposed via ref for SSH output → terminal
- ResizeObserver for container size changes → `onResize` callback
- Disconnect overlay when session is lost

```typescript
import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import styles from './Terminal.module.css';

export interface TerminalHandle {
  write: (data: string) => void;
  focus: () => void;
  clear: () => void;
  getBuffer: () => string;
}

interface TerminalProps {
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  isDisconnected?: boolean;
  onReconnect?: () => void;
}
```

xterm.js theme:
```typescript
const theme = {
  background: '#0a0a0f',
  foreground: '#e0e0e8',
  cursor: '#4a9eff',
  cursorAccent: '#0a0a0f',
  selectionBackground: '#4a9eff44',
  black: '#1a1b26',
  red: '#ff6b6b',
  green: '#4ecdc4',
  yellow: '#ffd93d',
  blue: '#4a9eff',
  magenta: '#c792ea',
  cyan: '#89ddff',
  white: '#e0e0e8',
  brightBlack: '#8888a0',
  brightRed: '#ff8a8a',
  brightGreen: '#6ee6dd',
  brightYellow: '#ffe566',
  brightBlue: '#5eadff',
  brightMagenta: '#d4a8f0',
  brightCyan: '#a6e8ff',
  brightWhite: '#ffffff',
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Terminal.*
git commit -m "feat: add xterm.js Terminal component with WebGL rendering"
```

---

## Task 7: App Shell — Wire Everything Together

**Files:**
- Create: `src/App.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Create App.tsx**

Root component managing:
- `sessions: SshSession[]` state
- `activeSessionId: string | null` state
- `showConnectDialog: boolean` state
- `terminalRefs: Map<string, TerminalHandle>` for per-session terminal refs
- `wsInstances: Map<string, SshWebSocket>` for per-session WebSocket connections
- `handleConnect(info)` — creates session, opens WebSocket, sends connect message
- `handleDisconnect(sessionId)` — closes WebSocket, updates session status
- `handleSessionSelect(sessionId)` — switches active terminal
- Layout: Header + SessionPanel (left) + Terminal (center)
- Max 10 sessions validation

- [ ] **Step 2: Update main.tsx**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Verify end-to-end**

1. Start proxy: `cd server && cargo run`
2. Start frontend: `npm run dev`
3. Open browser → click [+ New] → enter SSH credentials → verify connection

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/main.tsx
git commit -m "feat: integrate all components into App shell with multi-session support"
```

---

## Task 8: Rust Wasm — Key Generation & Search

**Files:**
- Create: `wasm/Cargo.toml`
- Create: `wasm/src/lib.rs`
- Create: `wasm/src/keygen.rs`
- Create: `wasm/src/search.rs`

- [ ] **Step 1: Create wasm/Cargo.toml**

```toml
[package]
name = "ssh-terminal-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
ed25519-dalek = { version = "2", features = ["rand_core"] }
rand_core = { version = "0.6", features = ["getrandom"] }
getrandom = { version = "0.2", features = ["js"] }
regex = "1"
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"

[profile.release]
opt-level = "s"
lto = true

[package.metadata.wasm-pack.profile.release]
wasm-opt = false
```

- [ ] **Step 2: Create keygen.rs**

```rust
use ed25519_dalek::SigningKey;
use rand_core::OsRng;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Ed25519KeyPair {
    private_key_openssh: String,
    public_key_openssh: String,
}

#[wasm_bindgen]
impl Ed25519KeyPair {
    #[wasm_bindgen(getter)]
    pub fn private_key(&self) -> String {
        self.private_key_openssh.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn public_key(&self) -> String {
        self.public_key_openssh.clone()
    }
}

#[wasm_bindgen]
pub fn generate_ed25519_keypair() -> Ed25519KeyPair {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    // Encode public key in OpenSSH format
    let pub_bytes = verifying_key.as_bytes();
    let mut pub_blob = Vec::new();
    // string "ssh-ed25519"
    let key_type = b"ssh-ed25519";
    pub_blob.extend_from_slice(&(key_type.len() as u32).to_be_bytes());
    pub_blob.extend_from_slice(key_type);
    // string key data
    pub_blob.extend_from_slice(&(pub_bytes.len() as u32).to_be_bytes());
    pub_blob.extend_from_slice(pub_bytes);

    let pub_b64 = base64_encode(&pub_blob);
    let public_key_openssh = format!("ssh-ed25519 {} wasm-generated", pub_b64);

    // Encode private key in OpenSSH format (simplified PEM)
    let priv_bytes = signing_key.to_bytes();
    let priv_b64 = base64_encode(&priv_bytes);
    let private_key_openssh = format!(
        "-----BEGIN OPENSSH PRIVATE KEY-----\n{}\n-----END OPENSSH PRIVATE KEY-----\n",
        priv_b64
    );

    Ed25519KeyPair {
        private_key_openssh,
        public_key_openssh,
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[(n >> 18 & 63) as usize] as char);
        result.push(CHARS[(n >> 12 & 63) as usize] as char);
        if chunk.len() > 1 { result.push(CHARS[(n >> 6 & 63) as usize] as char); } else { result.push('='); }
        if chunk.len() > 2 { result.push(CHARS[(n & 63) as usize] as char); } else { result.push('='); }
    }
    result
}
```

- [ ] **Step 3: Create search.rs**

```rust
use regex::Regex;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct SearchResult {
    line: u32,
    start: u32,
    end: u32,
    text: String,
}

#[wasm_bindgen]
impl SearchResult {
    #[wasm_bindgen(getter)]
    pub fn line(&self) -> u32 { self.line }
    #[wasm_bindgen(getter)]
    pub fn start(&self) -> u32 { self.start }
    #[wasm_bindgen(getter)]
    pub fn end(&self) -> u32 { self.end }
    #[wasm_bindgen(getter)]
    pub fn text(&self) -> String { self.text.clone() }
}

#[wasm_bindgen]
pub fn search_buffer(buffer: &str, pattern: &str, case_sensitive: bool) -> Vec<SearchResult> {
    let pattern = if case_sensitive {
        pattern.to_string()
    } else {
        format!("(?i){}", pattern)
    };

    let re = match Regex::new(&pattern) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let mut results = Vec::new();
    for (line_num, line) in buffer.lines().enumerate() {
        for mat in re.find_iter(line) {
            results.push(SearchResult {
                line: line_num as u32,
                start: mat.start() as u32,
                end: mat.end() as u32,
                text: mat.as_str().to_string(),
            });
        }
    }
    results
}
```

- [ ] **Step 4: Create lib.rs**

```rust
mod keygen;
mod search;

pub use keygen::*;
pub use search::*;
```

- [ ] **Step 5: Build Wasm**

```bash
cd c:/Users/yukiv/develop/AntiGravity/Workspace/Was_trial/ssh-terminal
export PATH="/c/Program Files/nodejs:/c/Users/yukiv/AppData/Roaming/npm:$HOME/.cargo/bin:$PATH"
npm run wasm:build
```

Expected: Wasm module built to `wasm/pkg/`.

- [ ] **Step 6: Commit**

```bash
git add wasm/
git commit -m "feat: add Rust Wasm module with Ed25519 keygen and regex search"
```

---

## Task 9: SearchBar Component & Keygen Integration

**Files:**
- Create: `src/components/SearchBar.tsx`, `SearchBar.module.css`
- Create: `src/core/keygen.ts`

- [ ] **Step 1: Create keygen.ts — Wasm bridge**

```typescript
let wasmModule: typeof import('../../wasm/pkg/ssh_terminal_wasm') | null = null;

async function loadWasm() {
  if (!wasmModule) {
    wasmModule = await import('../../wasm/pkg/ssh_terminal_wasm');
  }
  return wasmModule;
}

export async function generateEd25519KeyPair(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  const wasm = await loadWasm();
  const keypair = wasm.generate_ed25519_keypair();
  return {
    privateKey: keypair.private_key,
    publicKey: keypair.public_key,
  };
}

export async function searchBuffer(
  buffer: string,
  pattern: string,
  caseSensitive: boolean,
): Promise<Array<{ line: number; start: number; end: number; text: string }>> {
  const wasm = await loadWasm();
  const results = wasm.search_buffer(buffer, pattern, caseSensitive);
  return results.map((r: any) => ({
    line: r.line,
    start: r.start,
    end: r.end,
    text: r.text,
  }));
}
```

- [ ] **Step 2: Create SearchBar component**

Ctrl+Shift+F opens search bar at top of terminal. Input field + result count + prev/next buttons. Uses Wasm `search_buffer` on the terminal's scrollback buffer. Highlights matches (via xterm.js selection API or decoration addon).

- [ ] **Step 3: Add keygen UI to ConnectDialog**

"Generate SSH Key" button in ConnectDialog that calls Wasm, shows result, and offers download as files.

- [ ] **Step 4: Commit**

```bash
git add src/components/SearchBar.* src/core/keygen.ts
git commit -m "feat: add Wasm-powered search bar and SSH key generation UI"
```

---

## Task 10: Final Polish & End-to-End Test

**Files:**
- Modify: `src/App.tsx` — keyboard shortcuts
- Modify: various CSS — polish

- [ ] **Step 1: Add global keyboard shortcuts**

- `Ctrl+Shift+F` — toggle search bar
- `Ctrl+Shift+N` — new connection
- `Ctrl+Shift+W` — disconnect active session
- `Ctrl+Tab` / `Ctrl+Shift+Tab` — cycle sessions

- [ ] **Step 2: End-to-end verification**

1. `cd server && cargo run` (proxy on :3001)
2. `npm run dev` (frontend on :5174)
3. Open browser → [+ New] → connect to SSH server
4. Verify: terminal works, resize, multiple sessions, search, key generation

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add keyboard shortcuts and polish for MVP release"
```

- [ ] **Step 4: Push to GitHub**

```bash
gh repo create ssh-terminal --public --source=. --remote=origin --push
```

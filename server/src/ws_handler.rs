use axum::extract::ws::{Message, WebSocket};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use crate::config::ServerConfig;
use crate::ssh_session::SshSession;

// ── Protocol types ──────────────────────────────────────────────────────────

/// Messages sent from the browser to the server.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientMessage {
    Connect {
        host: String,
        port: Option<u16>,
        username: Option<String>,
        password: Option<String>,
        profile: Option<String>,
        category: Option<String>,      // auth lookup: category
        group: Option<String>,        // auth lookup: group (optional, falls back to _default)
        targets: Option<Vec<String>>, // jump host targets
        command: Option<String>,      // auto-send command after shell starts
        cols: Option<u32>,
        rows: Option<u32>,
    },
    Data {
        data: String,
    },
    Resize {
        cols: u32,
        rows: u32,
    },
    Disconnect,
}

/// Messages sent from the server to the browser.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage {
    Connected { session_id: Option<String> },
    Data { data: String },
    Error { message: String },
    Disconnected,
}

fn encode(msg: &ServerMessage) -> Message {
    Message::Text(
        serde_json::to_string(msg)
            .unwrap_or_else(|_| r#"{"type":"error","message":"serialization failed"}"#.to_string())
            .into(),
    )
}

// ── Handler ──────────────────────────────────────────────────────────────────

pub async fn handle_websocket(socket: WebSocket, config: Arc<ServerConfig>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // ── Step 1: Wait for the initial "connect" message ───────────────────
    let connect_msg = loop {
        match ws_rx.next().await {
            Some(Ok(Message::Text(text))) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(msg @ ClientMessage::Connect { .. }) => break msg,
                    Ok(other) => {
                        warn!("Expected connect, got: {:?}", other);
                        let _ = ws_tx
                            .send(encode(&ServerMessage::Error {
                                message: "First message must be 'connect'".into(),
                            }))
                            .await;
                    }
                    Err(e) => {
                        let _ = ws_tx
                            .send(encode(&ServerMessage::Error {
                                message: format!("JSON parse error: {}", e),
                            }))
                            .await;
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => {
                info!("WebSocket closed before connect");
                return;
            }
            Some(Ok(_)) => {} // ping/binary — ignore
            Some(Err(e)) => {
                error!("WebSocket error: {}", e);
                return;
            }
        }
    };

    // ── Step 2: Resolve credentials ──────────────────────────────────────
    let (host, port, username, password, cols, rows, auto_command) = match connect_msg {
        ClientMessage::Connect {
            host,
            port,
            username,
            password,
            profile,
            category,
            group,
            targets: _,
            command,
            cols,
            rows,
        } => {
            let default_port = port.unwrap_or(22);
            let (resolved_user, resolved_pass, resolved_port) = match config.resolve_credentials(
                category.as_deref(),
                group.as_deref(),
                profile.as_deref(),
                username.as_deref(),
                password.as_deref(),
                default_port,
            ) {
                Ok(creds) => creds,
                Err(msg) => {
                    let _ = ws_tx
                        .send(encode(&ServerMessage::Error { message: msg }))
                        .await;
                    return;
                }
            };

            (
                host,
                resolved_port,
                resolved_user,
                resolved_pass,
                cols.unwrap_or(80),
                rows.unwrap_or(24),
                command,
            )
        }
        _ => unreachable!(),
    };

    // ── Step 3: Establish SSH connection ─────────────────────────────────
    let session = match SshSession::connect(&host, port, &username, &password, cols, rows).await {
        Ok(s) => s,
        Err(e) => {
            error!("SSH connect failed: {}", e);
            let _ = ws_tx
                .send(encode(&ServerMessage::Error {
                    message: format!("SSH connection failed: {}", e),
                }))
                .await;
            return;
        }
    };

    // Notify the browser that we're connected
    if ws_tx
        .send(encode(&ServerMessage::Connected { session_id: None }))
        .await
        .is_err()
    {
        session.close().await;
        return;
    }

    info!("SSH session established for {}@{}:{}", username, host, port);

    // ── Step 4: Channels ─────────────────────────────────────────────────
    // SSH output → WebSocket
    let (ssh_out_tx, mut ssh_out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    // Commands from WebSocket input → SSH session owner task
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SshCommand>();

    // If an auto-command was provided (e.g. "ssh target\n"), send it immediately
    if let Some(ref cmd) = auto_command {
        let mut bytes = cmd.as_bytes().to_vec();
        // Ensure it ends with a newline
        if !bytes.ends_with(b"\n") {
            bytes.push(b'\n');
        }
        let _ = cmd_tx.send(SshCommand::Data(bytes));
    }

    // ── SSH owner task: drives reads AND writes ──────────────────────────
    let ssh_task = tokio::spawn(async move {
        let mut session = session;
        loop {
            tokio::select! {
                // Process SSH output
                () = session.run_reader(ssh_out_tx.clone()) => {
                    // run_reader returned → channel closed
                    break;
                }
                // Process input commands
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(SshCommand::Data(bytes)) => {
                            if let Err(e) = session.send_data(&bytes).await {
                                error!("SSH send_data error: {}", e);
                                break;
                            }
                        }
                        Some(SshCommand::Resize(c, r)) => {
                            let _ = session.resize(c, r).await;
                        }
                        Some(SshCommand::Close) | None => {
                            session.close().await;
                            break;
                        }
                    }
                }
            }
        }
        // Drop ssh_out_tx so the write task terminates
    });

    // ── WebSocket write task: SSH output → browser ───────────────────────
    let ws_write_task = tokio::spawn(async move {
        while let Some(bytes) = ssh_out_rx.recv().await {
            let encoded = STANDARD.encode(&bytes);
            if ws_tx
                .send(encode(&ServerMessage::Data { data: encoded }))
                .await
                .is_err()
            {
                break;
            }
        }
        let _ = ws_tx.send(encode(&ServerMessage::Disconnected)).await;
    });

    // ── Step 5: WebSocket → SSH (main loop) ──────────────────────────────
    while let Some(msg) = ws_rx.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Data { data }) => {
                        // data is base64 from the browser
                        let bytes = STANDARD.decode(&data).unwrap_or_else(|_| data.into_bytes());
                        let _ = cmd_tx.send(SshCommand::Data(bytes));
                    }
                    Ok(ClientMessage::Resize { cols, rows }) => {
                        let _ = cmd_tx.send(SshCommand::Resize(cols, rows));
                    }
                    Ok(ClientMessage::Disconnect) | Ok(ClientMessage::Connect { .. }) => {
                        break;
                    }
                    Err(e) => warn!("JSON parse error: {}", e),
                }
            }
            Ok(Message::Binary(bytes)) => {
                let _ = cmd_tx.send(SshCommand::Data(bytes.to_vec()));
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
        }
    }

    // ── Step 6: Clean up ─────────────────────────────────────────────────
    let _ = cmd_tx.send(SshCommand::Close);
    let _ = tokio::join!(ssh_task, ws_write_task);
    info!("WebSocket session closed for {}@{}:{}", username, host, port);
}

#[derive(Debug)]
enum SshCommand {
    Data(Vec<u8>),
    Resize(u32, u32),
    Close,
}

// Windows: hide console window when running as tray app
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod server;
mod ssh_session;
mod tray;
mod ws_handler;

use config::ServerConfig;
use std::sync::{Arc, atomic::AtomicBool};
use tokio::sync::{mpsc, watch};
use tray::{TrayCommand, run_tray};

fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ssh_terminal_server=debug,info".parse().unwrap()),
        )
        .init();

    let cfg = ServerConfig::load();
    let running = Arc::new(AtomicBool::new(true));
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<TrayCommand>();

    // Start tokio runtime in a background thread
    let initial_port = cfg.port;
    let initial_addr = cfg.bind_addr();
    let initial_cfg = cfg.clone();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async move {
            let (shutdown_tx, shutdown_rx) = watch::channel(false);
            let mut current_shutdown_tx = shutdown_tx;
            let mut current_addr = initial_addr;

            // Start initial server
            let mut server_handle = {
                let addr = current_addr.clone();
                let rx = current_shutdown_tx.subscribe();
                let cfg = initial_cfg.clone();
                Some(tokio::spawn(async move {
                    server::run_server(cfg, addr, rx).await;
                }))
            };

            // Process tray commands
            while let Some(cmd) = cmd_rx.recv().await {
                match cmd {
                    TrayCommand::StartServer => {
                        if server_handle.is_none() {
                            let (tx, rx) = watch::channel(false);
                            current_shutdown_tx = tx;
                            let addr = current_addr.clone();
                            let cfg = ServerConfig::load();
                            server_handle = Some(tokio::spawn(async move {
                                server::run_server(cfg, addr, rx).await;
                            }));
                            tracing::info!("Server started on {}", current_addr);
                        }
                    }
                    TrayCommand::StopServer => {
                        if let Some(handle) = server_handle.take() {
                            current_shutdown_tx.send(true).ok();
                            handle.await.ok();
                            tracing::info!("Server stopped");
                        }
                    }
                    TrayCommand::ChangePort(port) => {
                        // Stop current server
                        if let Some(handle) = server_handle.take() {
                            current_shutdown_tx.send(true).ok();
                            handle.await.ok();
                        }
                        // Update config
                        let mut cfg = ServerConfig::load();
                        cfg.port = port;
                        cfg.save();
                        current_addr = cfg.bind_addr();

                        // Start on new port
                        let (tx, rx) = watch::channel(false);
                        current_shutdown_tx = tx;
                        let addr = current_addr.clone();
                        server_handle = Some(tokio::spawn(async move {
                            server::run_server(cfg, addr, rx).await;
                        }));
                        tracing::info!("Server restarted on port {}", port);
                    }
                    TrayCommand::Quit => {
                        if let Some(handle) = server_handle.take() {
                            current_shutdown_tx.send(true).ok();
                            handle.await.ok();
                        }
                        break;
                    }
                }
            }
        });
    });

    // Run tray on main thread (required by Windows)
    run_tray(cmd_tx, running, initial_port);
}

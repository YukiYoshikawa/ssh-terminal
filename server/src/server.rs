use axum::{
    extract::WebSocketUpgrade,
    response::IntoResponse,
    routing::get,
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;
use tokio::sync::watch;
use std::path::PathBuf;
use crate::ws_handler::handle_websocket;

async fn ws_route(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_websocket)
}

fn find_dist_dir() -> Option<PathBuf> {
    // Check relative to exe location first
    if let Ok(exe) = std::env::current_exe() {
        // exe is in server/target/.../debug/ — dist is at ../../dist or ../../../dist
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..6 {
            if let Some(ref d) = dir {
                let candidate = d.join("dist");
                if candidate.join("index.html").exists() {
                    return Some(candidate);
                }
                // Also check ../dist (for ssh-terminal/dist from ssh-terminal/server/)
                let sibling = d.join("../dist");
                if sibling.join("index.html").exists() {
                    return Some(sibling.canonicalize().unwrap_or(sibling));
                }
                dir = d.parent().map(|p| p.to_path_buf());
            }
        }
    }
    // Check current working directory
    let cwd_dist = PathBuf::from("../dist");
    if cwd_dist.join("index.html").exists() {
        return Some(cwd_dist);
    }
    let cwd_dist = PathBuf::from("dist");
    if cwd_dist.join("index.html").exists() {
        return Some(cwd_dist);
    }
    None
}

pub async fn run_server(bind_addr: String, mut shutdown_rx: watch::Receiver<bool>) {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut app = Router::new()
        .route("/ws", get(ws_route));

    // Serve frontend static files if dist/ exists
    if let Some(dist_dir) = find_dist_dir() {
        info!("Serving frontend from {}", dist_dir.display());
        let index = dist_dir.join("index.html");
        app = app
            .fallback_service(
                ServeDir::new(&dist_dir)
                    .not_found_service(ServeFile::new(index))
            );
    } else {
        info!("No dist/ directory found — frontend not served (use npm run dev separately)");
    }

    app = app.layer(cors);

    let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("Failed to bind {}: {}", bind_addr, e);
            return;
        }
    };

    info!("Server listening on http://{}", bind_addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            loop {
                shutdown_rx.changed().await.ok();
                if *shutdown_rx.borrow() {
                    break;
                }
            }
            info!("Server shutting down");
        })
        .await
        .ok();
}

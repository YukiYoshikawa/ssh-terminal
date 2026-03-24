mod ssh_session;
mod ws_handler;

use axum::{
    extract::WebSocketUpgrade,
    response::IntoResponse,
    routing::get,
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use ws_handler::handle_websocket;

async fn ws_route(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_websocket)
}

#[tokio::main]
async fn main() {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ssh_terminal_server=debug,info".parse().unwrap()),
        )
        .init();

    // CORS: allow any origin (dev-only)
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/ws", get(ws_route))
        .layer(cors);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001")
        .await
        .expect("Failed to bind port 3001");

    info!("SSH-terminal proxy listening on ws://0.0.0.0:3001/ws");

    axum::serve(listener, app)
        .await
        .expect("Server error");
}

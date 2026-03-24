use russh::{
    client::{self, AuthResult, Config, Handle, Msg},
    keys::ssh_key,
    Channel, ChannelMsg, Disconnect,
};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, info};

/// SSH client handler — accepts all server host keys (MVP only, not for production)
pub struct SshClient;

impl client::Handler for SshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // MVP: accept any host key
        Ok(true)
    }
}

/// Manages a single SSH session.
pub struct SshSession {
    handle: Handle<SshClient>,
    channel: Channel<Msg>,
}

impl SshSession {
    /// Connect to an SSH server and open an interactive PTY session.
    pub async fn connect(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        cols: u32,
        rows: u32,
    ) -> Result<Self, russh::Error> {
        let config = Arc::new(Config::default());
        let sh = SshClient;

        let addr = format!("{}:{}", host, port);
        info!("Connecting to SSH server at {}", addr);

        let mut handle = client::connect(config, addr.as_str(), sh).await?;

        // Password authentication
        let auth_result = handle
            .authenticate_password(username, password)
            .await?;

        match auth_result {
            AuthResult::Success => {
                info!("SSH authenticated as '{}'", username);
            }
            AuthResult::Failure { .. } => {
                return Err(russh::Error::NotAuthenticated);
            }
        }

        // Open a session channel
        let channel = handle.channel_open_session().await?;

        // Request a PTY
        channel
            .request_pty(
                false,
                "xterm-256color",
                cols,
                rows,
                0,
                0,
                &[], // terminal modes
            )
            .await?;

        // Start an interactive shell
        channel.request_shell(false).await?;

        Ok(SshSession { handle, channel })
    }

    /// Drive the SSH channel, forwarding output bytes to `output_tx`.
    /// Returns when the channel closes.
    pub async fn run_reader(&mut self, output_tx: mpsc::UnboundedSender<Vec<u8>>) {
        loop {
            match self.channel.wait().await {
                Some(ChannelMsg::Data { ref data }) => {
                    debug!("SSH data: {} bytes", data.len());
                    if output_tx.send(data.to_vec()).is_err() {
                        break;
                    }
                }
                Some(ChannelMsg::ExtendedData { ref data, ext: 1 }) => {
                    // stderr
                    if output_tx.send(data.to_vec()).is_err() {
                        break;
                    }
                }
                Some(ChannelMsg::Eof) => {
                    info!("SSH channel EOF");
                    break;
                }
                Some(ChannelMsg::Close) => {
                    info!("SSH channel closed");
                    break;
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    info!("SSH exit status: {}", exit_status);
                    // Don't break immediately; wait for Eof/Close
                }
                Some(_) => {}
                None => {
                    info!("SSH channel stream ended");
                    break;
                }
            }
        }
    }

    /// Send raw bytes to the SSH channel (keyboard input).
    pub async fn send_data(&self, data: &[u8]) -> Result<(), russh::Error> {
        self.channel
            .data(&mut data.as_ref())
            .await
    }

    /// Send a PTY resize request.
    pub async fn resize(&self, cols: u32, rows: u32) -> Result<(), russh::Error> {
        self.channel.window_change(cols, rows, 0, 0).await
    }

    /// Close the SSH session gracefully.
    pub async fn close(self) {
        let _ = self.channel.close().await;
        let _ = self
            .handle
            .disconnect(Disconnect::ByApplication, "", "en")
            .await;
    }
}

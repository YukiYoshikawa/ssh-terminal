use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshProfile {
    pub username: String,
    pub password: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

fn default_port() -> u16 { 22 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_server_port")]
    pub port: u16,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default)]
    pub default_profile: Option<String>,
    #[serde(default)]
    pub profiles: HashMap<String, SshProfile>,
}

fn default_server_port() -> u16 { 3001 }
fn default_host() -> String { "0.0.0.0".to_string() }

impl Default for ServerConfig {
    fn default() -> Self {
        let mut profiles = HashMap::new();
        profiles.insert("default".to_string(), SshProfile {
            username: "user".to_string(),
            password: "password".to_string(),
            port: 22,
        });
        Self {
            port: 3001,
            host: "0.0.0.0".to_string(),
            default_profile: Some("default".to_string()),
            profiles,
        }
    }
}

fn config_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ssh-terminal-proxy");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("config.toml")
}

impl ServerConfig {
    pub fn load() -> Self {
        let path = config_path();
        match fs::read_to_string(&path) {
            Ok(content) => toml::from_str(&content).unwrap_or_default(),
            Err(_) => {
                let config = Self::default();
                config.save();
                config
            }
        }
    }

    pub fn save(&self) {
        let path = config_path();
        if let Ok(content) = toml::to_string_pretty(self) {
            fs::write(&path, content).ok();
        }
    }

    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn get_profile(&self, name: &str) -> Option<&SshProfile> {
        self.profiles.get(name)
    }

    pub fn config_file_path() -> PathBuf {
        config_path()
    }
}

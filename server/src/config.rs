use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshCredential {
    pub username: String,
    pub password: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

fn default_port() -> u16 { 22 }

// Keep backward compat alias
pub type SshProfile = SshCredential;

/// Default group name used when category is specified without a group
const DEFAULT_GROUP: &str = "_default";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_server_port")]
    pub port: u16,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default)]
    pub default_profile: Option<String>,
    /// Named profiles: profile_name → credentials
    #[serde(default)]
    pub profiles: HashMap<String, SshCredential>,
    /// Category × Group auth: category → group → credentials
    /// [auth."monitoring.example.com"."web-servers"]
    /// [auth."monitoring.example.com"."_default"]  ← fallback when group is omitted
    #[serde(default)]
    pub auth: HashMap<String, HashMap<String, SshCredential>>,
}

fn default_server_port() -> u16 { 3001 }
fn default_host() -> String { "0.0.0.0".to_string() }

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            port: 3001,
            host: "0.0.0.0".to_string(),
            default_profile: None,
            profiles: HashMap::new(),
            auth: HashMap::new(),
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

    /// Lookup by profile name
    pub fn get_profile(&self, name: &str) -> Option<&SshCredential> {
        self.profiles.get(name)
    }

    /// Lookup by category × group, with _default fallback
    pub fn get_auth(&self, category: &str, group: Option<&str>) -> Option<&SshCredential> {
        let groups = self.auth.get(category)?;
        if let Some(g) = group {
            // Try exact group first, then _default
            groups.get(g).or_else(|| groups.get(DEFAULT_GROUP))
        } else {
            // No group specified → use _default
            groups.get(DEFAULT_GROUP)
        }
    }

    /// Resolve credentials from any available source:
    /// 1. category + group → auth table (group optional, falls back to _default)
    /// 2. profile name → profiles table
    /// 3. explicit username/password
    pub fn resolve_credentials(
        &self,
        category: Option<&str>,
        group: Option<&str>,
        profile: Option<&str>,
        username: Option<&str>,
        password: Option<&str>,
        default_port: u16,
    ) -> Result<(String, String, u16), String> {
        // Try category (+ optional group) first
        if let Some(cat) = category {
            if let Some(cred) = self.get_auth(cat, group) {
                return Ok((cred.username.clone(), cred.password.clone(), cred.port));
            }
            return Err(match group {
                Some(g) => format!("No auth config for category='{}' group='{}' (and no _default)", cat, g),
                None => format!("No auth config for category='{}' (no _default group)", cat),
            });
        }

        // Try profile
        if let Some(p) = profile {
            if let Some(cred) = self.get_profile(p) {
                return Ok((cred.username.clone(), cred.password.clone(), cred.port));
            }
            return Err(format!("Profile '{}' not found", p));
        }

        // Try explicit credentials
        match (username, password) {
            (Some(u), Some(p)) => Ok((u.to_string(), p.to_string(), default_port)),
            _ => Err("No credentials provided (need category, profile, or username+password)".into()),
        }
    }

    pub fn config_file_path() -> PathBuf {
        config_path()
    }
}

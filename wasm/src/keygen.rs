use wasm_bindgen::prelude::*;
use ed25519_dalek::SigningKey;
use rand_core::OsRng;

// Base64 encoding table
const BASE64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut result = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i] as usize;
        let b1 = if i + 1 < data.len() { data[i + 1] as usize } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] as usize } else { 0 };

        result.push(BASE64_CHARS[(b0 >> 2) & 0x3F]);
        result.push(BASE64_CHARS[((b0 << 4) | (b1 >> 4)) & 0x3F]);
        result.push(if i + 1 < data.len() { BASE64_CHARS[((b1 << 2) | (b2 >> 6)) & 0x3F] } else { b'=' });
        result.push(if i + 2 < data.len() { BASE64_CHARS[b2 & 0x3F] } else { b'=' });

        i += 3;
    }
    String::from_utf8(result).unwrap()
}

fn encode_openssh_public_key(verifying_key: &ed25519_dalek::VerifyingKey) -> String {
    // OpenSSH public key wire format:
    // string "ssh-ed25519"
    // string <32-byte public key>
    let key_type = b"ssh-ed25519";
    let pub_bytes = verifying_key.as_bytes();

    let mut wire = Vec::new();
    // Length-prefixed key type
    let type_len = (key_type.len() as u32).to_be_bytes();
    wire.extend_from_slice(&type_len);
    wire.extend_from_slice(key_type);
    // Length-prefixed public key
    let key_len = (pub_bytes.len() as u32).to_be_bytes();
    wire.extend_from_slice(&key_len);
    wire.extend_from_slice(pub_bytes);

    format!("ssh-ed25519 {} wasm-generated", base64_encode(&wire))
}

fn encode_openssh_private_key(signing_key: &SigningKey) -> String {
    // OpenSSH private key format (simplified PEM wrapper)
    // Full OpenSSH private key format:
    // "openssh-key-v1\0"
    // string cipher ("none")
    // string kdfname ("none")
    // string kdfoptions ("")
    // uint32 number of keys (1)
    // string publickey
    // string private keys section

    let verifying_key = signing_key.verifying_key();
    let pub_bytes = verifying_key.as_bytes();
    let priv_bytes = signing_key.as_bytes();

    let key_type = b"ssh-ed25519";
    let cipher = b"none";
    let kdfname = b"none";
    let kdfoptions: &[u8] = b"";

    let mut wire = Vec::new();

    // Magic header
    wire.extend_from_slice(b"openssh-key-v1\0");

    // cipher name
    let cipher_len = (cipher.len() as u32).to_be_bytes();
    wire.extend_from_slice(&cipher_len);
    wire.extend_from_slice(cipher);

    // kdf name
    let kdf_len = (kdfname.len() as u32).to_be_bytes();
    wire.extend_from_slice(&kdf_len);
    wire.extend_from_slice(kdfname);

    // kdf options (empty string)
    let opts_len = (kdfoptions.len() as u32).to_be_bytes();
    wire.extend_from_slice(&opts_len);
    wire.extend_from_slice(kdfoptions);

    // number of keys = 1
    wire.extend_from_slice(&1u32.to_be_bytes());

    // public key (wire encoded)
    let mut pubkey_wire = Vec::new();
    pubkey_wire.extend_from_slice(&(key_type.len() as u32).to_be_bytes());
    pubkey_wire.extend_from_slice(key_type);
    pubkey_wire.extend_from_slice(&(pub_bytes.len() as u32).to_be_bytes());
    pubkey_wire.extend_from_slice(pub_bytes);

    wire.extend_from_slice(&(pubkey_wire.len() as u32).to_be_bytes());
    wire.extend_from_slice(&pubkey_wire);

    // private keys section
    // checkint1, checkint2 (same random 32-bit value for integrity check)
    let check: u32 = 0x12345678;
    let mut priv_section = Vec::new();
    priv_section.extend_from_slice(&check.to_be_bytes());
    priv_section.extend_from_slice(&check.to_be_bytes());

    // private key entry: key type, public key, private+public concatenated (64 bytes)
    priv_section.extend_from_slice(&(key_type.len() as u32).to_be_bytes());
    priv_section.extend_from_slice(key_type);
    priv_section.extend_from_slice(&(pub_bytes.len() as u32).to_be_bytes());
    priv_section.extend_from_slice(pub_bytes);

    // ed25519 private key is 64 bytes: first 32 = private scalar, next 32 = public key
    let mut priv_concat = Vec::new();
    priv_concat.extend_from_slice(priv_bytes);
    priv_concat.extend_from_slice(pub_bytes);
    priv_section.extend_from_slice(&(priv_concat.len() as u32).to_be_bytes());
    priv_section.extend_from_slice(&priv_concat);

    // comment
    let comment = b"wasm-generated";
    priv_section.extend_from_slice(&(comment.len() as u32).to_be_bytes());
    priv_section.extend_from_slice(comment);

    // padding to block size (8 for "none" cipher)
    let pad_len = (8 - (priv_section.len() % 8)) % 8;
    for i in 0..pad_len {
        priv_section.push((i + 1) as u8);
    }

    wire.extend_from_slice(&(priv_section.len() as u32).to_be_bytes());
    wire.extend_from_slice(&priv_section);

    // Wrap in PEM
    let b64 = base64_encode(&wire);
    // Wrap at 70 chars per line
    let mut pem_body = String::new();
    let chars: Vec<char> = b64.chars().collect();
    for chunk in chars.chunks(70) {
        pem_body.push_str(&chunk.iter().collect::<String>());
        pem_body.push('\n');
    }

    format!(
        "-----BEGIN OPENSSH PRIVATE KEY-----\n{}-----END OPENSSH PRIVATE KEY-----\n",
        pem_body
    )
}

#[wasm_bindgen]
pub struct Ed25519KeyPair {
    private_key: String,
    public_key: String,
}

#[wasm_bindgen]
impl Ed25519KeyPair {
    #[wasm_bindgen(getter)]
    pub fn private_key(&self) -> String {
        self.private_key.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }
}

#[wasm_bindgen]
pub fn generate_ed25519_keypair() -> Ed25519KeyPair {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    let public_key = encode_openssh_public_key(&verifying_key);
    let private_key = encode_openssh_private_key(&signing_key);

    Ed25519KeyPair { private_key, public_key }
}

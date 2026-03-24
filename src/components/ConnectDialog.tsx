import { useState, useEffect } from 'react';
import type { SshConnectionInfo } from '../types/ssh';
import { generateEd25519KeyPair } from '../core/keygen';
import styles from './ConnectDialog.module.css';

interface ConnectDialogProps {
  open: boolean;
  onConnect: (info: SshConnectionInfo) => void;
  onCancel: () => void;
  error?: string;
  connecting?: boolean;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ConnectDialog({ open, onConnect, onCancel, error, connecting }: ConnectDialogProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState('');

  // Keygen state
  const [generatedPublicKey, setGeneratedPublicKey] = useState('');
  const [generatedPrivateKey, setGeneratedPrivateKey] = useState('');
  const [keygenLoading, setKeygenLoading] = useState(false);
  const [keygenError, setKeygenError] = useState('');

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setHost('');
      setPort('22');
      setUsername('');
      setPassword('');
      setValidationError('');
      setGeneratedPublicKey('');
      setGeneratedPrivateKey('');
      setKeygenError('');
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim()) {
      setValidationError('ホストは必須です');
      return;
    }
    if (!username.trim()) {
      setValidationError('ユーザー名は必須です');
      return;
    }
    setValidationError('');
    onConnect({
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      username: username.trim(),
      password,
    });
  };

  const handleGenerateKey = async () => {
    setKeygenLoading(true);
    setKeygenError('');
    setGeneratedPublicKey('');
    setGeneratedPrivateKey('');
    try {
      const { privateKey, publicKey } = await generateEd25519KeyPair();
      setGeneratedPublicKey(publicKey);
      setGeneratedPrivateKey(privateKey);
    } catch (err) {
      setKeygenError('鍵の生成に失敗しました: ' + String(err));
    } finally {
      setKeygenLoading(false);
    }
  };

  const handleDownloadPrivateKey = () => {
    downloadFile(generatedPrivateKey, 'id_ed25519', 'application/octet-stream');
  };

  const handleDownloadPublicKey = () => {
    downloadFile(generatedPublicKey, 'id_ed25519.pub', 'text/plain');
  };

  const displayError = validationError || error;

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget && !connecting) onCancel(); }}>
      <div className={styles.card}>
        <div className={styles.title}>SSH接続</div>

        <form onSubmit={handleSubmit}>
          <div className={styles.fields}>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>ホスト</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="hostname or IP"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  disabled={connecting}
                  autoFocus
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>ポート</label>
                <input
                  className={styles.input}
                  type="number"
                  placeholder="22"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={connecting}
                  min={1}
                  max={65535}
                />
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>ユーザー名</label>
              <input
                className={styles.input}
                type="text"
                placeholder="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={connecting}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>パスワード</label>
              <input
                className={styles.input}
                type="password"
                placeholder="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={connecting}
              />
            </div>
          </div>

          {displayError && (
            <div className={styles.error}>{displayError}</div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onCancel}
              disabled={connecting}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className={styles.connectBtn}
              disabled={connecting}
            >
              {connecting && <span className={styles.spinner} />}
              {connecting ? '接続中...' : '接続'}
            </button>
          </div>
        </form>

        {/* SSH Key Generation Section */}
        <div className={styles.keygenSection}>
          <div className={styles.keygenHeader}>
            <span className={styles.keygenTitle}>SSH鍵生成 (Ed25519)</span>
            <button
              type="button"
              className={styles.keygenBtn}
              onClick={handleGenerateKey}
              disabled={keygenLoading || !!connecting}
            >
              {keygenLoading && <span className={styles.spinner} />}
              {keygenLoading ? '生成中...' : 'SSH鍵を生成'}
            </button>
          </div>

          {keygenError && (
            <div className={styles.error}>{keygenError}</div>
          )}

          {generatedPublicKey && (
            <div className={styles.keyResult}>
              <label className={styles.label}>公開鍵</label>
              <textarea
                className={styles.keyTextarea}
                readOnly
                value={generatedPublicKey}
                rows={2}
              />
              <div className={styles.keyActions}>
                <button
                  type="button"
                  className={styles.downloadBtn}
                  onClick={handleDownloadPrivateKey}
                >
                  秘密鍵をダウンロード
                </button>
                <button
                  type="button"
                  className={styles.downloadBtn}
                  onClick={handleDownloadPublicKey}
                >
                  公開鍵をダウンロード
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

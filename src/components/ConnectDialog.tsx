import { useState, useEffect } from 'react';
import type { SshConnectionInfo } from '../types/ssh';
import styles from './ConnectDialog.module.css';

interface ConnectDialogProps {
  open: boolean;
  onConnect: (info: SshConnectionInfo) => void;
  onCancel: () => void;
  error?: string;
  connecting?: boolean;
}

export function ConnectDialog({ open, onConnect, onCancel, error, connecting }: ConnectDialogProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState('');

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setHost('');
      setPort('22');
      setUsername('');
      setPassword('');
      setValidationError('');
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
      </div>
    </div>
  );
}

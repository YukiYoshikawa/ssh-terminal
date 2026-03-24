import { Plus, X, ChevronLeft } from 'lucide-react';
import type { SshSession } from '../types/ssh';
import styles from './SessionPanel.module.css';

interface SessionPanelProps {
  sessions: SshSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onNew: () => void;
  onCollapse?: () => void;
}

export function SessionPanel({
  sessions,
  activeId,
  onSelect,
  onDisconnect,
  onNew,
  onCollapse,
}: SessionPanelProps) {
  return (
    <aside className={styles.panel}>
      <div className={styles.panelHeader}>
        <span>Sessions</span>
        {onCollapse && (
          <button className={styles.toggleBtn} onClick={onCollapse} title="Collapse panel">
            <ChevronLeft size={12} />
          </button>
        )}
      </div>

      <div className={styles.sessionList}>
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`${styles.sessionItem} ${session.id === activeId ? styles.active : ''}`}
            onClick={() => onSelect(session.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onDisconnect(session.id);
            }}
            title={session.label}
          >
            <span className={`${styles.statusDot} ${styles[session.status]}`} />
            <span className={styles.sessionLabel}>{session.label}</span>
            <button
              className={styles.disconnectBtn}
              onClick={(e) => {
                e.stopPropagation();
                onDisconnect(session.id);
              }}
              title="Disconnect"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <button className={styles.newBtn} onClick={onNew}>
          <Plus size={12} />
          New Connection
        </button>
      </div>
    </aside>
  );
}

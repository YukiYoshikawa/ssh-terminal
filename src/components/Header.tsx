import { Plus, Maximize2, Minimize2 } from 'lucide-react';
import { useState } from 'react';
import styles from './Header.module.css';

interface HeaderProps {
  activeLabel?: string;
  onNew: () => void;
  onToggleFullscreen?: () => void;
}

export function Header({ activeLabel, onNew, onToggleFullscreen }: HeaderProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
    onToggleFullscreen?.();
  };

  return (
    <header className={styles.header}>
      <div className={styles.title}>
        <span className={styles.titleIcon}>■</span>
        SSH Terminal
      </div>
      <div className={styles.activeLabel}>
        {activeLabel ?? ''}
      </div>
      <div className={styles.actions}>
        <button className={styles.newBtn} onClick={onNew} title="New Connection">
          <Plus size={14} />
          New
        </button>
        <button className={styles.iconBtn} onClick={handleFullscreen} title="Toggle Fullscreen">
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </header>
  );
}

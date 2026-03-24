import { useState, useRef, useCallback, useEffect } from 'react';
import type { SshSession, SshConnectionInfo } from './types/ssh';
import { SshWebSocket } from './core/websocket';
import { createSession, getWsUrl } from './core/sessionManager';
import { Header } from './components/Header';
import { SessionPanel } from './components/SessionPanel';
import { ConnectDialog } from './components/ConnectDialog';
import { SearchBar } from './components/SearchBar';
import { Terminal, type TerminalHandle } from './components/Terminal';
import styles from './App.module.css';

const MAX_SESSIONS = 10;

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <span>接続を開始するには [+ New] をクリックしてください</span>
      <span className={styles.emptyStateHint}>最大 {MAX_SESSIONS} セッション同時接続可能</span>
    </div>
  );
}

export default function App() {
  const [sessions, setSessions] = useState<SshSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [connectError, setConnectError] = useState<string | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);

  const [searchVisible, setSearchVisible] = useState(false);

  const terminalRefs = useRef(new Map<string, TerminalHandle>());
  const wsRefs = useRef(new Map<string, SshWebSocket>());

  // Ctrl+Shift+F opens search bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setSearchVisible((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const updateSession = useCallback((id: string, patch: Partial<SshSession>) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const handleConnect = useCallback(
    (info: SshConnectionInfo) => {
      if (sessions.length >= MAX_SESSIONS) {
        setConnectError(`最大 ${MAX_SESSIONS} セッションまでです`);
        return;
      }
      setConnecting(true);
      setConnectError(undefined);

      const session = createSession(info);

      const ws = new SshWebSocket(
        (msg) => {
          switch (msg.type) {
            case 'connected': {
              updateSession(session.id, { status: 'connected' });
              setConnecting(false);
              setShowConnectDialog(false);
              setConnectError(undefined);
              // Focus terminal after state update
              setTimeout(() => {
                terminalRefs.current.get(session.id)?.focus();
              }, 50);
              break;
            }
            case 'data': {
              // Server sends base64-encoded data
              const decoded = atob(msg.data);
              terminalRefs.current.get(session.id)?.write(decoded);
              break;
            }
            case 'error': {
              updateSession(session.id, { status: 'error', errorMessage: msg.message });
              if (connecting || showConnectDialog) {
                setConnectError(msg.message);
                setConnecting(false);
              }
              break;
            }
            case 'disconnected': {
              updateSession(session.id, { status: 'disconnected', errorMessage: msg.reason });
              break;
            }
          }
        },
        () => {
          // WebSocket closed
          updateSession(session.id, { status: 'disconnected' });
        }
      );

      ws.connect(getWsUrl());
      wsRefs.current.set(session.id, ws);

      // Add session and set as active
      setSessions((prev) => [...prev, session]);
      setActiveSessionId(session.id);

      // Send connect message once WebSocket opens — poll readyState briefly
      const sendConnect = () => {
        if (ws.isConnected) {
          ws.send({
            type: 'connect',
            host: info.host,
            port: info.port,
            username: info.username,
            password: info.password,
          });
        } else {
          setTimeout(sendConnect, 50);
        }
      };
      setTimeout(sendConnect, 50);
    },
    [sessions.length, connecting, showConnectDialog, updateSession]
  );

  const handleDisconnect = useCallback(
    (sessionId: string) => {
      const ws = wsRefs.current.get(sessionId);
      ws?.close();
      wsRefs.current.delete(sessionId);
      updateSession(sessionId, { status: 'disconnected' });
    },
    [updateSession]
  );

  const handleSessionSelect = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setTimeout(() => {
      terminalRefs.current.get(sessionId)?.focus();
    }, 50);
  }, []);

  const handleNewConnection = useCallback(() => {
    if (sessions.length >= MAX_SESSIONS) {
      alert(`最大 ${MAX_SESSIONS} セッションまでです`);
      return;
    }
    setConnectError(undefined);
    setConnecting(false);
    setShowConnectDialog(true);
  }, [sessions.length]);

  const handleReconnect = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
      // Remove old session and reconnect with same info
      handleDisconnect(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      terminalRefs.current.delete(sessionId);
      setActiveSessionId(null);
      // Open dialog pre-filled (simplest approach: open fresh dialog)
      setConnectError(undefined);
      setConnecting(false);
      setShowConnectDialog(true);
    },
    [sessions, handleDisconnect]
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className={styles.app}>
      <Header
        activeLabel={activeSession?.label}
        onNew={handleNewConnection}
        onToggleFullscreen={() => {}}
      />
      <div className={styles.main}>
        {leftPanelOpen && (
          <SessionPanel
            sessions={sessions}
            activeId={activeSessionId}
            onSelect={handleSessionSelect}
            onDisconnect={handleDisconnect}
            onNew={handleNewConnection}
            onCollapse={() => setLeftPanelOpen(false)}
          />
        )}
        <div className={styles.terminalArea}>
          <SearchBar
            visible={searchVisible}
            onClose={() => setSearchVisible(false)}
            getBuffer={() => {
              if (!activeSessionId) return '';
              return terminalRefs.current.get(activeSessionId)?.getBuffer() ?? '';
            }}
          />
          {sessions.map((s) => (
            <Terminal
              key={s.id}
              ref={(handle) => {
                if (handle) {
                  terminalRefs.current.set(s.id, handle);
                } else {
                  terminalRefs.current.delete(s.id);
                }
              }}
              visible={s.id === activeSessionId}
              isDisconnected={s.status === 'disconnected'}
              onReconnect={() => handleReconnect(s.id)}
              onData={(data) => {
                const ws = wsRefs.current.get(s.id);
                ws?.send({ type: 'data', data });
              }}
              onResize={(cols, rows) => {
                const ws = wsRefs.current.get(s.id);
                if (ws?.isConnected) {
                  ws.send({ type: 'resize', cols, rows });
                }
              }}
            />
          ))}
          {sessions.length === 0 && <EmptyState />}
        </div>
      </div>

      {showConnectDialog && (
        <ConnectDialog
          open={showConnectDialog}
          onConnect={handleConnect}
          onCancel={() => {
            setShowConnectDialog(false);
            setConnectError(undefined);
            setConnecting(false);
          }}
          error={connectError}
          connecting={connecting}
        />
      )}
    </div>
  );
}

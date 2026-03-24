import { useState, useRef, useCallback, useEffect } from 'react';
import type { SshSession, SshConnectionInfo, LayoutMode } from './types/ssh';
import { SshWebSocket } from './core/websocket';
import { createSession, getWsUrl } from './core/sessionManager';
import { Header } from './components/Header';
import { SessionPanel } from './components/SessionPanel';
import { ConnectDialog } from './components/ConnectDialog';
import { SearchBar } from './components/SearchBar';
import { Terminal, type TerminalHandle } from './components/Terminal';
import { saveToHistory } from './core/connectionHistory';
import styles from './App.module.css';
import gridStyles from './components/TerminalGrid.module.css';

const MAX_SESSIONS = 10;

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <span>接続を開始するには [+ New] をクリックしてください</span>
      <span className={styles.emptyStateHint}>最大 {MAX_SESSIONS} セッション同時接続可能</span>
    </div>
  );
}

function getGridColsClass(count: number): string {
  if (count <= 1) return gridStyles.cols1;
  if (count <= 4) return gridStyles.cols2;
  return gridStyles.cols3;
}

export default function App() {
  const [sessions, setSessions] = useState<SshSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [connectError, setConnectError] = useState<string | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('tab');

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

  const connectWithInfo = useCallback(
    async (info: SshConnectionInfo, labelOverride?: string) => {
      const session = createSession(info, labelOverride);

      const ws = new SshWebSocket(
        (msg) => {
          switch (msg.type) {
            case 'connected': {
              updateSession(session.id, { status: 'connected' });
              setTimeout(() => {
                terminalRefs.current.get(session.id)?.focus();
              }, 50);
              break;
            }
            case 'data': {
              const binary = atob(msg.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              const text = new TextDecoder('utf-8').decode(bytes);
              terminalRefs.current.get(session.id)?.write(text);
              break;
            }
            case 'error': {
              updateSession(session.id, { status: 'error', errorMessage: msg.message });
              break;
            }
            case 'disconnected': {
              updateSession(session.id, { status: 'disconnected', errorMessage: msg.reason });
              break;
            }
          }
        },
        () => {
          updateSession(session.id, { status: 'disconnected' });
        }
      );

      wsRefs.current.set(session.id, ws);
      setSessions((prev) => [...prev, session]);
      setActiveSessionId(session.id);

      try {
        await ws.connect(getWsUrl());
        ws.send({
          type: 'connect',
          host: info.host,
          port: info.port,
          username: info.username,
          password: info.password,
          profile: info.profile,
          command: info.command,
        });
      } catch {
        updateSession(session.id, { status: 'error', errorMessage: 'プロキシサーバーに接続できません' });
      }

      return session;
    },
    [updateSession]
  );

  const handleConnect = useCallback(
    async (info: SshConnectionInfo) => {
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
              saveToHistory(info);
              setTimeout(() => {
                terminalRefs.current.get(session.id)?.focus();
              }, 50);
              break;
            }
            case 'data': {
              const binary = atob(msg.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              const text = new TextDecoder('utf-8').decode(bytes);
              terminalRefs.current.get(session.id)?.write(text);
              break;
            }
            case 'error': {
              updateSession(session.id, { status: 'error', errorMessage: msg.message });
              setConnectError(msg.message);
              setConnecting(false);
              break;
            }
            case 'disconnected': {
              updateSession(session.id, { status: 'disconnected', errorMessage: msg.reason });
              break;
            }
          }
        },
        () => {
          updateSession(session.id, { status: 'disconnected' });
        }
      );

      wsRefs.current.set(session.id, ws);
      setSessions((prev) => [...prev, session]);
      setActiveSessionId(session.id);

      try {
        await ws.connect(getWsUrl());
        ws.send({
          type: 'connect',
          host: info.host,
          port: info.port,
          username: info.username,
          password: info.password,
          profile: info.profile,
          command: info.command,
        });
      } catch {
        updateSession(session.id, { status: 'error', errorMessage: 'プロキシサーバーに接続できません' });
        setConnecting(false);
        setConnectError('プロキシサーバーに接続できません。サーバーが起動しているか確認してください。');
      }
    },
    [sessions.length, updateSession]
  );

  // Connect using a profile (for URL auto-connect and programmatic use)
  const connectWithProfile = useCallback(
    async (host: string, profile: string, command?: string, labelOverride?: string) => {
      if (sessions.length >= MAX_SESSIONS) return;
      const info: SshConnectionInfo = {
        host,
        port: 22,
        profile,
        command,
      };
      await connectWithInfo(info, labelOverride);
    },
    [sessions.length, connectWithInfo]
  );

  // URL parameter auto-connect on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const host = params.get('host');
    const profile = params.get('profile');
    const targets = params.get('targets');

    if (host && profile) {
      // Connect to bastion host
      connectWithProfile(host, profile, undefined, `${profile}@${host}`);

      // Connect to each target via bastion
      if (targets) {
        const targetList = targets.split(',').map((t) => t.trim()).filter(Boolean);
        for (const target of targetList) {
          connectWithProfile(host, profile, `ssh ${target}\n`, target);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = useCallback(
    (sessionId: string) => {
      const ws = wsRefs.current.get(sessionId);
      ws?.close();
      wsRefs.current.delete(sessionId);
      updateSession(sessionId, { status: 'disconnected' });
    },
    [updateSession]
  );

  const handleRemoveSession = useCallback(
    (sessionId: string) => {
      const ws = wsRefs.current.get(sessionId);
      ws?.close();
      wsRefs.current.delete(sessionId);
      terminalRefs.current.delete(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setActiveSessionId((prev) => {
        if (prev === sessionId) {
          const remaining = sessions.filter((s) => s.id !== sessionId);
          return remaining.length > 0 ? remaining[0].id : null;
        }
        return prev;
      });
    },
    [sessions]
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
      handleDisconnect(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      terminalRefs.current.delete(sessionId);
      setActiveSessionId(null);
      setConnectError(undefined);
      setConnecting(false);
      setShowConnectDialog(true);
    },
    [sessions, handleDisconnect]
  );

  const handleToggleLayout = useCallback(() => {
    setLayoutMode((prev) => (prev === 'tab' ? 'grid' : 'tab'));
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isGridMode = layoutMode === 'grid' && sessions.length > 1;

  const terminalElements = sessions.map((s) => {
    const terminalNode = (
      <Terminal
        key={s.id}
        ref={(handle) => {
          if (handle) {
            terminalRefs.current.set(s.id, handle);
          } else {
            terminalRefs.current.delete(s.id);
          }
        }}
        visible={isGridMode || s.id === activeSessionId}
        isDisconnected={s.status === 'disconnected'}
        onReconnect={() => handleReconnect(s.id)}
        onData={(data) => {
          const ws = wsRefs.current.get(s.id);
          const encoded = btoa(
            Array.from(new TextEncoder().encode(data))
              .map((b) => String.fromCharCode(b))
              .join('')
          );
          ws?.send({ type: 'data', data: encoded });
        }}
        onResize={(cols, rows) => {
          const ws = wsRefs.current.get(s.id);
          if (ws?.isConnected) {
            ws.send({ type: 'resize', cols, rows });
          }
        }}
      />
    );

    if (isGridMode) {
      return (
        <div
          key={s.id}
          className={`${gridStyles.cell}${s.id === activeSessionId ? ` ${gridStyles.cellActive}` : ''}`}
          onClick={() => {
            setActiveSessionId(s.id);
            setLayoutMode('tab');
          }}
        >
          <div className={gridStyles.cellHeader}>
            <span className={`${gridStyles.statusDot} ${gridStyles[s.status]}`} />
            {s.label}
          </div>
          <div className={gridStyles.cellTerminal}>
            {terminalNode}
          </div>
        </div>
      );
    }

    return terminalNode;
  });

  return (
    <div className={styles.app}>
      <Header
        activeLabel={activeSession?.label}
        onNew={handleNewConnection}
        onToggleFullscreen={() => {}}
        layoutMode={layoutMode}
        onToggleLayout={handleToggleLayout}
        showLayoutToggle={sessions.length > 1}
      />
      <div className={styles.main}>
        {leftPanelOpen && (
          <SessionPanel
            sessions={sessions}
            activeId={activeSessionId}
            onSelect={handleSessionSelect}
            onDisconnect={handleRemoveSession}
            onNew={handleNewConnection}
            onCollapse={() => setLeftPanelOpen(false)}
          />
        )}
        {!leftPanelOpen && (
          <button
            className={styles.expandBtn}
            onClick={() => setLeftPanelOpen(true)}
            title="Sessions パネルを表示"
          >
            ▶
          </button>
        )}
        <div
          className={
            isGridMode
              ? `${gridStyles.grid} ${getGridColsClass(sessions.length)}`
              : styles.terminalArea
          }
        >
          {!isGridMode && (
            <SearchBar
              visible={searchVisible}
              onClose={() => setSearchVisible(false)}
              getBuffer={() => {
                if (!activeSessionId) return '';
                return terminalRefs.current.get(activeSessionId)?.getBuffer() ?? '';
              }}
            />
          )}
          {terminalElements}
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

import { forwardRef, useEffect, useRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import styles from './Terminal.module.css';

export interface TerminalHandle {
  write: (data: string) => void;
  focus: () => void;
  clear: () => void;
  getBuffer: () => string;
}

interface TerminalProps {
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  visible: boolean;
  isDisconnected?: boolean;
  onReconnect?: () => void;
}

const theme = {
  background: '#0a0a0f',
  foreground: '#e0e0e8',
  cursor: '#4a9eff',
  cursorAccent: '#0a0a0f',
  selectionBackground: '#4a9eff44',
  black: '#1a1b26',
  red: '#ff6b6b',
  green: '#4ecdc4',
  yellow: '#ffd93d',
  blue: '#4a9eff',
  magenta: '#c792ea',
  cyan: '#89ddff',
  white: '#e0e0e8',
  brightBlack: '#8888a0',
  brightRed: '#ff8a8a',
  brightGreen: '#6ee6dd',
  brightYellow: '#ffe566',
  brightBlue: '#5eadff',
  brightMagenta: '#d4a8f0',
  brightCyan: '#a6e8ff',
  brightWhite: '#ffffff',
};

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ onData, onResize, visible, isDisconnected, onReconnect }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const onDataRef = useRef(onData);
    const onResizeRef = useRef(onResize);

    // Keep callbacks current without recreating the terminal
    useEffect(() => { onDataRef.current = onData; }, [onData]);
    useEffect(() => { onResizeRef.current = onResize; }, [onResize]);

    useImperativeHandle(ref, () => ({
      write: (data: string) => {
        xtermRef.current?.write(data);
      },
      focus: () => {
        xtermRef.current?.focus();
      },
      clear: () => {
        xtermRef.current?.clear();
      },
      getBuffer: () => {
        const xterm = xtermRef.current;
        if (!xterm) return '';
        const buffer = xterm.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < buffer.length; i++) {
          lines.push(buffer.getLine(i)?.translateToString() ?? '');
        }
        return lines.join('\n');
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const xterm = new XTerm({
        theme,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 5000,
        allowTransparency: false,
      });

      const fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);

      // Try WebGL addon, fall back to canvas
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
        });
        xterm.loadAddon(webglAddon);
      } catch {
        // WebGL unavailable, canvas renderer is used automatically
      }

      xterm.open(containerRef.current);
      fitAddon.fit();

      xterm.onData((data) => {
        onDataRef.current(data);
      });

      xterm.onResize(({ cols, rows }) => {
        onResizeRef.current(cols, rows);
      });

      xtermRef.current = xterm;
      fitAddonRef.current = fitAddon;

      // ResizeObserver to auto-fit when container size changes
      const observer = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore fit errors during unmount
        }
      });
      observer.observe(containerRef.current);

      return () => {
        observer.disconnect();
        xterm.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
      };
    }, []);

    // Re-fit when visibility changes (container becomes visible)
    useEffect(() => {
      if (visible) {
        requestAnimationFrame(() => {
          try {
            fitAddonRef.current?.fit();
          } catch {
            // ignore
          }
          xtermRef.current?.focus();
        });
      }
    }, [visible]);

    return (
      <div className={`${styles.container} ${visible ? '' : styles.hidden}`}>
        <div ref={containerRef} className={styles.xtermWrapper} />
        {isDisconnected && visible && (
          <div className={styles.disconnectOverlay}>
            <span className={styles.disconnectMessage}>接続が切断されました</span>
            {onReconnect && (
              <button className={styles.reconnectBtn} onClick={onReconnect}>
                再接続
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);

Terminal.displayName = 'Terminal';

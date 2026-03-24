import type { SshConnectionInfo } from '../types/ssh';

const STORAGE_KEY = 'ssh-terminal-connections';
const MAX_HISTORY = 20;

export interface SavedConnection {
  host: string;
  port: number;
  username: string;
  label: string;
  lastUsed: number;
}

function toSaved(info: SshConnectionInfo): SavedConnection {
  return {
    host: info.host,
    port: info.port,
    username: info.username,
    label: `${info.username}@${info.host}:${info.port}`,
    lastUsed: Date.now(),
  };
}

function key(c: SavedConnection): string {
  return `${c.username}@${c.host}:${c.port}`;
}

export function loadHistory(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedConnection[];
  } catch {
    return [];
  }
}

export function saveToHistory(info: SshConnectionInfo): void {
  const saved = toSaved(info);
  let history = loadHistory();
  // Remove duplicate
  history = history.filter((c) => key(c) !== key(saved));
  // Add to front
  history.unshift(saved);
  // Trim
  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function removeFromHistory(connection: SavedConnection): void {
  let history = loadHistory();
  history = history.filter((c) => key(c) !== key(connection));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

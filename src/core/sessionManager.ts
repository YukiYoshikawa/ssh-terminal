import type { SshSession, SshConnectionInfo } from '../types/ssh';

let nextId = 1;

export function createSession(info: SshConnectionInfo): SshSession {
  return {
    id: `session-${nextId++}`,
    label: `${info.username}@${info.host}`,
    connectionInfo: info,
    status: 'connecting',
  };
}

export function getWsUrl(): string {
  // In development, connect directly to the proxy server
  // In production, use the same host (reverse proxy expected)
  if (import.meta.env.DEV) {
    return 'ws://localhost:3001/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

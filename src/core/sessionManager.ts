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
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export interface SshConnectionInfo {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface SshSession {
  id: string;
  label: string;
  connectionInfo: SshConnectionInfo;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

export type ClientMessage =
  | { type: 'connect'; host: string; port: number; username: string; password: string }
  | { type: 'data'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'disconnect' };

export type ServerMessage =
  | { type: 'connected' }
  | { type: 'data'; data: string }
  | { type: 'error'; message: string }
  | { type: 'disconnected'; reason: string };

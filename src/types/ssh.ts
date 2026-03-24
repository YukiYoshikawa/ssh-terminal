export interface SshConnectionInfo {
  host: string;
  port: number;
  username?: string;   // optional when using profile/auth
  password?: string;   // optional when using profile/auth
  profile?: string;    // profile name from server config
  category?: string;   // auth lookup: category
  group?: string;      // auth lookup: group (optional, falls back to _default)
  command?: string;    // auto-execute command after connect (for jump host)
}

export interface SshSession {
  id: string;
  label: string;
  connectionInfo: SshConnectionInfo;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

// Client → Server messages
export type ClientMessage =
  | { type: 'connect'; host: string; port?: number; username?: string; password?: string; profile?: string; category?: string; group?: string; command?: string; cols?: number; rows?: number }
  | { type: 'data'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'disconnect' };

// Server → Client messages
export type ServerMessage =
  | { type: 'connected'; session_id?: string }
  | { type: 'data'; data: string }
  | { type: 'error'; message: string }
  | { type: 'disconnected'; reason?: string };

export type LayoutMode = 'grid' | 'tab';

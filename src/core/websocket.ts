import type { ClientMessage, ServerMessage } from '../types/ssh';

export class SshWebSocket {
  private ws: WebSocket | null = null;
  private onMessage: (msg: ServerMessage) => void;
  private onClose: () => void;

  constructor(onMessage: (msg: ServerMessage) => void, onClose: () => void) {
    this.onMessage = onMessage;
    this.onClose = onClose;
  }

  connect(wsUrl: string): void {
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        this.onMessage(msg);
      } catch (e) {
        console.error('Invalid server message:', e);
      }
    };
    this.ws.onclose = () => { this.ws = null; this.onClose(); };
    this.ws.onerror = () => {
      this.onMessage({ type: 'error', message: 'WebSocket connection failed' });
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    if (this.ws) {
      this.send({ type: 'disconnect' });
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

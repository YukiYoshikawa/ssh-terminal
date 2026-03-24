import type { ClientMessage, ServerMessage } from '../types/ssh';

export class SshWebSocket {
  private ws: WebSocket | null = null;
  private onMessage: (msg: ServerMessage) => void;
  private onClose: () => void;

  constructor(onMessage: (msg: ServerMessage) => void, onClose: () => void) {
    this.onMessage = onMessage;
    this.onClose = onClose;
  }

  connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => resolve();
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
        reject(new Error('WebSocket connection failed'));
        this.onMessage({ type: 'error', message: 'WebSocket connection failed. プロキシサーバーが起動しているか確認してください。' });
      };
    });
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

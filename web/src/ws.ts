import type { ClientMsgT, ServerMsg } from '@ccui/shared';
import { getToken } from './api';

interface Handlers { onMsg(m: ServerMsg): void; onStatus(up: boolean): void; onReady(): void }

export function createSocket(h: Handlers) {
  let ws: WebSocket | null = null;
  let delay = 500;
  let closed = false;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => ws!.send(JSON.stringify({ type: 'auth', token: getToken() }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as ServerMsg;
      if (m.type === 'ready') { delay = 500; h.onStatus(true); h.onReady(); } else h.onMsg(m);
    };
    ws.onclose = () => {
      h.onStatus(false);
      if (!closed) setTimeout(open, (delay = Math.min(delay * 2, 5000)));
    };
  };
  open();
  return {
    send: (m: ClientMsgT) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    close() { closed = true; ws?.close(); },
  };
}

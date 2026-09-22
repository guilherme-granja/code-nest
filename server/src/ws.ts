import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { ClientMsg, type ConnStatus, type ServerMsg } from '@ccui/shared';
import { blockedSlash } from './commands';
import { ensureMeta, touch } from './domain';
import type { Client, SessionHub } from './hub';
import { hostOriginOk, tokenOk } from './security';
import type { Store } from './store';

const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };

export function attachWs(server: Server, o: { port: number; token: string; hub: SessionHub; store: Store; statuses: () => Record<string, ConnStatus> }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
  const authed = new Set<Client>();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url !== '/ws' || !hostOriginOk(o.port, req.headers.host, req.headers.origin)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    let ok = false;
    let alive = true;
    const client: Client = { sessions: new Set(), send: (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); } };
    const authTimer = setTimeout(() => { if (!ok) ws.close(4401, 'auth'); }, 5000);
    // ponytail: 1 ciclo sem pong derruba; se houver falso positivo em redes lentas, tolerar 2 ciclos
    const hb = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 30_000);
    ws.on('pong', () => { alive = true; });

    ws.on('message', async (raw) => {
      const parsed = ClientMsg.safeParse(safeJson(raw.toString()));
      if (!parsed.success) return client.send({ type: 'error', code: 'bad_request', message: 'mensagem inválida' });
      const m = parsed.data;
      if (m.type === 'auth') {
        if (tokenOk(m.token, o.token)) {
          ok = true; clearTimeout(authTimer); authed.add(client);
          client.send({ type: 'ready' });
          for (const [id, status] of Object.entries(o.statuses())) if (id !== 'local') client.send({ type: 'connection.status', id, status });
        } else ws.close(4401, 'auth');
        return;
      }
      if (!ok) return ws.close(4401, 'auth');
      try {
        switch (m.type) {
          case 'attach':
            await ensureMeta(o.store, m.sessionId, m.projectId);
            await o.hub.attach(client, m.sessionId, m.afterSeq);
            break;
          case 'detach': o.hub.detach(client, m.sessionId); break;
          case 'send': {
            const why = blockedSlash(m.text);
            if (why) { client.send({ type: 'error', code: 'blocked', message: why }); break; }
            touch(o.store, m.sessionId);
            if ((await o.hub.send(m.sessionId, m.text)) === 'busy') client.send({ type: 'error', code: 'busy', message: 'sessão ocupada' });
            break;
          }
          case 'interrupt': await o.hub.interrupt(m.sessionId); break;
          case 'shell':
            touch(o.store, m.sessionId);
            if ((await o.hub.shell(m.sessionId, m.command)) === 'busy') client.send({ type: 'error', code: 'busy', message: 'já há um comando shell em execução nesta sessão' });
            break;
          case 'permission': o.hub.answerPermission(m.sessionId, m.reqId, m.allow, m.updatedInput); break;
        }
      } catch (e) {
        client.send({ type: 'error', code: 'runtime', message: (e as Error).message });
      }
    });

    ws.on('close', () => { clearInterval(hb); clearTimeout(authTimer); authed.delete(client); o.hub.drop(client); });
  });

  return { broadcast: (m: ServerMsg) => { for (const c of authed) c.send(m); } };
}

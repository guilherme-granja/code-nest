// Smoke ponta a ponta do backend: REST + WS + reattach com replay. Requer o backend rodando com CCUI_TOKEN=t.
import WebSocket from 'ws';

const base = 'http://127.0.0.1:4317';
const H = { Authorization: 'Bearer t', 'Content-Type': 'application/json' };
const j = async (m: string, u: string, b?: unknown): Promise<any> => {
  const r = await fetch(base + u, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  return r.status === 204 ? null : r.json();
};
const conn = process.env.CONN_ID;
const p = await j('POST', '/api/projects', { name: 'smoke', path: process.env.PROJ_PATH ?? '/tmp', lean: true, ...(conn ? { connectionId: conn } : {}) });
const s = await j('POST', `/api/projects/${p.id}/sessions`, { name: 'smoke', model: 'haiku', effort: 'low' });
const connect = (onMsg: (m: any) => void) => {
  const ws = new WebSocket('ws://127.0.0.1:4317/ws', { headers: { Origin: base } });
  ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 't' })));
  ws.on('message', (d) => onMsg(JSON.parse(String(d))));
  return ws;
};
const out = (tag: string, m: unknown) => console.log(tag, JSON.stringify(m).slice(0, 170));
const a = connect((m) => {
  out('A', m);
  if (m.type === 'ready') a.send(JSON.stringify({ type: 'attach', sessionId: s.sessionId, projectId: p.id }));
  if (m.type === 'snapshot') a.send(JSON.stringify({ type: 'send', sessionId: s.sessionId, text: 'diga apenas: um' }));
  if (m.type === 'event' && m.event.type === 'turn.completed') {
    a.close();
    const b = connect((m2) => {
      out('B', m2);
      if (m2.type === 'ready') b.send(JSON.stringify({ type: 'attach', sessionId: s.sessionId, projectId: p.id, afterSeq: 0 }));
    });
    setTimeout(async () => { b.close(); await j('DELETE', `/api/projects/${p.id}`); process.exit(0); }, 2000);
  }
});

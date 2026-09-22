import { useState } from 'react';
import { api } from '../../api';

export function ServerForm({ onDone }: { onDone: (connectionId: string) => void }) {
  const [target, setTarget] = useState('');
  const [claudePath, setClaudePath] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = 'w-full rounded bg-zinc-900 px-2 py-1.5 text-sm';
  const body = () => ({ target: target.trim(), ...(claudePath.trim() ? { claudePath: claudePath.trim() } : {}) });

  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.testConnection(body());
      if (!r.ok) setMsg({ kind: 'err', text: r.error ?? 'falhou' });
      else setMsg(r.warning ? { kind: 'warn', text: `claude ${r.version}: ${r.warning}` } : { kind: 'ok', text: `Conectado. claude ${r.version}` });
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
    setBusy(false);
  };
  const connect = async () => {
    setBusy(true); setMsg(null);
    try { onDone((await api.addConnection(body())).connection.id); } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <input className={input} placeholder="usuario@192.168.1.12" value={target} onChange={(e) => setTarget(e.target.value)} />
      {advanced
        ? <input className={input} placeholder="Caminho do claude no servidor (padrão: $HOME/.local/bin/claude)" value={claudePath} onChange={(e) => setClaudePath(e.target.value)} />
        : <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setAdvanced(true)}>avançado…</button>}
      {msg && <div className={`text-xs ${msg.kind === 'ok' ? 'text-green-400' : msg.kind === 'warn' ? 'text-amber-400' : 'text-red-400'}`}>{msg.text}</div>}
      <div className="flex gap-2">
        <button className="rounded border border-zinc-600 px-3 py-1 text-sm hover:bg-zinc-800 disabled:opacity-40" disabled={busy || !target.trim()} onClick={test}>Testar</button>
        <button className="rounded bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-900 disabled:opacity-40" disabled={busy || !target.trim()} onClick={connect}>Conectar</button>
      </div>
    </div>
  );
}

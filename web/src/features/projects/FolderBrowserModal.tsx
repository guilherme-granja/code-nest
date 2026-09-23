import { useEffect, useState } from 'react';
import type { DirEntry } from '@ccui/shared';
import { api } from '../../api';

// Navega o filesystem da conexão (local ou SSH) pra escolher uma pasta sem digitar o caminho.
// path === null enquanto não carregou a 1ª vez (home da conexão); depois disso é sempre o caminho absoluto atual.
export function FolderBrowserModal({ connectionId, onPick, onClose }: { connectionId: string; onPick: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [jump, setJump] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = (p: string | null) => {
    setLoading(true);
    api.browse(connectionId, p, 'dir')
      .then((r) => { setPath(r.path); setEntries(r.entries); setErr(''); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(null); }, [connectionId]);

  const visible = entries.filter((e) => showHidden || !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
  const up = () => { if (path && path !== '/') load(path.slice(0, path.lastIndexOf('/')) || '/'); };
  const crumbs = (path ?? '/').split('/').filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-zinc-800/80 p-4">
          <h2 className="mb-2 text-sm font-semibold text-zinc-100">Escolher pasta</h2>
          <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-400">
            <button className="hover:text-zinc-200" onClick={() => load('/')}>/</button>
            {crumbs.map((seg, i) => {
              const target = '/' + crumbs.slice(0, i + 1).join('/');
              return (
                <span key={target} className="flex items-center gap-1">
                  <span className="text-zinc-700">/</span>
                  <button className="hover:text-zinc-200" onClick={() => load(target)}>{seg}</button>
                </span>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && <div className="p-3 text-xs text-zinc-600">Carregando…</div>}
          {err && <div className="p-3 text-xs text-rose-400">{err}</div>}
          {!loading && !err && (
            <ul className="space-y-0.5">
              {path !== '/' && (
                <li><button className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/60" onClick={up}>..</button></li>
              )}
              {visible.length === 0 && <li className="px-2.5 py-1.5 text-xs text-zinc-600">Pasta vazia</li>}
              {visible.map((e) => (
                <li key={e.name}>
                  <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800/60" onClick={() => load(`${path === '/' ? '' : path}/${e.name}`)}>
                    <span className="text-zinc-500">▸</span>{e.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t border-zinc-800/80 p-3">
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700"
              placeholder="ir para um caminho…"
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && jump.trim()) load(jump.trim()); }}
            />
            <button className="rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800" onClick={() => jump.trim() && load(jump.trim())}>Ir</button>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            <input type="checkbox" className="h-3.5 w-3.5 rounded-sm border border-zinc-700 bg-zinc-900 accent-zinc-100" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> mostrar ocultos
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200" onClick={onClose}>Cancelar</button>
            <button className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-40" disabled={!path} onClick={() => path && onPick(path)}>Selecionar esta pasta</button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { matchRow, norm } from '../../lib/search';
import { useApp } from '../../store';
import { cycleTheme } from '../../theme';

interface Entry { key: string; label: string; hint: string; run: () => void }

// Ctrl+K: busca sessões por nome/#tag em todos os projetos e executa ações
export function Palette() {
  const { projects, rows, ui, open, setUi, toggleSidebar } = useApp();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const close = () => setUi({ palette: false });

  const items = useMemo<Entry[]>(() => {
    const actions: Entry[] = [
      { key: 'a-new', label: 'Nova sessão', hint: 'Alt+N', run: () => setUi({ newSession: true, newFor: null }) },
      { key: 'a-side', label: 'Alternar barra lateral', hint: 'Alt+L', run: toggleSidebar },
      { key: 'a-term', label: 'Alternar painel de comandos', hint: 'Ctrl+J', run: () => setUi({ term: !ui.term }) },
      { key: 'a-theme', label: 'Alternar tema', hint: '', run: cycleTheme },
      { key: 'a-help', label: 'Ver atalhos', hint: '?', run: () => setUi({ help: true }) },
    ].filter((a) => norm(a.label).includes(norm(q)));
    const sessions = projects
      .flatMap((p) => (rows[p.id] ?? []).filter((r) => !r.archived && matchRow(r, q)).map((r) => ({ p, r })))
      .sort((a, b) => b.r.lastModified - a.r.lastModified)
      .slice(0, 50)
      .map(({ p, r }): Entry => ({ key: r.sessionId, label: r.name, hint: p.name, run: () => open(p.id, r.sessionId) }));
    return [...actions, ...sessions];
  }, [q, projects, rows, ui.term, open, setUi, toggleSidebar]);

  const run = (e?: Entry) => { if (e) { close(); e.run(); } };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24" onClick={close}>
      <div className="w-[36rem] max-w-[90vw] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="w-full border-b border-zinc-800 bg-transparent px-4 py-3 outline-none"
          placeholder="Buscar sessão, #tag ou ação…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(v + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); }
            else if (e.key === 'Enter') run(items[i]);
          }}
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 && <li className="px-4 py-2 text-sm text-zinc-500">Nada encontrado</li>}
          {items.map((it, n) => (
            <li key={it.key}>
              <button className={`flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm ${n === i ? 'bg-zinc-800' : ''}`} onMouseEnter={() => setI(n)} onClick={() => run(it)}>
                <span className="flex-1 truncate">{it.label}</span>
                <span className="shrink-0 text-xs text-zinc-500">{it.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

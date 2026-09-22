import { useApp } from '../../store';

// Sessões abertas nesta janela. Fechar a aba só para de acompanhar; o Claude segue rodando no backend.
export function Tabs() {
  const { tabs, active, rows, open, closeTab } = useApp();
  const chats = useApp((s) => s.chats);
  const attention = useApp((s) => s.attention);
  if (tabs.length === 0) return null;
  return (
    <div className="flex shrink-0 overflow-x-auto border-b border-zinc-800 text-sm">
      {tabs.map((t) => {
        const name = rows[t.projectId]?.find((r) => r.sessionId === t.sessionId)?.name ?? 'Sessão';
        const state = chats[t.sessionId]?.state;
        const color = state === 'awaiting_permission' ? 'bg-amber-500 animate-pulse' : state === 'running' ? 'bg-blue-500 animate-pulse' : attention[t.sessionId] ? 'bg-green-500' : 'bg-zinc-600';
        return (
          <div
            key={t.sessionId}
            role="tab"
            onClick={() => open(t.projectId, t.sessionId)}
            onAuxClick={(e) => { if (e.button === 1) closeTab(t.sessionId); }}
            className={`group flex max-w-56 shrink-0 cursor-pointer items-center gap-2 border-r border-zinc-800 px-3 py-1.5 transition-colors duration-150 ${
              active?.sessionId === t.sessionId ? 'border-b-2 border-b-zinc-100 bg-zinc-900 text-zinc-100' : 'border-b-2 border-b-transparent text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
            <span className="truncate">{name}</span>
            <button className="text-zinc-600 opacity-0 transition-opacity duration-150 hover:text-zinc-100 group-hover:opacity-100" title="Fechar aba (a sessão continua rodando)" onClick={(e) => { e.stopPropagation(); closeTab(t.sessionId); }}>×</button>
          </div>
        );
      })}
    </div>
  );
}

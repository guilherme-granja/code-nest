import { useState, useSyncExternalStore } from 'react';
import type { SessionRow } from '@ccui/shared';
import { api } from '../../api';
import { matchRow } from '../../lib/search';
import { useApp } from '../../store';
import { cycleTheme, getTheme, subscribeTheme, themeLabel } from '../../theme';
import { ServerForm } from '../connect/ServerForm';

const ago = (t: number) => {
  const s = (t - Date.now()) / 1000, a = Math.abs(s);
  const f = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  return a < 3600 ? f.format(Math.round(s / 60), 'minute') : a < 86400 ? f.format(Math.round(s / 3600), 'hour') : f.format(Math.round(s / 86400), 'day');
};
const dot = { up: 'bg-green-500', reconnecting: 'bg-amber-500', down: 'bg-red-500' } as const;

const Chevron = ({ open }: { open: boolean }) => <span className="w-3 shrink-0 text-[10px] text-zinc-500 transition-transform duration-150">{open ? '▾' : '▸'}</span>;

// resumo do que acontece dentro de um item recolhido: azul = rodando/aguardando permissão; verde = terminou fora de foco
function Pulse({ busy, attn }: { busy: boolean; attn: boolean }) {
  if (busy) return <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-blue-500" title="Há sessão em andamento" />;
  if (attn) return <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" title="Há sessão que terminou ou precisa de atenção" />;
  return null;
}

function SessionItem({ r, projectId, projectName, onTag }: { r: SessionRow; projectId: string; projectName?: string; onTag: (t: string) => void }) {
  const { active, open, patchSession } = useApp();
  const state = useApp((s) => s.chats[r.sessionId]?.state);
  const attention = useApp((s) => !!s.attention[r.sessionId]);
  const color = state === 'awaiting_permission' ? 'bg-amber-500 animate-pulse' : state === 'running' ? 'bg-blue-500 animate-pulse' : attention || r.live ? 'bg-green-500' : 'bg-zinc-600';
  const act = 'rounded px-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100';

  const selected = active?.sessionId === r.sessionId;
  return (
    <li className="group relative pl-3">
      {/* conector horizontal: liga a linha vertical do <ul> pai até o item */}
      <span className="pointer-events-none absolute left-0 top-1/2 h-px w-2.5 -translate-y-1/2 bg-zinc-800" aria-hidden />
      <button
        onClick={() => open(projectId, r.sessionId)}
        className={`flex w-full items-center gap-2 rounded-sm py-1 pl-2 pr-2 text-left text-[13px] transition-colors duration-150 ${
          selected ? 'bg-zinc-800/60 text-zinc-100 shadow-[inset_2px_0_0_0] shadow-zinc-400' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
        }`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
        <span className={`flex-1 truncate ${attention ? 'font-semibold' : ''} ${r.archived ? 'text-zinc-500' : ''}`}>{r.name}</span>
        {projectName && <span className="shrink-0 text-[10px] text-zinc-600">{projectName}</span>}
        <span className="shrink-0 text-[11px] text-zinc-600 group-hover:invisible">{ago(r.lastModified)}</span>
      </button>
      <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded bg-zinc-900 text-xs group-hover:flex">
        <button className={act} title="Renomear" onClick={async () => { const n = prompt('Novo nome da sessão', r.name); if (n?.trim()) await patchSession(r.sessionId, projectId, { name: n.trim() }); }}>✎</button>
        <button className={act} title="Tags (separadas por vírgula)" onClick={async () => {
          const v = prompt('Tags separadas por vírgula (letras, números, - e _)', r.tags.join(', '));
          if (v !== null) await patchSession(r.sessionId, projectId, { tags: v.split(',').map((t) => t.trim()).filter(Boolean) }).catch((e) => alert((e as Error).message));
        }}>#</button>
        <button className={act} title={r.favorite ? 'Remover dos favoritos' : 'Favoritar'} onClick={() => patchSession(r.sessionId, projectId, { favorite: !r.favorite })}>{r.favorite ? '★' : '☆'}</button>
        <button className={act} title={r.archived ? 'Desarquivar' : 'Arquivar'} onClick={() => patchSession(r.sessionId, projectId, { archived: !r.archived })}>{r.archived ? '↩' : '▣'}</button>
      </div>
      {r.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pb-1 pl-6">
          {r.tags.map((t) => <button key={t} className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400 hover:text-zinc-100" onClick={() => onTag(t)}>#{t}</button>)}
        </div>
      )}
    </li>
  );
}

export function Sidebar() {
  const { config, projects, rows, status, notifyOn, layout, reloadProjects, setUi, toggleNotify, toggleSidebar, toggleCollapsed } = useApp();
  const chats = useApp((s) => s.chats);
  const attention = useApp((s) => s.attention);
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingServer, setAddingServer] = useState(false);
  const [form, setForm] = useState({ name: '', path: '', lean: false, connectionId: 'local' });
  const [err, setErr] = useState('');
  const connections = config?.connections ?? [];
  const searching = query.trim() !== '';

  // durante a busca, os resultados aparecem mesmo dentro de itens recolhidos
  const isOpen = (key: string) => searching || !layout.collapsed[key];
  const visible = (pid: string) => (rows[pid] ?? []).filter((r) => (showArchived || !r.archived) && matchRow(r, query));
  const pulse = (pids: string[]) => {
    const all = pids.flatMap((pid) => rows[pid] ?? []);
    return {
      busy: all.some((r) => chats[r.sessionId]?.state === 'running' || chats[r.sessionId]?.state === 'awaiting_permission'),
      attn: all.some((r) => attention[r.sessionId]),
    };
  };
  const favorites = projects.flatMap((p) => visible(p.id).filter((r) => r.favorite && !r.archived).map((r) => ({ r, p })));

  const addProject = async () => {
    try {
      await api.addProject(form);
      setForm({ ...form, name: '', path: '' });
      setAdding(false);
      setErr('');
      await reloadProjects();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-zinc-800">
      <div className="space-y-1 border-b border-zinc-800 p-3">
        <div className="flex gap-1">
          <input className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1.5 text-sm outline-none" placeholder="Buscar sessões ou #tag…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="rounded px-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" title="Ocultar barra lateral (Alt+L)" onClick={toggleSidebar}>«</button>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <button className="hover:text-zinc-300" onClick={cycleTheme}>{themeLabel[theme]}</button>
          <button className="hover:text-zinc-300" title="Avisa quando uma sessão em segundo plano termina ou pede permissão" onClick={() => void toggleNotify()}>Notificações: {notifyOn ? 'on' : 'off'}</button>
          <button className="ml-auto hover:text-zinc-300" title="Atalhos (?)" onClick={() => setUi({ help: true })}>?</button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {favorites.length > 0 && (
          <section className="space-y-1">
            <button className="flex w-full items-center gap-1.5 text-left text-xs font-semibold tracking-wide text-zinc-500 hover:text-zinc-300" onClick={() => toggleCollapsed('f')}>
              <Chevron open={isOpen('f')} /> FAVORITAS <span className="font-normal text-zinc-600">{favorites.length}</span>
            </button>
            {isOpen('f') && (
              <ul className="space-y-0.5">
                {favorites.map(({ r, p }) => <SessionItem key={r.sessionId} r={r} projectId={p.id} projectName={p.name} onTag={(t) => setQuery(`#${t}`)} />)}
              </ul>
            )}
          </section>
        )}

        {connections.map((c) => {
          const cps = projects.filter((p) => p.connectionId === c.id);
          const total = cps.reduce((n, p) => n + visible(p.id).length, 0);
          if (searching && total === 0) return null;
          const ck = `c:${c.id}`;
          const open = isOpen(ck);
          const cp = pulse(cps.map((p) => p.id));
          return (
            <section key={c.id} className="space-y-1.5">
              <div className="group/c flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors duration-150 hover:text-zinc-300" onClick={() => toggleCollapsed(ck)} title={open ? 'Recolher' : 'Expandir'}>
                  <Chevron open={open} />
                  {c.kind === 'ssh' && <span className={`h-2 w-2 shrink-0 rounded-full ${dot[status[c.id] ?? 'reconnecting']}`} title={status[c.id] ?? 'reconnecting'} />}
                  <span className="truncate">{c.kind === 'local' ? 'LOCAL' : c.label.toUpperCase()}</span>
                  <span className="ml-auto font-normal normal-case tracking-normal text-zinc-600">{total}</span>
                  {!open && <Pulse {...cp} />}
                </button>
                {c.kind === 'ssh' && (
                  <button className="hidden text-zinc-600 hover:text-red-400 group-hover/c:block" title="Remover servidor (não apaga nada no servidor)"
                    onClick={async () => { if (confirm(`Remover o servidor "${c.label}" e seus projetos da lista?`)) { await api.delConnection(c.id); await reloadProjects(); } }}>✕</button>
                )}
              </div>

              {open && (
                <div className="ml-1.5 space-y-1.5 border-l border-zinc-800/70 pl-2">
                  {cps.map((p) => {
                    const list = visible(p.id);
                    if (searching && list.length === 0) return null;
                    const pk = `p:${p.id}`;
                    const pOpen = isOpen(pk);
                    const pp = pulse([p.id]);
                    return (
                      <div key={p.id} className="group/p">
                        <div className="flex items-center gap-1">
                          <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold text-zinc-200 transition-colors duration-150 hover:text-zinc-50" onClick={() => toggleCollapsed(pk)} title={`${p.path}\n${pOpen ? 'Recolher' : 'Expandir'}`}>
                            <Chevron open={pOpen} />
                            <span className="truncate">{p.name}</span>
                            <span className="ml-auto text-xs font-normal text-zinc-600">{list.length}</span>
                            {!pOpen && <Pulse {...pp} />}
                          </button>
                          <button
                            className={p.lean ? 'rounded bg-zinc-700 px-1.5 text-[10px] text-zinc-200' : 'hidden rounded border border-zinc-700 px-1.5 text-[10px] text-zinc-500 group-hover/p:block'}
                            title={`lean ${p.lean ? 'ligado' : 'desligado'}: ignora hooks/plugins/skills/MCP/CLAUDE.md do usuário (~80% mais barato ao iniciar). Clique para alternar.`}
                            onClick={async () => { await api.patchProject(p.id, { lean: !p.lean }); await reloadProjects(); }}
                          >lean</button>
                          <button
                            className={p.routing ? 'rounded bg-emerald-700 px-1.5 text-[10px] text-zinc-100' : 'hidden rounded border border-zinc-700 px-1.5 text-[10px] text-zinc-500 group-hover/p:block'}
                            title={`roteamento de modelo ${p.routing ? 'ligado' : 'desligado'}: escolhe Haiku ou Sonnet por mensagem pra economizar tokens. Clique para alternar.`}
                            onClick={async () => { await api.patchProject(p.id, { routing: !p.routing }); await reloadProjects(); }}
                          >rota</button>
                          <button
                            className={p.bypass ? 'rounded bg-red-800 px-1.5 text-[10px] text-zinc-100' : 'hidden rounded border border-zinc-700 px-1.5 text-[10px] text-zinc-500 group-hover/p:block'}
                            title={`bypass de permissões ${p.bypass ? 'ligado' : 'desligado'}: Claude Code roda Bash/edições sem pedir aprovação neste projeto. Use com cuidado. Clique para alternar.`}
                            onClick={async () => { if (p.bypass || confirm(`Ligar bypass de permissões em "${p.name}"? Claude Code vai poder rodar comandos e editar arquivos sem pedir aprovação.`)) { await api.patchProject(p.id, { bypass: !p.bypass }); await reloadProjects(); } }}
                          >bypass</button>
                          <button className="hidden rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 group-hover/p:block" title="Nova sessão neste projeto" onClick={() => setUi({ newSession: true, newFor: p.id })}>+</button>
                          <button className="hidden px-1 text-zinc-600 hover:text-red-400 group-hover/p:block" title="Remover projeto (não apaga sessões do Claude)"
                            onClick={async () => { if (confirm(`Remover "${p.name}" da lista?`)) { await api.delProject(p.id); await reloadProjects(); } }}>✕</button>
                        </div>
                        {pOpen && (
                          <ul className="mt-1 space-y-0.5 border-l border-zinc-800/50 pl-1">
                            {list.length === 0 && <li className="px-2 py-1 text-xs text-zinc-600">Nenhuma sessão</li>}
                            {list.map((r) => <SessionItem key={r.sessionId} r={r} projectId={p.id} onTag={(t) => setQuery(`#${t}`)} />)}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> mostrar arquivadas
        </label>

        {adding ? (
          <div className="space-y-2 rounded border border-zinc-800 p-2 text-sm">
            <select className="w-full rounded bg-zinc-900 px-2 py-1" value={form.connectionId} onChange={(e) => setForm({ ...form, connectionId: e.target.value })}>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <input className="w-full rounded bg-zinc-900 px-2 py-1" placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="w-full rounded bg-zinc-900 px-2 py-1" placeholder="/caminho/absoluto (no servidor escolhido)" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
            <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={form.lean} onChange={(e) => setForm({ ...form, lean: e.target.checked })} /> lean</label>
            {err && <div className="text-xs text-red-400">{err}</div>}
            <div className="flex gap-2">
              <button className="rounded bg-zinc-100 px-2 py-1 text-zinc-900" onClick={addProject}>Adicionar</button>
              <button className="px-2 py-1 text-zinc-400" onClick={() => { setAdding(false); setErr(''); }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="block text-sm text-zinc-400 hover:text-zinc-200" onClick={() => setAdding(true)}>+ Novo projeto</button>
        )}

        {addingServer ? (
          <div className="rounded border border-zinc-800 p-2">
            <ServerForm onDone={async () => { setAddingServer(false); await reloadProjects(); }} />
            <button className="mt-2 text-xs text-zinc-500" onClick={() => setAddingServer(false)}>Cancelar</button>
          </div>
        ) : (
          <button className="block text-sm text-zinc-400 hover:text-zinc-200" onClick={() => setAddingServer(true)}>+ Servidor remoto</button>
        )}
      </div>
      <button className="m-3 rounded bg-zinc-100 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40" disabled={!projects.length} onClick={() => setUi({ newSession: true, newFor: null })}>+ Nova sessão</button>
    </aside>
  );
}

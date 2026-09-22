import { useState } from 'react';
import { EFFORTS, MODELS, type Effort, type Model } from '@ccui/shared';
import { api } from '../api';
import { useApp } from '../store';
import { ServerForm } from '../features/connect/ServerForm';

const field = 'w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700';
const section = 'mb-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500';

// Configuração da aplicação: padrões globais (model/effort/limite de gasto) e servidores remotos — o que não é
// por-projeto, mora aqui. Substitui o antigo botão "+ Nova sessão" no rodapé da sidebar (nova sessão já é
// alcançável via Ctrl+K e pelo "+" de cada projeto).
export function AppSettingsModal({ onClose }: { onClose: () => void }) {
  const { config, reloadProjects } = useApp();
  const d = config?.defaults;
  const [budget, setBudget] = useState(String(d?.maxBudgetUsd ?? ''));
  const [addingServer, setAddingServer] = useState(false);
  const [err, setErr] = useState('');

  const patch = async (b: Partial<{ model: Model; effort: Effort; maxBudgetUsd: number }>) => {
    try { await api.patchConfig(b); await reloadProjects(); setErr(''); } catch (e) { setErr((e as Error).message); }
  };
  const commitBudget = () => {
    const n = Number(budget);
    if (!Number.isFinite(n) || n <= 0) { setErr('limite deve ser um número maior que zero'); return; }
    void patch({ maxBudgetUsd: n });
  };

  if (!d || !config) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-sm font-semibold text-zinc-100">Configurações</h2>

        <div className={section}>Padrões</div>
        <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">Usados por qualquer sessão/projeto que não define o próprio valor.</p>
        <div className="space-y-2.5">
          <div className="flex gap-3">
            <label className="flex-1 text-xs text-zinc-400">Modelo
              <select className={`${field} mt-1`} value={d.model} onChange={(e) => void patch({ model: e.target.value as Model })}>
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="flex-1 text-xs text-zinc-400">Effort
              <select className={`${field} mt-1`} value={d.effort} onChange={(e) => void patch({ effort: e.target.value as Effort })}>
                {EFFORTS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs text-zinc-400">Limite de gasto por sessão (USD)
            <div className="mt-1 flex gap-2">
              <input className={field} type="number" min="0.01" step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} onBlur={commitBudget} onKeyDown={(e) => e.key === 'Enter' && commitBudget()} />
            </div>
            <span className="mt-1 block text-[11px] leading-relaxed text-zinc-500">Custo acumulado da sessão (todas as mensagens, desde que o processo ficou aberto) — passado disso, o turno é abortado.</span>
          </label>
          {err && <div className="text-xs text-rose-400">{err}</div>}
        </div>

        <div className="mt-5 border-t border-zinc-800/70 pt-4">
          <div className={section}>Servidores remotos</div>
          {config.connections.filter((c) => c.kind === 'ssh').length === 0 && <div className="mb-2 text-xs text-zinc-600">Nenhum servidor remoto cadastrado.</div>}
          <ul className="mb-2 space-y-1">
            {config.connections.filter((c) => c.kind === 'ssh').map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-md border border-zinc-800/60 bg-zinc-950/40 px-2.5 py-1.5">
                <span className="truncate font-mono text-[11px] text-zinc-300">{c.label}</span>
                <button className="text-zinc-600 hover:text-rose-400" title="Remover servidor (não apaga nada no servidor)"
                  onClick={async () => { if (confirm(`Remover o servidor "${c.label}" e seus projetos da lista?`)) { await api.delConnection(c.id); await reloadProjects(); } }}
                >✕</button>
              </li>
            ))}
          </ul>
          {addingServer ? (
            <div className="rounded-md border border-zinc-800 p-2.5">
              <ServerForm onDone={async () => { setAddingServer(false); await reloadProjects(); }} />
              <button className="mt-2 text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setAddingServer(false)}>Cancelar</button>
            </div>
          ) : (
            <button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setAddingServer(true)}>+ Servidor remoto</button>
          )}
        </div>

        <div className="mt-5 flex justify-end border-t border-zinc-800/70 pt-3">
          <button className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

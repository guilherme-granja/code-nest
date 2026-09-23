import { useEffect, useState } from 'react';
import type { ProjectUsageView } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';

const ago = (t: number) => {
  const s = (t - Date.now()) / 1000, a = Math.abs(s);
  const f = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  return a < 3600 ? f.format(Math.round(s / 60), 'minute') : a < 86400 ? f.format(Math.round(s / 3600), 'hour') : f.format(Math.round(s / 86400), 'day');
};

export function ProjectSpendView({ projectId, onBack, onClose }: { projectId: string; onBack: () => void; onClose: () => void }) {
  const project = useApp((s) => s.projects.find((p) => p.id === projectId));
  const { open, send } = useApp();
  const [data, setData] = useState<ProjectUsageView | null>(null);
  const [err, setErr] = useState('');
  const [validating, setValidating] = useState(false);

  useEffect(() => { api.projectUsage(projectId).then(setData).catch((e) => setErr((e as Error).message)); }, [projectId]);

  const validateSpend = async () => {
    if (!data) return;
    setValidating(true);
    try {
      const summary = data.sessions.map((s) => `- ${s.name}: $${s.costUsd.toFixed(4)} (${new Date(s.lastModified).toLocaleDateString('pt-BR')})`).join('\n');
      const prompt = `Analise o padrão de gastos do projeto "${project?.name ?? projectId}".\n\nGasto total acumulado: $${data.totalCostUsd.toFixed(4)}\n\nÚltimas ${data.sessions.length} sessões:\n${summary}\n\nO que pode ser melhorado ou otimizado nesse uso do Claude Code, considerando os recursos já disponíveis neste app (Model Routing, modo lean)?`;
      const s = await api.newSession(projectId, { name: 'Validação de gastos', model: 'haiku', routing: true });
      open(projectId, s.sessionId);
      send(prompt);
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setValidating(false); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onBack}>← Gastos</button>
          <h1 className="text-lg font-semibold text-zinc-100">{project?.name ?? projectId}</h1>
        </div>
        <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onClose}>Fechar</button>
      </div>
      {err && <div className="mb-3 text-sm text-rose-400">{err}</div>}
      {data && (
        <>
          <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="text-xs text-zinc-500">Total acumulado</div>
            <div className="mt-1 text-xl font-semibold text-zinc-100">${data.totalCostUsd.toFixed(4)}</div>
          </div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Últimas sessões</span>
            <button className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-900 disabled:opacity-40" disabled={validating || data.sessions.length === 0} onClick={validateSpend}>
              {validating ? 'Abrindo…' : 'Validar gastos'}
            </button>
          </div>
          <ul className="space-y-1">
            {data.sessions.map((s) => (
              <li key={s.sessionId} className="flex items-center justify-between rounded-md border border-zinc-800/60 bg-zinc-900/30 px-3 py-2 text-sm text-zinc-200">
                <span className="truncate">{s.name}</span>
                <span className="flex shrink-0 items-center gap-2 font-mono text-xs text-zinc-400"><span>{ago(s.lastModified)}</span><span>${s.costUsd.toFixed(4)}</span></span>
              </li>
            ))}
            {data.sessions.length === 0 && <li className="text-sm text-zinc-600">nenhuma sessão</li>}
          </ul>
        </>
      )}
    </div>
  );
}

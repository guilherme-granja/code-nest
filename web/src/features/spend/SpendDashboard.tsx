import { useEffect, useState } from 'react';
import type { TodayUsage } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';
import { ProjectSpendView } from './ProjectSpendView';

const maxKey = (m: Record<string, number>): string | null => {
  const entries = Object.entries(m);
  if (entries.length === 0) return null;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
};

export function SpendDashboard({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects);
  const [data, setData] = useState<TodayUsage | null>(null);
  const [err, setErr] = useState('');
  const [openProject, setOpenProject] = useState<string | null>(null);

  useEffect(() => { api.usageToday().then(setData).catch((e) => setErr((e as Error).message)); }, []);

  if (openProject) return <ProjectSpendView projectId={openProject} onBack={() => setOpenProject(null)} onClose={onClose} />;

  const topModel = data ? maxKey(data.byModel) : null;
  const topProjectId = data ? maxKey(data.byProject) : null;
  const topProjectName = topProjectId ? (projects.find((p) => p.id === topProjectId)?.name ?? topProjectId) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Gastos de hoje</h1>
        <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onClose}>Fechar</button>
      </div>
      {err && <div className="text-sm text-rose-400">{err}</div>}
      {data && (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs text-zinc-500">Total hoje</div>
              <div className="mt-1 text-xl font-semibold text-zinc-100">${data.totalCostUsd.toFixed(4)}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs text-zinc-500">Modelo mais usado</div>
              <div className="mt-1 text-xl font-semibold text-zinc-100">{topModel ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs text-zinc-500">Projeto mais usado</div>
              <div className="mt-1 text-xl font-semibold text-zinc-100">{topProjectName ?? '—'}</div>
            </div>
          </div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Por projeto</div>
          <ul className="space-y-1">
            {Object.entries(data.byProject).sort((a, b) => b[1] - a[1]).map(([pid, cost]) => (
              <li key={pid}>
                <button className="flex w-full items-center justify-between rounded-md border border-zinc-800/60 bg-zinc-900/30 px-3 py-2 text-left text-sm text-zinc-200 hover:border-zinc-700" onClick={() => setOpenProject(pid)}>
                  <span>{projects.find((p) => p.id === pid)?.name ?? pid}</span>
                  <span className="font-mono text-xs text-zinc-400">${cost.toFixed(4)}</span>
                </button>
              </li>
            ))}
            {Object.keys(data.byProject).length === 0 && <li className="text-sm text-zinc-600">Nenhum gasto hoje.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

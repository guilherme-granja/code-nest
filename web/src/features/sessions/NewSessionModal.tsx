import { useState } from 'react';
import { EFFORTS, MODELS, type Effort, type Model } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';

export function NewSessionModal({ onClose }: { onClose: () => void }) {
  const { projects, config, active, ui, open, refreshRows } = useApp();
  const [pid, setPid] = useState(ui.newFor ?? active?.projectId ?? projects[0]?.id ?? '');
  const [name, setName] = useState('Nova sessão');
  const [model, setModel] = useState<Model>(config!.defaults.model);
  const [effort, setEffort] = useState<Effort>(config!.defaults.effort);
  const [err, setErr] = useState('');

  const create = async () => {
    try {
      const s = await api.newSession(pid, { name, model, effort });
      await refreshRows(pid);
      open(pid, s.sessionId);
      onClose();
    } catch (e) { setErr((e as Error).message); }
  };
  const field = 'w-full rounded bg-zinc-900 px-2 py-1.5';

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-96 space-y-3 rounded-lg border border-zinc-700 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">Nova sessão</h2>
        <label className="block text-sm text-zinc-400">Projeto
          <select className={field} value={pid} onChange={(e) => setPid(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block text-sm text-zinc-400">Nome
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1 text-sm text-zinc-400">Modelo
            <select className={field} value={model} onChange={(e) => setModel(e.target.value as Model)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label className="block flex-1 text-sm text-zinc-400">Effort
            <select className={field} value={effort} onChange={(e) => setEffort(e.target.value as Effort)}>{EFFORTS.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
        </div>
        {err && <div className="text-sm text-red-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="px-3 py-1.5 text-zinc-400" onClick={onClose}>Cancelar</button>
          <button className="rounded bg-zinc-100 px-3 py-1.5 font-medium text-zinc-900" onClick={create}>Criar</button>
        </div>
      </div>
    </div>
  );
}

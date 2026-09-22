import { useEffect, useState } from 'react';
import type { GitInfo } from '@ccui/shared';
import { api } from '../../api';

// `refreshKey` muda quando a sessão começa/termina um turno, para atualizar o status depois que o Claude mexe nos arquivos
export function GitBar({ projectId, refreshKey }: { projectId: string; refreshKey: string }) {
  const [g, setG] = useState<GitInfo | null>(null);
  useEffect(() => {
    let alive = true;
    api.git(projectId).then((x) => { if (alive) setG(x); }).catch(() => { if (alive) setG(null); });
    return () => { alive = false; };
  }, [projectId, refreshKey]);
  if (!g) return null;
  return (
    <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-1 text-xs text-zinc-400">
      <span className="font-mono text-zinc-300">⎇ {g.branch ?? '(detached)'}</span>
      {g.ahead > 0 && <span title="commits à frente do upstream">↑{g.ahead}</span>}
      {g.behind > 0 && <span title="commits atrás do upstream">↓{g.behind}</span>}
      <span>{g.changed} alterados</span>
      <span>{g.untracked} novos</span>
    </div>
  );
}

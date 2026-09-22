import { useState } from 'react';
import type { Item, TaskEntry } from './reduce';
import { ToolCard } from './ToolCard';

const taskDot: Record<TaskEntry['status'], string> = {
  pending: 'bg-zinc-600', running: 'bg-blue-500 animate-pulse', paused: 'bg-amber-500',
  completed: 'bg-green-500', failed: 'bg-red-500', killed: 'bg-zinc-700',
};

// Painel SOMENTE LEITURA: comandos `!` digitados por você e uma aba por subagente ativo/recente (Task tool), desta aba.
// A atividade do agente principal (Bash, edições, custo por turno) mora na própria conversa agora, não aqui.
export function CommandsPanel({ items, tasks }: { items: Item[]; tasks: TaskEntry[] }) {
  const [tab, setTab] = useState('main'); // 'main' ou o taskId de um TaskEntry
  const activeTask = tasks.find((t) => t.taskId === tab);
  const shellRows = tab === 'main' ? items.filter((x): x is Extract<Item, { kind: 'shell' }> => x.kind === 'shell') : [];

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-zinc-800/80 bg-zinc-950 text-xs">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 px-3.5 py-2 font-sans">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px] text-zinc-400">terminal</span>
          <span className="text-xs font-medium text-zinc-200">Terminal</span>
          <span className="rounded-sm border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-400">Read-only</span>
        </div>
      </div>
      {tasks.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-900 px-2 pt-1.5 font-sans">
          <button onClick={() => setTab('main')} className={`shrink-0 rounded-t px-2 py-1 transition-colors duration-150 ${tab === 'main' ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>Principal</button>
          {tasks.map((t) => (
            <button key={t.taskId} onClick={() => setTab(t.taskId)} title={t.label} className={`flex shrink-0 items-center gap-1.5 rounded-t px-2 py-1 transition-colors duration-150 ${tab === t.taskId ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${taskDot[t.status]}`} />
              <span className="max-w-32 truncate">{t.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 font-mono text-[11px] leading-relaxed">
        {tab === 'main' ? (
          <>
            {shellRows.length === 0 && <div className="text-zinc-600">Nenhum comando ainda. Use <code>!comando</code> no chat para rodar um.</div>}
            {shellRows.map((r) => (
              <div key={r.id} className="mb-3">
                <div className="text-emerald-400/90">$ {r.command} <span className="font-sans text-zinc-600">(você)</span>{r.output === undefined && <span className="text-zinc-500"> …executando</span>}</div>
                {r.output !== undefined && <pre className={`whitespace-pre-wrap ${r.exitCode ? 'text-rose-400' : 'text-zinc-400'}`}>{r.output.slice(0, 6000)}</pre>}
              </div>
            ))}
          </>
        ) : (
          <div className="space-y-2 font-sans">
            {(!activeTask || activeTask.items.length === 0) && <div className="text-zinc-600">Nenhuma ferramenta chamada ainda.</div>}
            {activeTask?.items.filter((x): x is Extract<Item, { kind: 'tool' }> => x.kind === 'tool').map((x) => <ToolCard key={x.toolUseId} it={x} />)}
          </div>
        )}
      </div>
    </div>
  );
}

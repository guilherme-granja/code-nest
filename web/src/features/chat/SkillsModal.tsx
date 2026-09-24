import { useEffect } from 'react';
import type { SlashCommandInfo } from '@ccui/shared';
import type { SkillUse } from './reduce';

// skills used in one turn: who invoked each, what it does, arguments and the tool result
export function SkillsModal({ skills, commands, summary, onClose }: { skills: SkillUse[]; commands?: SlashCommandInfo[]; summary: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-left font-sans" onClick={onClose}>
      <div className="max-h-[80vh] w-[32rem] max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">{skills.length === 1 ? 'Skill invocada neste turno' : `${skills.length} skills invocadas neste turno`}</h2>
          <span className="flex-1" />
          <button className="text-xs text-zinc-500 hover:text-zinc-200" onClick={onClose}>Fechar</button>
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{summary}</div>
        <ul className="mt-3 space-y-3">
          {skills.map((s, i) => {
            const desc = commands?.find((c) => c.name === s.name)?.description;
            return (
              <li key={i} className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-violet-300">/{s.name}</span>
                  <span className="flex-1" />
                  <span className="text-zinc-500">{s.by === 'user' ? 'invocada por você' : 'invocada pelo Claude'}</span>
                </div>
                {desc && <p className="mt-1 text-zinc-400">{desc}</p>}
                {s.args && <div className="mt-1"><span className="text-zinc-500">Argumentos: </span><span className="whitespace-pre-wrap font-mono text-zinc-300">{s.args}</span></div>}
                {s.by === 'claude' && (
                  <div className={`mt-1 font-mono ${s.isError ? 'text-rose-300' : 'text-zinc-500'}`}>
                    {s.output === undefined ? 'sem resultado (turno interrompido?)' : s.output.split('\n')[0].slice(0, 300)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

import type { SlashCommandInfo } from '@ccui/shared';
import { matchCommands } from '../../lib/commands';

export { matchCommands };

export function SlashMenu({ items, sel, lean, onPick, onHover }: { items: SlashCommandInfo[]; sel: number; lean: boolean; onPick: (c: SlashCommandInfo) => void; onHover: (i: number) => void }) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/95 p-1.5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)] backdrop-blur-md" role="listbox">
      {items.map((c, i) => (
        <button
          key={c.name}
          role="option"
          aria-selected={i === sel}
          // mouseDown (não click): escolhe antes de o textarea perder o foco
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-100 ${i === sel ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
        >
          <span className="shrink-0 font-mono text-zinc-100">/{c.name}</span>
          {c.argumentHint && <span className="shrink-0 font-mono text-xs text-zinc-500">{c.argumentHint}</span>}
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{c.description}</span>
          <span className="shrink-0 rounded-sm bg-zinc-800/80 px-1.5 text-[10px] text-zinc-400">{c.builtin ? 'nativo' : 'skill/plugin'}</span>
        </button>
      ))}
      <div className="mt-0.5 border-t border-zinc-800 px-2.5 py-1.5 font-mono text-[10px] text-zinc-500">
        ↑↓ navega · Tab/Enter escolhe · Esc fecha{lean ? ' · modo lean: skills e plugins não estão carregados' : ''}
      </div>
    </div>
  );
}

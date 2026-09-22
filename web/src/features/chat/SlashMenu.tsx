import type { SlashCommandInfo } from '@ccui/shared';
import { matchCommands } from '../../lib/commands';

export { matchCommands };

export function SlashMenu({ items, sel, lean, onPick, onHover }: { items: SlashCommandInfo[]; sel: number; lean: boolean; onPick: (c: SlashCommandInfo) => void; onHover: (i: number) => void }) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 max-h-72 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl" role="listbox">
      {items.map((c, i) => (
        <button
          key={c.name}
          role="option"
          aria-selected={i === sel}
          // mouseDown (não click): escolhe antes de o textarea perder o foco
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${i === sel ? 'bg-zinc-800' : ''}`}
        >
          <span className="shrink-0 font-mono text-zinc-100">/{c.name}</span>
          {c.argumentHint && <span className="shrink-0 font-mono text-xs text-zinc-500">{c.argumentHint}</span>}
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{c.description}</span>
          <span className="shrink-0 rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{c.builtin ? 'nativo' : 'skill/plugin'}</span>
        </button>
      ))}
      <div className="border-t border-zinc-800 px-3 py-1 text-[10px] text-zinc-500">
        ↑↓ navega · Tab/Enter escolhe · Esc fecha{lean ? ' · modo lean: skills e plugins não estão carregados' : ''}
      </div>
    </div>
  );
}

import { useApp } from '../../store';
import type { Item } from './reduce';

type Shell = Extract<Item, { kind: 'shell' }>;
const SEND_LIMIT = 20_000;

// Resultado de um comando `!` digitado pelo usuário. A saída NÃO vai ao Claude sozinha (sem custo de tokens); o botão envia se você quiser.
export function ShellCard({ it, busy }: { it: Shell; busy: boolean }) {
  const send = useApp((s) => s.send);
  const running = it.output === undefined;
  const failed = !running && it.exitCode !== 0;
  const share = () => {
    const out = (it.output ?? '').slice(0, SEND_LIMIT);
    send(`Rodei este comando no shell (código de saída ${it.exitCode ?? 'n/d'}):\n\n\`\`\`bash\n$ ${it.command}\n\`\`\`\n\nSaída:\n\n\`\`\`\n${out}\n\`\`\``);
  };
  return (
    <div className="rounded-md border border-zinc-800/90 bg-zinc-950 px-3 py-2 font-mono text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-emerald-400/90">$ {it.command}</span>
        <span className={`shrink-0 font-sans ${running ? 'text-zinc-500' : failed ? 'text-rose-400' : 'text-zinc-500'}`}>
          {running ? 'executando…' : it.exitCode === null ? 'interrompido' : `código ${it.exitCode}`}
        </span>
      </div>
      {!running && it.output && <pre className={`mt-1 max-h-64 overflow-auto whitespace-pre-wrap ${failed ? 'text-rose-300' : 'text-zinc-300'}`}>{it.output}</pre>}
      {!running && !it.output && <div className="mt-1 text-zinc-600">(sem saída)</div>}
      {!running && (
        <div className="mt-1 flex items-center gap-3 font-sans text-[11px] text-zinc-500">
          {it.truncated && <span>saída truncada em 200 KB</span>}
          <button className="hover:text-zinc-200 disabled:opacity-40" disabled={busy} title="Envia o comando e a saída como mensagem (gasta tokens)" onClick={share}>Enviar saída ao Claude</button>
        </div>
      )}
    </div>
  );
}

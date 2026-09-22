import type { Item } from './reduce';

export type Tool = Extract<Item, { kind: 'tool' }>;

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v, null, 2) ?? '');
const tones = {
  plain: 'bg-zinc-900 text-zinc-300',
  add: 'bg-green-950/40 text-green-300',
  del: 'bg-red-950/40 text-red-300',
  err: 'bg-red-950/40 text-red-300',
} as const;

function Block({ text, tone = 'plain' }: { text: string; tone?: keyof typeof tones }) {
  return <pre className={`max-h-64 overflow-auto whitespace-pre-wrap rounded px-2 py-1 font-mono text-xs ${tones[tone]}`}>{text}</pre>;
}

export const toolSummary = (t: Tool): string => {
  const i = (t.input ?? {}) as Record<string, unknown>;
  return str(i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.description).split('\n')[0].slice(0, 120);
};

// Bash: comando + saída; Edit: diff antigo/novo; Write: conteúdo; demais: entrada em JSON
export function ToolCard({ it }: { it: Tool }) {
  const i = (it.input ?? {}) as Record<string, unknown>;
  const status = it.output === undefined ? ' …' : it.isError ? ' (erro)' : '';
  return (
    <details className="rounded border border-zinc-800 px-3 py-1 text-sm text-zinc-400">
      <summary className="cursor-pointer truncate">
        <span className="font-medium text-zinc-300">{it.name}</span> <span className="font-mono text-xs">{toolSummary(it)}</span>{status}
      </summary>
      <div className="mt-1 space-y-1 pb-1">
        {it.name === 'Bash' && <Block text={`$ ${str(i.command)}`} />}
        {it.name === 'Edit' && (<><Block tone="del" text={str(i.old_string)} /><Block tone="add" text={str(i.new_string)} /></>)}
        {it.name === 'Write' && <Block text={str(i.content).slice(0, 2000)} />}
        {it.name !== 'Bash' && it.name !== 'Edit' && it.name !== 'Write' && <Block text={str(it.input).slice(0, 2000)} />}
        {it.output !== undefined && <Block tone={it.isError ? 'err' : 'plain'} text={it.output.slice(0, 4000)} />}
      </div>
    </details>
  );
}

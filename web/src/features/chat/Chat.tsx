import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelUsage, SlashCommandInfo } from '@ccui/shared';
import { fmtTokens } from '../../lib/format';
import { useApp } from '../../store';
import { AskUserQuestionModal, isAskUserQuestion } from './AskUserQuestionModal';
import { CommandsPanel } from './CommandsPanel';
import { GitBar } from './GitBar';
import { Markdown } from './Markdown';
import type { Item } from './reduce';
import { matchCommands, SlashMenu } from './SlashMenu';
import { ShellCard } from './ShellCard';
import { ToolCard } from './ToolCard';

const STUCK_MS = 60_000;
const json = (v: unknown) => JSON.stringify(v, null, 2)?.slice(0, 2000) ?? '';

function ItemView({ it, busy, bypass }: { it: Item; busy: boolean; bypass: boolean }) {
  // mensagens do modo shell/comandos vindas do terminal chegam como blocos de código: renderiza como markdown
  if (it.kind === 'user') {
    const bubble = it.text.includes('```')
      ? <div className="ml-auto max-w-[80%] rounded-lg bg-zinc-800 px-3 py-2"><Markdown text={it.text} /></div>
      : <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-lg bg-zinc-800 px-3 py-2">{it.text}</div>;
    if (!it.routedModel) return bubble;
    return (
      <div className="ml-auto max-w-[80%]">
        <div className="mb-1 text-right text-[10px] text-zinc-600">roteado → {it.routedModel === 'haiku' ? 'Haiku' : 'Sonnet 5'}</div>
        {bubble}
      </div>
    );
  }
  if (it.kind === 'assistant') return <Markdown text={it.text} />;
  if (it.kind === 'error') return <div className="whitespace-pre-wrap rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{it.text}</div>;
  if (it.kind === 'shell') return <ShellCard it={it} busy={busy} />;
  if (it.kind === 'turn') return <TurnSummary modelUsage={it.modelUsage} bypass={bypass} />;
  return <ToolCard it={it} />;
}

function TurnLoading({ phase, startedAt, now }: { phase: 'routing' | 'thinking'; startedAt: number; now: number }) {
  const secs = Math.max(0, Math.round((now - startedAt) / 1000));
  const dot = phase === 'routing' ? 'routing-dot' : 'thinking-dot';
  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
      <span className="flex items-center gap-0.5"><span className={dot} /><span className={dot} /><span className={dot} /></span>
      {phase === 'routing' ? 'Model Routing is helping you' : 'Claude Code is thinking'} … ({secs}s)
    </div>
  );
}

function TurnSummary({ modelUsage, bypass }: { modelUsage: Record<string, ModelUsage>; bypass: boolean }) {
  const cost = Object.values(modelUsage).reduce((s, u) => s + u.costUsd, 0);
  const tok = Object.values(modelUsage).reduce((s, u) => s + u.input + u.output, 0);
  const models = Object.keys(modelUsage).map((id) => id.replace(/^claude-/, '').replace(/-\d{8}$/, '')).join(' + ');
  return (
    <div className="text-center text-xs text-zinc-600">
      turno concluído — ${cost.toFixed(4)} · {fmtTokens(tok)} tokens · {models}
      {bypass && <span className="ml-2 rounded bg-red-950/60 px-1.5 py-0.5 text-[10px] text-red-400">bypass</span>}
    </div>
  );
}

export function Chat() {
  const { active, chats, rows, projects, config, status, up, ui, send, shell, interrupt, answer, setUi, ensureCommands } = useApp();
  const chat = active ? chats[active.sessionId] : undefined;
  const project = projects.find((p) => p.id === active?.projectId);
  const commands = useApp((s) => (project ? s.commands[`${project.id}:${project.lean}`] : undefined));
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat?.items, chat?.pending.length]);
  useEffect(() => { input.current?.focus(); }, [active?.sessionId]);
  // pré-carrega a lista de comandos `/` do projeto (sem custo de tokens); recarrega quando o lean muda
  useEffect(() => { if (project) void ensureCommands(project.id); }, [project?.id, project?.lean, ensureCommands]);

  // menu aberto enquanto o texto é só "/algo" (primeiro token, sem espaço)
  const query = /^\/(\S*)$/.exec(text)?.[1];
  const matches = useMemo<SlashCommandInfo[]>(() => (query === undefined || !commands ? [] : matchCommands(commands, query)), [query, commands]);
  const menuOpen = !dismissed && matches.length > 0;

  if (!active || !chat) return <div className="flex flex-1 items-center justify-center text-zinc-500">Selecione ou crie uma sessão (Ctrl+K)</div>;

  const name = rows[active.projectId]?.find((r) => r.sessionId === active.sessionId)?.name ?? 'Sessão';
  const busy = chat.state === 'running' || chat.state === 'awaiting_permission';
  const stuck = chat.state === 'running' && now - chat.lastEventAt > STUCK_MS;
  const connId = project?.connectionId ?? 'local';
  const connState = status[connId] ?? 'up';
  const connLabel = config?.connections.find((c) => c.id === connId)?.label ?? connId;
  const t = chat.totals;
  const usageTitle = [
    `Acumulado da sessão (inclui execuções anteriores): entrada ${t.input.toLocaleString('pt-BR')} + saída ${t.output.toLocaleString('pt-BR')} = ${(t.input + t.output).toLocaleString('pt-BR')} tokens`,
    `Cache: escrita ${t.cacheCreation.toLocaleString('pt-BR')} · leitura ${t.cacheRead.toLocaleString('pt-BR')} (não entram na contagem acima)`,
    chat.lastTokens ? `Último turno: entrada ${chat.lastTokens.input.toLocaleString('pt-BR')} · saída ${chat.lastTokens.output.toLocaleString('pt-BR')}` : '',
    'Custo = estimativa a preço de API; em plano de assinatura não é uma cobrança.',
  ].filter(Boolean).join('\n');
  const submit = () => {
    const t = text.trim();
    if (!t || !up) return;
    // modo shell: "!comando" roda direto no diretório do projeto (não vai ao modelo)
    if (t.startsWith('!')) { const cmd = t.slice(1).trim(); if (cmd) { shell(cmd); setText(''); } return; }
    if (!busy) { send(t); setText(''); }
  };
  const pick = (c: SlashCommandInfo) => { setText(`/${c.name} `); setSel(0); input.current?.focus(); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      const cur = matches[Math.min(sel, matches.length - 1)];
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, matches.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(true); return; }
      if (e.key === 'Tab') { e.preventDefault(); pick(cur); return; }
      // Enter escolhe o comando; se já digitou o nome exato de um comando sem argumento, Enter envia
      const exactNoArg = cur.name === query && !cur.argumentHint;
      if (e.key === 'Enter' && !e.shiftKey && !exactNoArg) { e.preventDefault(); pick(cur); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
        <h1 className="truncate text-[15px] font-semibold text-zinc-100">{name}</h1>
        <div className="flex items-center gap-2 text-xs text-zinc-500" title={usageTitle}>
          <span className="font-mono">${chat.totals.costUsd.toFixed(4)}</span>
          <span className="text-zinc-700">·</span>
          <span>{fmtTokens(chat.totals.input + chat.totals.output)} tokens</span>
        </div>
        <div className="flex items-center justify-end gap-3">
          {!up && <span className="text-xs text-red-400">desconectado…</span>}
          {busy && <button className="rounded border border-zinc-600 px-2 py-0.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800" onClick={interrupt}>Pausar</button>}
          <button className={`rounded border px-2 py-0.5 text-xs transition-colors hover:bg-zinc-800 ${ui.term ? 'border-zinc-500 text-zinc-200' : 'border-zinc-700 text-zinc-400'}`} title="Subagentes e comandos ! (Ctrl+J)" onClick={() => setUi({ term: !ui.term })}>Terminal</button>
        </div>
      </header>
      <GitBar projectId={active.projectId} refreshKey={`${active.sessionId}:${busy ? 'busy' : 'rest'}`} />
      {connState !== 'up' && (
        <div className="border-b border-amber-900 bg-amber-950/40 px-4 py-1 text-xs text-amber-300">
          Servidor {connLabel}: {connState === 'down' ? 'sem conexão. O turno em andamento termina no servidor e o histórico completo aparece ao reconectar.' : 'reconectando…'}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {chat.items.map((it, i) => <ItemView key={i} it={it} busy={busy} bypass={!!project?.bypass} />)}
        {chat.turnPhase !== 'idle' && <TurnLoading phase={chat.turnPhase} startedAt={chat.turnPhaseAt} now={now} />}
        {chat.pending.filter((p) => !isAskUserQuestion(p)).map((p) => (
          <div key={p.reqId} className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm">
            <div className="font-medium">
              {p.toolName === 'request_model_upgrade'
                ? <>Claude quer trocar pra <span className="text-zinc-100">Sonnet 5</span> — {String((p.input as { reason?: unknown } | null)?.reason ?? '')}</>
                : <>Permitir <code>{p.toolName}</code>?</>}
            </div>
            {p.toolName !== 'request_model_upgrade' && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-zinc-300">{json(p.input)}</pre>}
            <div className="mt-2 flex gap-2">
              <button className="rounded bg-green-700 px-3 py-1 text-white" onClick={() => answer(p.reqId, true)}>Permitir</button>
              <button className="rounded bg-zinc-700 px-3 py-1" onClick={() => answer(p.reqId, false)}>Negar</button>
            </div>
          </div>
        ))}
        {stuck && <div className="text-xs text-amber-400">Sem atividade há {Math.round((now - chat.lastEventAt) / 1000)} s. Use Interromper se necessário.</div>}
        <div ref={end} />
      </div>

      {ui.term && <CommandsPanel items={chat.items} tasks={chat.tasks} />}

      {(() => {
        const q = chat.pending.find(isAskUserQuestion);
        return q ? <AskUserQuestionModal p={q} onAnswer={(allow, updatedInput) => answer(q.reqId, allow, updatedInput)} /> : null;
      })()}

      <div className="relative border-t border-zinc-800 p-3">
        {menuOpen && <SlashMenu items={matches} sel={Math.min(sel, matches.length - 1)} lean={!!project?.lean} onPick={pick} onHover={setSel} />}
        <textarea
          ref={input}
          className="h-20 w-full resize-none rounded-md border border-zinc-800 bg-zinc-900 p-2.5 text-sm outline-none transition-colors duration-150 focus:border-zinc-600 disabled:opacity-50"
          placeholder={busy ? 'Aguarde a resposta…' : 'Mensagem… ("/" comandos · "!" shell · Enter envia · Shift+Enter quebra linha)'}
          value={text}
          disabled={busy || !up}
          onChange={(e) => { setText(e.target.value); setSel(0); setDismissed(false); }}
          onKeyDown={onKeyDown}
        />
      </div>
    </main>
  );
}

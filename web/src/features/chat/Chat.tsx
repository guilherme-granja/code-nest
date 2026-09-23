import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelUsage, SlashCommandInfo } from '@ccui/shared';
import { fmtTokens } from '../../lib/format';
import { useApp } from '../../store';
import { IconLock, IconShuffle } from '../../lib/icons';
import { AskUserQuestionModal, isAskUserQuestion } from './AskUserQuestionModal';
import { AttachMenu } from './AttachMenu';
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
      ? <div className="ml-auto max-w-[80%] rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 shadow-sm"><Markdown text={it.text} /></div>
      : <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 shadow-sm">{it.text}</div>;
    if (!it.routedModel) return bubble;
    return (
      <div className="ml-auto max-w-[80%]">
        <div className="mb-1 flex items-center justify-end gap-1.5 font-mono text-[11px] text-zinc-500">
          <IconShuffle className="h-3 w-3" />
          roteado → {it.routedModel === 'haiku' ? 'Haiku' : 'Sonnet 5'}
        </div>
        {bubble}
      </div>
    );
  }
  if (it.kind === 'assistant') return <Markdown text={it.text} />;
  if (it.kind === 'error') return <div className="whitespace-pre-wrap rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{it.text}</div>;
  if (it.kind === 'shell') return <ShellCard it={it} busy={busy} />;
  if (it.kind === 'turn') return <TurnSummary modelUsage={it.modelUsage} bypass={bypass} />;
  return <ToolCard it={it} />;
}

function TurnLoading({ phase, startedAt, now }: { phase: 'routing' | 'thinking'; startedAt: number; now: number }) {
  const secs = Math.max(0, Math.round((now - startedAt) / 1000));
  const dot = phase === 'routing' ? 'routing-dot' : 'thinking-dot';
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1 font-mono text-[11px] text-zinc-400">
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
    <div className="flex items-center justify-center gap-2 text-center font-mono text-[11px] text-zinc-600">
      turno concluído — ${cost.toFixed(4)} · {fmtTokens(tok)} tokens · {models}
      {bypass && <span className="rounded-sm border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[10px] tracking-wider text-rose-400/80">bypass</span>}
    </div>
  );
}

function AttachedFilesPill({ sessionId, connectionId }: { sessionId: string; connectionId: string }) {
  const files = useApp((s) => s.attachments[sessionId] ?? []);
  const removeAttachment = useApp((s) => s.removeAttachment);
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;
  return (
    <div className="relative">
      <button className="rounded-md border border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1 font-mono text-xs text-zinc-400 hover:border-zinc-700" onClick={() => setOpen((o) => !o)}>
        {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 rounded-md border border-zinc-800 bg-zinc-900 p-2 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <ul className="mb-2 space-y-1">
            {files.map((f) => (
              <li key={f} className="flex items-center justify-between gap-2 rounded-sm bg-zinc-950/40 px-2 py-1 text-[11px] text-zinc-300">
                <span className="min-w-0 flex-1 truncate font-mono">{f}</span>
                <button className="shrink-0 text-zinc-500 hover:text-rose-400" onClick={() => removeAttachment(sessionId, f)}>✕</button>
              </li>
            ))}
          </ul>
          <AttachMenu sessionId={sessionId} connectionId={connectionId} />
        </div>
      )}
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
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800/60 bg-zinc-950/90 px-4 py-2.5 backdrop-blur-md">
        <h1 className="truncate text-sm font-medium tracking-tight text-zinc-100">{name}</h1>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1 font-mono text-xs text-zinc-400 sm:flex" title={usageTitle}>
            <span className="text-zinc-300">${chat.totals.costUsd.toFixed(4)}</span>
            <span className="text-zinc-600">·</span>
            <span>{fmtTokens(chat.totals.input + chat.totals.output)} tokens</span>
          </div>
          <AttachedFilesPill sessionId={active.sessionId} connectionId={connId} />
          {!up && <span className="text-xs text-rose-400">desconectado…</span>}
          {busy && <button className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900" onClick={interrupt}>Pausar</button>}
          <button className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${ui.term ? 'border-zinc-700 bg-zinc-900 text-zinc-100' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'}`} title="Subagentes e comandos ! (Ctrl+J)" onClick={() => setUi({ term: !ui.term })}>Terminal</button>
        </div>
      </header>
      <GitBar projectId={active.projectId} refreshKey={`${active.sessionId}:${busy ? 'busy' : 'rest'}`} />
      {connState !== 'up' && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-1 text-xs text-amber-400">
          Servidor {connLabel}: {connState === 'down' ? 'sem conexão. O turno em andamento termina no servidor e o histórico completo aparece ao reconectar.' : 'reconectando…'}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {chat.items.map((it, i) => <ItemView key={i} it={it} busy={busy} bypass={!!project?.bypass} />)}
        {chat.turnPhase !== 'idle' && <TurnLoading phase={chat.turnPhase} startedAt={chat.turnPhaseAt} now={now} />}
        {chat.pending.filter((p) => !isAskUserQuestion(p)).map((p) => (
          <div key={p.reqId} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 shadow-md">
            <div className="flex items-center gap-2.5 border-b border-zinc-800/80 bg-zinc-900/60 px-4 py-3">
              <IconLock className="h-[18px] w-[18px] text-amber-400" />
              <div className="text-xs font-semibold text-zinc-100">
                {p.toolName === 'request_model_upgrade'
                  ? <>Claude quer trocar pra <span className="text-zinc-100">Sonnet 5</span> — {String((p.input as { reason?: unknown } | null)?.reason ?? '')}</>
                  : <>Permitir <code className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[11px]">{p.toolName}</code>?</>}
              </div>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {p.toolName !== 'request_model_upgrade' && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800/90 bg-zinc-950 p-3 font-mono text-xs text-zinc-300">{json(p.input)}</pre>}
              <div className="flex items-center gap-1.5">
                <button className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-all hover:bg-zinc-200 active:scale-[0.98]" onClick={() => answer(p.reqId, true)}>Permitir</button>
                <button className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400" onClick={() => answer(p.reqId, false)}>Negar</button>
              </div>
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

      <div className="relative border-t border-zinc-800/70 bg-zinc-950 p-3">
        {menuOpen && <SlashMenu items={matches} sel={Math.min(sel, matches.length - 1)} lean={!!project?.lean} onPick={pick} onHover={setSel} />}
        <div className="flex items-end gap-2">
          <AttachMenu sessionId={active.sessionId} connectionId={connId} />
          <textarea
            ref={input}
            className="h-20 min-w-0 flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-900/90 p-3 text-sm text-zinc-100 outline-none transition-colors duration-150 placeholder:text-zinc-500 focus:border-zinc-700 disabled:opacity-50"
            placeholder={busy ? 'Aguarde a resposta…' : 'Mensagem… ("/" comandos · "!" shell · Enter envia · Shift+Enter quebra linha)'}
            value={text}
            disabled={busy || !up}
            onChange={(e) => { setText(e.target.value); setSel(0); setDismissed(false); }}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </main>
  );
}

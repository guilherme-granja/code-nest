# Terminal por subagente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mostrar quando um subagente (Task tool) está executando e permitir trocar pro "terminal" dele — o log das ferramentas que ele chamou, isolado do log do agente principal — dentro do painel de terminal já existente.

**Architecture:** reaproveita o pipeline de eventos WebSocket existente (sem novo attach/stream). Mensagens de subagente, hoje descartadas em `events.ts`, passam a ser tagueadas com `taskId` (= `tool_use_id` do Task tool) e roteadas pro cliente como eventos normais; o cliente agrupa por `taskId` em abas dentro de `CommandsPanel`, reaproveitando o `ToolCard` já usado na conversa principal.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk`, React (Zustand-like store em `web/src/store.ts`), Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-22-subagent-terminal-design.md`

## Global Constraints

- Sem git/sem framework de testes neste projeto (decisão do usuário) — cada tarefa termina em `npm run typecheck` (e `npm run build` nas tarefas de frontend) como critério de aceite, não em teste automatizado.
- Modelos permitidos: só `sonnet`/`haiku` (allowlist já existe em `sdk-runtime.ts`, não mexer).
- `taskId` é sempre o `tool_use_id` do Task tool, nunca o `task_id` interno do SDK (ver spec, seção "Descoberta no SDK").
- Só 1º nível de aninhamento vira aba; texto de raciocínio do subagente nunca é repassado ao cliente.
- Depois de cada tarefa: `./restart.sh` pra validar no app real antes de seguir pra próxima (build sozinho não garante comportamento em runtime).

---

### Task 1: Protocolo — novos eventos e campo `taskId`

**Files:**
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces: `EventBody` ganha `{ type: 'task.started'; taskId: string; subagentType?: string; description: string }` e `{ type: 'task.updated'; taskId: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused' }`; `tool.started` e `tool.result` ganham `taskId?: string`.

- [ ] **Step 1: Editar `EventBody`**

Em `shared/src/index.ts`, dentro do tipo `EventBody`, altere as linhas de `tool.started`/`tool.result` e adicione as duas novas variantes logo depois:

```ts
export type EventBody =
  | { type: 'session.state'; state: SessionState }
  | { type: 'user.message'; text: string }
  | { type: 'message.delta'; text: string }
  | { type: 'message.completed'; text: string }
  | { type: 'tool.started'; toolUseId: string; name: string; input: unknown; taskId?: string }
  | { type: 'tool.result'; toolUseId: string; output: string; isError: boolean; taskId?: string }
  // subagente (Task tool): taskId = tool_use_id do Task tool. Só 1º nível vira aba no cliente.
  | { type: 'task.started'; taskId: string; subagentType?: string; description: string }
  | { type: 'task.updated'; taskId: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused' }
  | ({ type: 'permission.requested' } & PendingPermission)
  | { type: 'permission.resolved'; reqId: string; allow: boolean }
  // modelUsage: no evento entregue ao cliente é o gasto SÓ deste turno, por modelo (delta calculado em hub.ts)
  | { type: 'turn.completed'; totals: UsageTotals; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; modelUsage: Record<string, ModelUsage> }
  | { type: 'shell.started'; id: string; command: string }
  | ({ type: 'shell.result'; id: string } & ShellResult)
  | { type: 'error'; code: 'runtime' | 'budget' | 'exit'; message: string };
```

- [ ] **Step 2: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p shared`
Expected: sem erro (só um tipo, sem lógica pra quebrar ainda).

- [ ] **Step 3: Commit**

Sem git neste projeto — pule este passo (aqui e em todas as tarefas seguintes).

---

### Task 2: Servidor — parar de descartar mensagens de subagente (`events.ts`)

**Files:**
- Modify: `server/src/runtime/events.ts`

**Interfaces:**
- Consumes: `EventBody` de `@ccui/shared` (Task 1).
- Produces: `mapMessage(m: SDKMessage): EventBody[]` — comportamento novo: mensagens com `parent_tool_use_id` viram `tool.started`/`tool.result` tagueados com `taskId`, em vez de descartadas; `system/task_started` vira `task.started` (filtrando `skip_transcript`/`ambient`).

- [ ] **Step 1: Substituir o topo de `mapMessage` e os cases `assistant`/`user`, adicionar case `system`**

Em `server/src/runtime/events.ts`, troque a função inteira por:

```ts
export function mapMessage(m: SDKMessage): EventBody[] {
  // parent_tool_use_id = tool_use_id do Task tool que chamou este subagente; undefined fora de um subagente
  const taskId = 'parent_tool_use_id' in m ? (m.parent_tool_use_id ?? undefined) : undefined;
  switch (m.type) {
    case 'stream_event': {
      if (taskId) return []; // sem streaming de texto de subagente (só as ferramentas que ele chama)
      const e = m.event;
      return e.type === 'content_block_delta' && e.delta.type === 'text_delta' ? [{ type: 'message.delta', text: e.delta.text }] : [];
    }
    case 'assistant': {
      const out: EventBody[] = [];
      for (const b of m.message.content) {
        if (taskId) {
          // dentro de um subagente: só repassa a ferramenta chamada (log de comandos daquela aba)
          if (b.type === 'tool_use') out.push({ type: 'tool.started', toolUseId: b.id, name: b.name, input: b.input, taskId });
        } else {
          if (b.type === 'text' && b.text) out.push({ type: 'message.completed', text: b.text });
          else if (b.type === 'tool_use') out.push({ type: 'tool.started', toolUseId: b.id, name: b.name, input: b.input });
        }
      }
      return out;
    }
    case 'user': {
      const c = m.message.content;
      if (!Array.isArray(c)) return [];
      return c.flatMap((b) =>
        b.type === 'tool_result'
          ? [{ type: 'tool.result' as const, toolUseId: b.tool_use_id, output: blockText(b.content), isError: !!b.is_error, ...(taskId ? { taskId } : {}) }]
          : [],
      );
    }
    case 'result': {
      const u = m.usage;
      const out: EventBody[] = [{
        type: 'turn.completed', totals: sumUsage(m.modelUsage, m.total_cost_usd),
        inputTokens: u.input_tokens, outputTokens: u.output_tokens,
        cacheCreationTokens: u.cache_creation_input_tokens, cacheReadTokens: u.cache_read_input_tokens,
        modelUsage: rawModelUsage(m.modelUsage), // cumulativo aqui; hub.ts converte pra delta do turno antes de enviar ao cliente
      }];
      if (m.subtype !== 'success' || m.is_error) {
        out.push({
          type: 'error',
          code: m.subtype === 'error_max_budget_usd' ? 'budget' : 'runtime',
          message: m.subtype === 'success' ? m.result : m.errors.join('; '),
        });
      }
      return out;
    }
    case 'system':
      // task_updated não entra aqui: não traz tool_use_id, só task_id — sdk-runtime.ts resolve com o Map dele e emite direto
      if (m.subtype === 'task_started' && !m.skip_transcript && !m.ambient && m.tool_use_id) {
        return [{ type: 'task.started', taskId: m.tool_use_id, subagentType: m.subagent_type, description: m.description }];
      }
      return [];
    default:
      return []; // hooks, status, rate_limit, etc.
  }
}
```

(A função `rawModelUsage` já existe e já está exportada de uma tarefa anterior desta sessão — não precisa recriar.)

- [ ] **Step 2: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p server`
Expected: sem erro. Se der erro de tipo em `m.subtype === 'task_started'` (campo inexistente), confirme que a versão do SDK instalada tem `SDKTaskStartedMessage` — `grep -n "SDKTaskStartedMessage" node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

---

### Task 3: Servidor — correlação `task_id → taskId` e wiring em `Live` (`sdk-runtime.ts`)

**Files:**
- Modify: `server/src/runtime/sdk-runtime.ts`

**Interfaces:**
- Consumes: `mapMessage` (Task 2), `EventBody` `task.updated` (Task 1).
- Produces: `Live` passa a emitir `task.updated` (que `mapMessage` não trata) resolvendo `task_id` → `taskId` (=`tool_use_id`) via um `Map` de instância, populado quando `task_started` passa pelo loop.

- [ ] **Step 1: Adicionar o campo `taskIds` na classe `Live`**

Em `server/src/runtime/sdk-runtime.ts`, na classe `Live` (perto dos outros campos privados, junto de `private pending`):

```ts
  // task_id (interno do SDK) -> taskId (tool_use_id do Task tool) — só task_updated/task_progress precisam disto,
  // pois não trazem tool_use_id; populado quando task_started passa pelo loop em run().
  private taskIds = new Map<string, string>();
```

- [ ] **Step 2: Editar o loop `run()`**

Localize (dentro de `private async run()`):

```ts
        for (const b of mapMessage(m)) this.out.push(b);
```

Substitua por:

```ts
        if (m.type === 'system' && m.subtype === 'task_started' && m.tool_use_id) this.taskIds.set(m.task_id, m.tool_use_id);
        if (m.type === 'system' && m.subtype === 'task_updated') {
          const taskId = this.taskIds.get(m.task_id);
          if (taskId && m.patch.status) this.out.push({ type: 'task.updated', taskId, status: m.patch.status });
          continue; // mapMessage não trata task_updated (não tem tool_use_id pra tagueá-lo sozinho)
        }
        for (const b of mapMessage(m)) this.out.push(b);
```

- [ ] **Step 3: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p server`
Expected: sem erro.

- [ ] **Step 4: Build + restart e checar log**

Run:
```bash
cd /home/guilhermegranja/Guilherme/claude-code-ui && npm run typecheck && ./restart.sh && sleep 1.5 && cat /tmp/ccui.log
```
Expected: `Claude Code UI: http://127.0.0.1:4317/...` sem erro no log. Nenhuma mudança visível ainda (frontend não consome os eventos novos até a Task 5) — isso só confirma que o backend sobe sem quebrar.

---

### Task 4: Frontend — estado de tasks no reducer (`reduce.ts`)

**Files:**
- Modify: `web/src/features/chat/reduce.ts`

**Interfaces:**
- Consumes: `ClaudeEvent` com `task.started`/`task.updated`/`tool.started`/`tool.result` (Task 1).
- Produces: `Chat.tasks: TaskEntry[]`; `TaskEntry = { taskId: string; label: string; status: TaskStatus; items: Item[] }`; `TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused'`. Task 5 (CommandsPanel) consome `chat.tasks` e o tipo `TaskEntry`.

- [ ] **Step 1: Import e novos tipos**

No topo de `web/src/features/chat/reduce.ts`, troque o import por:

```ts
import { ZERO_TOTALS, type ClaudeEvent, type ModelUsage, type PendingPermission, type ServerMsg, type SessionState, type UsageTotals } from '@ccui/shared';
```

(já está assim desde a tarefa de custo por turno — confirme, não duplique o import).

Logo abaixo do tipo `Item`, adicione:

```ts
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused';
// log de um subagente (Task tool): items é só o que ele chamou de ferramenta, sem texto de raciocínio (ver spec)
export interface TaskEntry { taskId: string; label: string; status: TaskStatus; items: Item[] }
```

- [ ] **Step 2: Adicionar `tasks` em `Chat`, `emptyChat` e `applySnapshot`**

```ts
export interface Chat {
  hydrated: boolean;
  items: Item[];
  state: SessionState;
  lastSeq: number;
  totals: UsageTotals;
  lastTokens?: { input: number; output: number; cacheCreation: number; cacheRead: number };
  pending: PendingPermission[];
  lastEventAt: number;
  tasks: TaskEntry[];
}

export const emptyChat = (): Chat => ({ hydrated: false, items: [], state: 'idle', lastSeq: 0, totals: ZERO_TOTALS, pending: [], lastEventAt: Date.now(), tasks: [] });

export function applySnapshot(s: Extract<ServerMsg, { type: 'snapshot' }>): Chat {
  return {
    hydrated: true,
    items: s.history.map((h) => ({ kind: h.role, text: h.text })),
    state: s.state,
    lastSeq: s.lastSeq,
    totals: s.totals,
    pending: s.pending,
    lastEventAt: Date.now(),
    tasks: [], // subagentes não persistem entre reconexões (fora de escopo, ver spec)
  };
}
```

- [ ] **Step 3: Helper de roteamento + cases no `applyEvent`**

Logo antes de `export function applyEvent`, adicione:

```ts
// injeta um item novo dentro do TaskEntry certo; cria o task defensivamente se task.started ainda não chegou
function upsertTaskItem(tasks: TaskEntry[], taskId: string, item: Item): TaskEntry[] {
  const i = tasks.findIndex((t) => t.taskId === taskId);
  if (i < 0) return [...tasks, { taskId, label: taskId.slice(0, 8), status: 'running', items: [item] }];
  const next = tasks.slice();
  next[i] = { ...next[i], items: [...next[i].items, item] };
  return next;
}
```

Dentro de `applyEvent`, troque os cases `tool.started` e `tool.result` por:

```ts
    case 'tool.started':
      if (ev.taskId) next.tasks = upsertTaskItem(c.tasks, ev.taskId, { kind: 'tool', toolUseId: ev.toolUseId, name: ev.name, input: ev.input });
      else items.push({ kind: 'tool', toolUseId: ev.toolUseId, name: ev.name, input: ev.input });
      break;
    case 'tool.result': {
      if (ev.taskId) {
        next.tasks = c.tasks.map((t) => t.taskId !== ev.taskId ? t : {
          ...t,
          items: t.items.map((x) => (x.kind === 'tool' && x.toolUseId === ev.toolUseId ? { ...x, output: ev.output, isError: ev.isError } : x)),
        });
      } else {
        const i = items.findIndex((x) => x.kind === 'tool' && x.toolUseId === ev.toolUseId);
        if (i >= 0) items[i] = { ...(items[i] as Extract<Item, { kind: 'tool' }>), output: ev.output, isError: ev.isError };
      }
      break;
    }
```

E adicione, junto dos outros `case`s (por exemplo depois de `case 'permission.resolved'`):

```ts
    case 'task.started':
      next.tasks = [...c.tasks, { taskId: ev.taskId, label: ev.subagentType ?? ev.description.slice(0, 24), status: 'running', items: [] }];
      break;
    case 'task.updated':
      next.tasks = c.tasks.map((t) => (t.taskId === ev.taskId ? { ...t, status: ev.status } : t));
      break;
```

- [ ] **Step 4: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p web`
Expected: sem erro. (`CommandsPanel` ainda não foi atualizado — a Task 5 corrige a assinatura dela.)

---

### Task 5: Frontend — abas de subagente no `CommandsPanel`

**Files:**
- Modify: `web/src/features/chat/CommandsPanel.tsx`

**Interfaces:**
- Consumes: `Item`, `TaskEntry` (Task 4), `ToolCard` (já existe, `web/src/features/chat/ToolCard.tsx`, prop `it: Extract<Item, { kind: 'tool' }>`).
- Produces: `CommandsPanel({ items, tasks, state, onInterrupt })` — assinatura nova, `tasks: TaskEntry[]` obrigatório (Task 6 atualiza a chamada em `Chat.tsx`).

- [ ] **Step 1: Reescrever o arquivo**

Substitua `web/src/features/chat/CommandsPanel.tsx` inteiro por:

```tsx
import { useState } from 'react';
import type { ModelUsage, SessionState } from '@ccui/shared';
import { fmtTokens } from '../../lib/format';
import type { Item, TaskEntry } from './reduce';
import { ToolCard } from './ToolCard';

const stateLabel: Record<SessionState, string> = { idle: 'ocioso', running: 'executando…', awaiting_permission: 'aguardando permissão', exited: 'encerrado' };
const stateDot: Record<SessionState, string> = { idle: 'bg-zinc-600', running: 'bg-blue-500 animate-pulse', awaiting_permission: 'bg-amber-500 animate-pulse', exited: 'bg-zinc-700' };
const taskDot: Record<TaskEntry['status'], string> = {
  pending: 'bg-zinc-600', running: 'bg-blue-500 animate-pulse', paused: 'bg-amber-500',
  completed: 'bg-green-500', failed: 'bg-red-500', killed: 'bg-zinc-700',
};
// "claude-sonnet-4-5-20250929" -> "sonnet-4-5"
const fmtModel = (id: string) => id.replace(/^claude-/, '').replace(/-\d{8}$/, '');

type Row =
  | { kind: 'cmd'; key: string; who: string; cmd: string; output?: string; failed: boolean }
  | { kind: 'turn'; key: string; modelUsage: Record<string, ModelUsage> };

function mainRows(items: Item[]): Row[] {
  return items.flatMap((x, i): Row[] => {
    if (x.kind === 'tool' && x.name === 'Bash') return [{ kind: 'cmd', key: x.toolUseId, who: 'Claude', cmd: String((x.input as { command?: unknown } | null)?.command ?? ''), output: x.output, failed: !!x.isError }];
    if (x.kind === 'shell') return [{ kind: 'cmd', key: x.id, who: 'você', cmd: x.command, output: x.output, failed: x.exitCode !== undefined && x.exitCode !== 0 }];
    if (x.kind === 'turn') return [{ kind: 'turn', key: `t${i}`, modelUsage: x.modelUsage }];
    return [];
  });
}

// Painel SOMENTE LEITURA: comandos Bash do Claude, comandos `!` digitados por você, resumo de custo por turno
// e uma aba por subagente ativo/recente (Task tool), desta aba.
export function CommandsPanel({ items, tasks, state, onInterrupt }: { items: Item[]; tasks: TaskEntry[]; state: SessionState; onInterrupt: () => void }) {
  const [tab, setTab] = useState('main'); // 'main' ou o taskId de um TaskEntry
  const busy = state === 'running' || state === 'awaiting_permission';
  const activeTask = tasks.find((t) => t.taskId === tab);
  const rows = tab === 'main' ? mainRows(items) : [];

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-zinc-800 bg-zinc-950 text-xs">
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
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-900 px-4 py-1.5 font-sans">
        <div className="flex items-center gap-2 text-zinc-300">
          <span className={`h-2 w-2 shrink-0 rounded-full ${stateDot[state]}`} />
          {stateLabel[state]}
        </div>
        {busy && <button className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 transition-colors hover:bg-zinc-800" onClick={onInterrupt}>Pausar</button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono">
        {tab === 'main' ? (
          <>
            {rows.length === 0 && <div className="text-zinc-600">Nenhum comando ainda. Use <code>!comando</code> no chat para rodar um.</div>}
            {rows.map((r) => {
              if (r.kind === 'turn') {
                const cost = Object.values(r.modelUsage).reduce((s, u) => s + u.costUsd, 0);
                const tok = Object.values(r.modelUsage).reduce((s, u) => s + u.input + u.output, 0);
                const models = Object.keys(r.modelUsage).map(fmtModel).join(' + ');
                return (
                  <div key={r.key} className="mb-3 font-sans text-zinc-500">
                    <span className="text-emerald-400">✓</span> turno concluído — ${cost.toFixed(4)} · {fmtTokens(tok)} tokens · {models}
                  </div>
                );
              }
              return (
                <div key={r.key} className="mb-3">
                  <div className="text-green-400">$ {r.cmd} <span className="font-sans text-zinc-600">({r.who})</span>{r.output === undefined && <span className="text-zinc-500"> …executando</span>}</div>
                  {r.output !== undefined && <pre className={`whitespace-pre-wrap ${r.failed ? 'text-red-400' : 'text-zinc-400'}`}>{r.output.slice(0, 6000)}</pre>}
                </div>
              );
            })}
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
```

- [ ] **Step 2: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p web`
Expected: erro esperado em `web/src/features/chat/Chat.tsx` (chamada de `<CommandsPanel>` sem a prop `tasks`) — corrigido na Task 6. Se houver QUALQUER outro erro (em `CommandsPanel.tsx` mesmo), pare e corrija antes de seguir.

---

### Task 6: Frontend — ligar `chat.tasks` no `Chat.tsx`

**Files:**
- Modify: `web/src/features/chat/Chat.tsx`

**Interfaces:**
- Consumes: `CommandsPanel` (Task 5), `chat.tasks: TaskEntry[]` (Task 4).

- [ ] **Step 1: Passar a prop nova**

Em `web/src/features/chat/Chat.tsx`, troque:

```tsx
      {ui.term && <CommandsPanel items={chat.items} state={chat.state} onInterrupt={interrupt} />}
```

por:

```tsx
      {ui.term && <CommandsPanel items={chat.items} tasks={chat.tasks} state={chat.state} onInterrupt={interrupt} />}
```

- [ ] **Step 2: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npm run typecheck`
Expected: sem erro em nenhum dos três projetos (`shared`, `server`, `web`).

---

### Task 7: Build, restart e verificação end-to-end manual

**Files:** nenhum (só validação).

- [ ] **Step 1: Build + restart**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && ./restart.sh`
Expected: build sem erro, app reiniciada, log em `/tmp/ccui.log` sem erro (`cat /tmp/ccui.log`).

- [ ] **Step 2: Teste manual (você, no navegador)**

1. Abra a sessão, mande um prompt que force o uso de um subagente (ex.: "use uma subagent Task pra listar os arquivos de `server/src`").
2. Confira: o terminal abre sozinho (turno começou), aparece uma aba nova além de "Principal" com um ponto azul pulsando.
3. Clique na aba do subagente: vê as ferramentas que ele chamou (via `ToolCard`), sem texto de raciocínio.
4. Quando o subagente termina, o ponto da aba vira verde (`completed`); a aba continua clicável.
5. O card "Task" na conversa principal continua aparecendo normalmente (comportamento antigo, não mexido).
6. `!comando` e Bash do agente principal continuam só na aba Principal (sem duplicar na aba do subagente e vice-versa).

Se algo não bater com a lista acima, volte pra tarefa correspondente (Task 2/3 = servidor não está tagueando/emitindo certo; Task 4 = estado do cliente; Task 5/6 = UI).

---

## Self-Review (feito ao escrever este plano)

- **Cobertura do spec:** protocolo (Task 1), servidor content-tagging + task_started (Task 2), correlação task_updated (Task 3), estado do cliente (Task 4), UI de abas (Task 5), wiring (Task 6), validação (Task 7) — cobre todas as seções da spec. `task_progress` e persistência entre reconexão ficam fora, como o spec já declarou explicitamente.
- **Placeholders:** nenhum "TBD"/"depois eu vejo" — todo passo tem o código completo.
- **Consistência de tipos:** `TaskEntry`, `TaskStatus`, `taskId`, `upsertTaskItem` usados com o mesmo nome/assinatura em todas as tarefas que os tocam (Task 4 define, Task 5 e 6 consomem só o que a Task 4 exportou).

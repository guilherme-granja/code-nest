# Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cada mensagem enviada a um projeto com "roteamento" ligado escolhe Haiku ou Sonnet automaticamente (heurística + fallback Haiku descartável), com escalonamento Haiku→Sonnet pedido pelo próprio modelo via ferramenta customizada, aprovado pelo fluxo de permissão já existente.

**Architecture:** classificação roda no único ponto por onde toda mensagem já passa (`hub.ts` `send()`), trocando o modelo da sessão já aberta via `Query.setModel()` — sem reabrir sessão, sem processo Node.js separado. Escalonamento é uma ferramenta MCP em processo (`createSdkMcpServer`), gateada pelo `canUseTool` que já existe.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk` (`Query.setModel`, `createSdkMcpServer`, `tool()`), React, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-22-model-routing-design.md`

## Global Constraints

- Sem git/sem framework de testes neste projeto (decisão do usuário) — cada tarefa termina em `npm run typecheck` como critério de aceite; tarefas de frontend também rodam `npm run build`.
- Modelos permitidos: só `sonnet`/`haiku` — `forbiddenModel` em `sdk-runtime.ts` não muda; roteamento nunca escolhe Opus/Fable.
- Roteamento é opt-in por projeto (`Project.routing`), padrão desligado — sessão sem o flag se comporta exatamente como hoje.
- Erro ou resposta ambígua do classificador → `sonnet` (falha pro lado seguro, nunca pro lado barato).
- Depois de cada tarefa de servidor: `npm run typecheck && ./restart.sh && sleep 1.5 && cat /tmp/ccui.log` pra confirmar que sobe sem erro.

---

### Task 1: Protocolo — `Project.routing`, evento `model.routed`

**Files:**
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces: `Project.routing?: boolean`; `patchProjectBody` aceita `routing`; `EventBody` ganha `{ type: 'model.routed'; model: Model }`.

- [ ] **Step 1: `Project` e `patchProjectBody`**

```ts
export interface Project { id: string; name: string; connectionId: string; path: string; lean: boolean; routing?: boolean; model?: Model; effort?: Effort }
```

```ts
export const patchProjectBody = z.object({ name: name(80).optional(), lean: z.boolean().optional(), routing: z.boolean().optional(), model: modelSchema.optional(), effort: effortSchema.optional() });
```

- [ ] **Step 2: `EventBody`**

Adicione, junto das outras variantes (por exemplo depois de `task.updated`):

```ts
  | { type: 'model.routed'; model: Model }
```

- [ ] **Step 3: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p shared`
Expected: sem erro.

---

### Task 2: Heurística de classificação (`routing.ts`)

**Files:**
- Create: `server/src/runtime/routing.ts`

**Interfaces:**
- Produces: `classifyHeuristic(text: string): Model | null`; `CLASSIFY_SYSTEM_PROMPT: string`. Consumido pela Task 3.

- [ ] **Step 1: Criar o arquivo**

```ts
import type { Model } from '@ccui/shared';

const SONNET_HINTS = /\b(implementa|implement|refator|refactor|cri[ae]|creat|constr[oó][ei]|build|arquitet|architect|desenh[ae]|design|corrig[ei].*bug|fix.*bug|migra|migrat|integra|integrat|escreve|write.*(fun[cç][aã]o|function|componente|component|endpoint|feature|teste|test)|planej[ae]|plan)\b/i;
const HAIKU_HINTS = /^\s*(o que|what is|what's|explica|explain|list[ae]|mostr[ae]|show|confirma|confirm|qual|which|quando|when|resum[ae]|summariz)\b/i;

// null = zona cinzenta: a heurística não decide, precisa da chamada Haiku descartável (ver sdk-runtime.ts classifyViaHaiku)
export function classifyHeuristic(text: string): Model | null {
  const t = text.trim();
  if (!t) return 'haiku';
  if (t.length > 400) return 'sonnet'; // prompt longo: mais provável ser tarefa grande
  if (SONNET_HINTS.test(t)) return 'sonnet';
  if (HAIKU_HINTS.test(t) && t.length < 200) return 'haiku';
  return null;
}

export const CLASSIFY_SYSTEM_PROMPT = `Você é um classificador de complexidade de tarefas pra um roteador de modelo. Leia a mensagem do usuário e responda com UMA ÚNICA PALAVRA, sem explicação:
- "haiku" se for uma pergunta factual simples, confirmação, leitura/explicação de algo já existente, ou tarefa trivial de 1 passo.
- "sonnet" se exigir escrever ou editar código, mudar múltiplos arquivos, planejamento, raciocínio sobre arquitetura, ou qualquer ambiguidade sobre o que fazer.
Na dúvida, responda "sonnet".`;
```

- [ ] **Step 2: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p server`
Expected: sem erro.

---

### Task 3: `classify()` no runtime + escalonamento em `Live` (`sdk-runtime.ts`)

**Files:**
- Modify: `server/src/runtime/sdk-runtime.ts`
- Modify: `server/src/runtime/types.ts`

**Interfaces:**
- Consumes: `classifyHeuristic`, `CLASSIFY_SYSTEM_PROMPT` (Task 2).
- Produces: `ClaudeRuntime.classify(cwd, text): Promise<Model>`; `LiveSession.setModel(model: Model): Promise<void>`; `OpenOptions.routing: boolean`.

- [ ] **Step 1: `types.ts` — novos campos/métodos**

Em `server/src/runtime/types.ts`, altere:

```ts
export interface OpenOptions {
  cwd: string; sessionId: string; model: Model; effort: Effort; lean: boolean; routing: boolean; maxBudgetUsd: number; permissionMode: 'default' | 'plan';
}
export interface LiveSession {
  send(text: string): void;
  interrupt(): Promise<void>;
  answerPermission(reqId: string, allow: boolean): void;
  setModel(model: Model): Promise<void>;
  close(): Promise<void>;
  events: AsyncIterable<EventBody>;
}
export interface ClaudeRuntime {
  listSessions(cwd: string): Promise<SessionInfo[]>;
  history(sessionId: string, cwd: string): Promise<HistoryItem[]>;
  open(o: OpenOptions): Promise<LiveSession>;
  usage(sessionId: string, cwd: string): Promise<{ totals: UsageTotals; modelUsage: Record<string, ModelUsage> } | null>;
  shell(cwd: string, command: string): Promise<ShellResult>;
  commands(cwd: string, lean: boolean): Promise<SlashCommandInfo[]>;
  /** decide Haiku ou Sonnet pra uma mensagem (heurística + fallback Haiku descartável) */
  classify(cwd: string, text: string): Promise<Model>;
  settle(sessionId: string, cwd: string): Promise<void>;
}
```

(`Model` já está importado no topo do arquivo — não duplique o import.)

- [ ] **Step 2: Verificar (esperado dar erro — corrigido nos próximos passos)**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p server`
Expected: erros em `sdk-runtime.ts` (`SdkRuntime`/`Live` não implementam os membros novos). Se o erro for em outro arquivo, pare e investigue antes de seguir.

- [ ] **Step 3: Import e helper `firstAssistantText` em `sdk-runtime.ts`**

No topo de `server/src/runtime/sdk-runtime.ts`, ajuste os imports:

```ts
import { randomUUID } from 'node:crypto';
import { createSdkMcpServer, query, tool, type CanUseTool, type PermissionResult, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { EFFORTS, MODELS, type EventBody, type HistoryItem, type Model, type ModelUsage, type ShellResult, type SlashCommandInfo, type UsageTotals } from '@ccui/shared';
import { z } from 'zod';
import { visibleCommands } from '../commands';
import { mapMessage } from './events';
import { classifyHeuristic, CLASSIFY_SYSTEM_PROMPT } from './routing';
import type { ClaudeRuntime, LiveSession, OpenOptions, SessionInfo, Transport } from './types';
```

Logo abaixo de `export const forbiddenModel = ...`, adicione:

```ts
// lê a 1ª resposta de texto do assistente e fecha; usado pelo classificador descartável (sem persistir sessão)
async function firstAssistantText(q: Query): Promise<string> {
  for await (const m of q) {
    if (m.type === 'assistant') {
      const b = m.message.content.find((c) => c.type === 'text');
      if (b && 'text' in b) return b.text;
    }
  }
  return '';
}

const CLASSIFY_TIMEOUT_MS = 15_000;
```

- [ ] **Step 4: `setModel` e escalonamento na classe `Live`**

Adicione o método (perto de `interrupt()`):

```ts
  async setModel(model: Model) { await this.q.setModel(model); }
```

Edite o construtor: antes de `this.q = query({...})`, monte a tool de escalonamento condicionalmente e use nas `options`:

```ts
  constructor(o: OpenOptions, resume: boolean, transport: Transport) {
    const routingServer = o.routing ? createSdkMcpServer({
      name: 'routing',
      tools: [tool(
        'request_model_upgrade',
        'Pede pra trocar de Haiku pra Sonnet 5 no meio da tarefa, quando ela precisar de mais raciocínio do que o esperado.',
        { reason: z.string().min(1).max(300) },
        async ({ reason }) => {
          await this.q.setModel('sonnet'); // só roda depois que canUseTool já aprovou a chamada desta tool
          return { content: [{ type: 'text', text: `Modelo trocado pra Sonnet 5. Motivo: ${reason}` }] };
        },
      )],
    }) : undefined;
    this.q = query({
      prompt: this.input,
      options: {
        cwd: o.cwd,
        ...(resume ? { resume: o.sessionId } : { sessionId: o.sessionId }),
        model: o.model,
        effort: o.effort,
        maxBudgetUsd: o.maxBudgetUsd,
        permissionMode: o.permissionMode,
        systemPrompt: o.routing
          ? { type: 'preset', preset: 'claude_code', append: 'Este projeto usa roteamento de modelo pra economizar tokens: se você estiver rodando em Haiku e perceber que a tarefa precisa de mais raciocínio (mudanças em vários arquivos, arquitetura, lógica complexa), chame a ferramenta request_model_upgrade explicando o motivo antes de continuar.' }
          : { type: 'preset', preset: 'claude_code' },
        settingSources: o.lean ? [] : ['user', 'project', 'local'],
        includePartialMessages: true,
        canUseTool: this.canUseTool,
        ...(routingServer ? { mcpServers: { routing: routingServer } } : {}),
        spawnClaudeCodeProcess: (so) => transport.spawn(so, (s) => { this.stderrTail = (this.stderrTail + s).slice(-2000); }),
      },
    });
    this.pump = this.run();
  }
```

- [ ] **Step 5: `classify()` na classe `SdkRuntime`**

Adicione (perto de `usage()`):

```ts
  async classify(cwd: string, text: string): Promise<Model> {
    return classifyHeuristic(text) ?? this.classifyViaHaiku(cwd, text);
  }

  private async classifyViaHaiku(cwd: string, text: string): Promise<Model> {
    const input = channel<SDKUserMessage>();
    const q = query({
      prompt: input,
      options: {
        cwd, model: 'haiku', persistSession: false, maxTurns: 1,
        systemPrompt: { type: 'custom', prompt: CLASSIFY_SYSTEM_PROMPT },
        settingSources: [],
        spawnClaudeCodeProcess: (so) => this.transport.spawn(so, () => {}),
      },
    });
    input.push({ type: 'user', message: { role: 'user', content: text.slice(0, 2000) }, parent_tool_use_id: null });
    input.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout ao classificar')), CLASSIFY_TIMEOUT_MS); });
      const answer = await Promise.race([firstAssistantText(q), timeout]);
      return /\bhaiku\b/i.test(answer) ? 'haiku' : 'sonnet';
    } catch {
      return 'sonnet'; // falha/ambíguo: vai pro modelo maior, nunca pro barato
    } finally {
      clearTimeout(timer);
      q.close();
    }
  }
```

- [ ] **Step 6: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p server`
Expected: sem erro. Se `zod` não estiver disponível no workspace `server`, rode `cd server && npm ls zod` — já é dependência do `shared` (usa em `createProjectBody` etc.); se o `server` não a enxergar, adicione `"zod": "*"` às deps do `server/package.json` apontando pra mesma versão do `shared/package.json` e rode `npm install` na raiz.

---

### Task 4: `domain.ts` — resolver `routing` no `OpenSpec`

**Files:**
- Modify: `server/src/domain.ts`

**Interfaces:**
- Consumes: `Project.routing` (Task 1), `OpenOptions.routing` (Task 3).

- [ ] **Step 1: Editar `openSpecFor`**

```ts
export function openSpecFor(store: Store, sessionId: string): OpenSpec {
  const meta = store.sessions.data.sessions.find((s) => s.sessionId === sessionId);
  const project = meta && store.projects.data.projects.find((p) => p.id === meta.projectId);
  if (!meta || !project) throw new Error('sessão desconhecida');
  const d = store.config.data.defaults;
  return {
    cwd: project.path,
    model: meta.model ?? project.model ?? d.model,
    effort: meta.effort ?? project.effort ?? d.effort,
    lean: project.lean,
    routing: project.routing ?? false,
    maxBudgetUsd: d.maxBudgetUsd,
    permissionMode: 'default',
  };
}
```

- [ ] **Step 2: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p server`
Expected: sem erro.

---

### Task 5: `hub.ts` — classificar e trocar modelo antes de cada envio

**Files:**
- Modify: `server/src/hub.ts`

**Interfaces:**
- Consumes: `spec.routing`, `runtimeFor(id).classify()`, `e.live.setModel()` (Tasks 3-4).
- Produces: evento `model.routed` emitido antes de `user.message` quando `spec.routing` é true.

- [ ] **Step 1: Editar `send()`**

```ts
  async send(id: string, text: string): Promise<'ok' | 'busy'> {
    const spec = this.spec(id);
    const e = this.entry(id);
    if (e.state === 'running' || e.state === 'awaiting_permission') return 'busy';
    this.setState(id, e, 'running'); // reserva antes do await para não abrir dois processos
    if (!e.live) {
      try {
        e.live = await this.runtimeFor(id).open({ ...spec, sessionId: id });
      } catch (err) {
        this.emit(id, e, { type: 'error', code: 'runtime', message: (err as Error).message });
        this.setState(id, e, 'idle');
        return 'ok';
      }
      void this.pump(id, e, e.live);
    }
    if (spec.routing) {
      const model = await this.runtimeFor(id).classify(spec.cwd, text).catch(() => 'sonnet' as const);
      await e.live.setModel(model).catch(() => {});
      this.emit(id, e, { type: 'model.routed', model });
    }
    this.emit(id, e, { type: 'user.message', text });
    e.live.send(text);
    return 'ok';
  }
```

- [ ] **Step 2: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npm run typecheck`
Expected: sem erro em `shared`, `server` e `web` (web ainda não foi tocado nesta feature, deve continuar limpo).

- [ ] **Step 3: Build + restart**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && ./restart.sh && sleep 1.5 && cat /tmp/ccui.log`
Expected: sobe sem erro. Nenhuma mudança visível ainda (nenhum projeto tem `routing` ligado e o frontend não tem UI pra ligar — isso só confirma que o servidor não quebrou).

---

### Task 6: Frontend — estado (`reduce.ts`)

**Files:**
- Modify: `web/src/features/chat/reduce.ts`

**Interfaces:**
- Consumes: evento `model.routed` (Task 1/5).
- Produces: `Item` (`kind: 'user'`) ganha `routedModel?: Model`; `Chat.pendingRoutedModel?: Model`.

- [ ] **Step 1: Import e `Item`**

Ajuste o import do topo:

```ts
import { ZERO_TOTALS, type ClaudeEvent, type Model, type ModelUsage, type PendingPermission, type ServerMsg, type SessionState, type UsageTotals } from '@ccui/shared';
```

Troque a variante `user` de `Item`:

```ts
export type Item =
  | { kind: 'user'; text: string; routedModel?: Model }
  | { kind: 'assistant'; text: string; streaming?: boolean }
```

(mantenha as demais variantes como estão).

- [ ] **Step 2: `Chat.pendingRoutedModel`**

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
  pendingRoutedModel?: Model; // "prateleira" pro modelo escolhido; consumido pelo próximo user.message
}

export const emptyChat = (): Chat => ({ hydrated: false, items: [], state: 'idle', lastSeq: 0, totals: ZERO_TOTALS, pending: [], lastEventAt: Date.now(), tasks: [] });
```

(`emptyChat` não precisa setar `pendingRoutedModel` — fica `undefined` por omissão.)

- [ ] **Step 3: `applyEvent` — `model.routed` e `user.message`**

Troque o case `user.message` existente:

```ts
    case 'user.message':
      items.push({ kind: 'user', text: ev.text, routedModel: c.pendingRoutedModel });
      next.pendingRoutedModel = undefined;
      break;
```

E adicione, junto dos outros cases:

```ts
    case 'model.routed':
      next.pendingRoutedModel = ev.model;
      break;
```

- [ ] **Step 4: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npx tsc -p web`
Expected: sem erro.

---

### Task 7: Frontend — UI (`Chat.tsx`, `Sidebar.tsx`)

**Files:**
- Modify: `web/src/features/chat/Chat.tsx`
- Modify: `web/src/features/projects/Sidebar.tsx`

**Interfaces:**
- Consumes: `Item.routedModel`, `PendingPermission.toolName === 'request_model_upgrade'` (Task 6), `Project.routing` (Task 1).

- [ ] **Step 1: Tag de modelo roteado na bolha do usuário**

Em `web/src/features/chat/Chat.tsx`, troque o case `user` de `ItemView`:

```tsx
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
```

- [ ] **Step 2: Texto especial pro pedido de escalonamento**

Localize o bloco de `chat.pending.map(...)` e troque por:

```tsx
        {chat.pending.map((p) => (
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
```

- [ ] **Step 3: Toggle na sidebar**

Em `web/src/features/projects/Sidebar.tsx`, logo depois do botão `lean` (mesmo bloco, dentro do `<div className="flex items-center gap-1">` do projeto), adicione:

```tsx
                          <button
                            className={p.routing ? 'rounded bg-emerald-700 px-1.5 text-[10px] text-zinc-100' : 'hidden rounded border border-zinc-700 px-1.5 text-[10px] text-zinc-500 group-hover/p:block'}
                            title={`roteamento de modelo ${p.routing ? 'ligado' : 'desligado'}: escolhe Haiku ou Sonnet por mensagem pra economizar tokens. Clique para alternar.`}
                            onClick={async () => { await api.patchProject(p.id, { routing: !p.routing }); await reloadProjects(); }}
                          >rota</button>
```

- [ ] **Step 4: Verificar**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && npm run typecheck`
Expected: sem erro em nenhum dos três projetos.

---

### Task 8: Build, restart e verificação end-to-end manual

**Files:** nenhum (só validação).

- [ ] **Step 1: Build + restart**

Run: `cd /home/guilhermegranja/Guilherme/claude-code-ui && ./restart.sh && sleep 1.5 && cat /tmp/ccui.log`
Expected: build sem erro, log sem erro.

- [ ] **Step 2: Teste manual (você, no navegador)**

1. Na sidebar, passe o mouse sobre um projeto e clique no novo botão "rota" pra ligar o roteamento (fica destacado em verde).
2. Mande um prompt trivial (ex.: "o que faz a função X em arquivo Y"). Confira: tag `roteado → Haiku` acima da sua mensagem.
3. Mande um prompt complexo (ex.: "implementa uma feature de exportar CSV com testes"). Confira: tag `roteado → Sonnet 5`.
4. Mande um prompt na zona cinzenta (nem óbvio-trivial nem óbvio-complexo) e confirme que ainda funciona (não trava, escolhe um dos dois em poucos segundos a mais que o normal).
5. Force um caso de escalonamento: um prompt que pareça simples mas na prática exija bastante raciocínio (ex.: "corrige esse bug: <cole um stack trace real e complexo>"). Se o roteador mandar pra Haiku e o modelo perceber que precisa de mais, deve aparecer o pedido "Claude quer trocar pra Sonnet 5 — `<motivo>`" com os botões Permitir/Negar. Aprove e confirme que o resto do turno roda em Sonnet (compare o custo/tokens do resumo final do turno com o que apareceria em Haiku).
6. Desligue "rota" no projeto e confirme que o comportamento volta a ser idêntico a antes (sem tag, sem pedido de escalonamento, modelo sempre o padrão do projeto/sessão).

Se algo não bater: Task 2/3 = classificação errada ou timeout; Task 5 = evento não chega ou `setModel` não aplica; Task 6/7 = estado/UI do cliente.

---

## Self-Review (feito ao escrever este plano)

- **Cobertura do spec:** protocolo (Task 1), heurística (Task 2), classify+escalonamento no runtime (Task 3), resolução do flag por projeto (Task 4), wiring no ponto único de envio (Task 5), estado do cliente (Task 6), UI (Task 7), validação (Task 8) — cobre todas as seções do spec, incluindo os itens de "fora de escopo" (nenhum deles ganhou tarefa, como esperado).
- **Placeholders:** nenhum "TBD" — todo passo tem código completo, incluindo a heurística exata (regex) e o prompt do classificador.
- **Consistência de tipos:** `classify(cwd, text): Promise<Model>`, `setModel(model: Model): Promise<void>`, `routedModel?: Model`, `pendingRoutedModel?: Model` usados com o mesmo nome/assinatura em todas as tarefas que os tocam.

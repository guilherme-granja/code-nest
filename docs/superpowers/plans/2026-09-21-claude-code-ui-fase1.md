# Claude Code UI — Fase 1 (local) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Modelos:** subagentes SOMENTE com `model: "sonnet"` ou `"haiku"`. Nunca Opus ou superior.

**Goal:** UI web local (React + Node) que lista projetos/sessões do Claude Code, cria/retoma sessões e conversa com streaming e aprovação de permissões, rodando o Claude Code na própria máquina.

**Architecture:** Backend Node em `127.0.0.1` com um `SdkRuntime` (Agent SDK, `query()` em streaming input) parametrizado por um `Transport` (só `LocalTransport` na Fase 1). Um `SessionHub` mantém sessões vivas, buffer de eventos com `seq` e fan-out para clientes WebSocket. Persistência em 3 arquivos JSON atômicos. Frontend React/Zustand consome um contrato único (`ClaudeEvent`) definido em `shared/`.

**Tech Stack:** Node 24, TypeScript, npm workspaces, `@anthropic-ai/claude-agent-sdk`, `ws`, `hono` + `@hono/node-server`, `zod`, `tsx`; React 19, Vite, Tailwind v4, Zustand.

**Spec:** `docs/superpowers/specs/2026-09-21-claude-code-ui-design.md`

## Global Constraints

- Modelos permitidos no produto: `haiku`, `sonnet`; default `sonnet`. Opus/Fable rejeitados no backend. Effort: `low|medium|high`, default `medium`. `maxBudgetUsd` default `2`.
- `permissionMode` aceito: `default` e `plan`. `bypassPermissions`/`acceptEdits` rejeitados.
- Bind fixo em `127.0.0.1` (`CCUI_HOST` fora de `127.0.0.1`/`localhost` ⇒ recusa iniciar). Token aleatório por execução; validar `Host` e `Origin`; sem CORS.
- Nenhum texto livre do usuário em linha de comando. `spawn(bin, argsArray)`, nunca `shell: true`.
- Nunca logar token nem conteúdo de prompt/resposta.
- Dependências permitidas: as listadas no spec §14. Proibidas na Fase 1: `react-router`, SQLite, `ssh2`, `node-pty`, Socket.IO, Vitest.
- **Sem testes e sem git nesta etapa** (decisão do usuário; o diretório não é repositório). Onde o skill pede TDD/commit, este plano usa **typecheck + smoke manual** como verificação e não commita.
- Todos os comandos rodam a partir da raiz `/home/guilhermegranja/Guilherme/claude-code-ui`.
- Smokes com modelo real usam `haiku`, effort `low`, lean (custo de centavos).

## Desvios deliberados do spec (todos reduzem código)

1. `Transport` da Fase 1 = `{ spawn, isDirectory }`. `readFile`/`list` entram na Fase 2 (o SDK já lê o disco local).
2. Sem `GET /sessions/:id/history`: o histórico vai no `snapshot` do WebSocket.
3. `SessionMeta.name` é opcional e há `model?`/`effort?` (para retomar com as mesmas escolhas). O meta é criado ao criar a sessão ou ao abrir (`attach`) uma sessão do terminal.
4. `total_cost_usd` do SDK é tratado como **acumulado**; a UI mostra o total da sessão (não custo por turno). A hipótese é confirmada no smoke da Task 3.
5. Heartbeat WS: ping a cada 30 s; sem pong até o próximo ciclo ⇒ `terminate`.

## File Structure

```text
package.json  tsconfig.base.json
shared/   package.json tsconfig.json src/index.ts
server/   package.json tsconfig.json
  src/index.ts store.ts security.ts domain.ts hub.ts routes.ts ws.ts
  src/runtime/types.ts local-transport.ts events.ts sdk-runtime.ts
  scripts/smoke-runtime.ts smoke-ws.ts check-h1.mjs
web/      package.json tsconfig.json vite.config.ts index.html
  src/main.tsx index.css api.ts ws.ts store.ts
  src/app/App.tsx
  src/features/connect/ConnectScreen.tsx
  src/features/projects/Sidebar.tsx
  src/features/sessions/NewSessionModal.tsx
  src/features/chat/reduce.ts Chat.tsx
```

---

### Task 1: Workspace, tooling e contrato compartilhado

**Files:**
- Create: `package.json`, `tsconfig.base.json`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`
- Create: `server/package.json`, `server/tsconfig.json`
- Create: `web/package.json`, `web/tsconfig.json`

**Interfaces:**
- Produces (`@ccui/shared`): `MODELS`, `EFFORTS`, `Model`, `Effort`, `uuidSchema`, `Connection`, `Project`, `SessionMeta`, `Config`, `SessionRow`, `LOCAL`, `createProjectBody`, `patchProjectBody`, `createSessionBody`, `patchSessionBody`, `lastConnectionBody`, `SessionState`, `EventBody`, `ClaudeEvent`, `HistoryItem`, `PendingPermission`, `ClientMsg`, `ClientMsgT`, `ServerMsg`.

- [ ] **Step 1: Criar `package.json` raiz**

```json
{
  "name": "claude-code-ui",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "web"],
  "scripts": {
    "dev:server": "CCUI_TOKEN=dev-token-local CCUI_DEV_ORIGIN=http://localhost:5173 CCUI_NO_OPEN=1 tsx watch server/src/index.ts",
    "dev:web": "npm run dev -w web",
    "build": "npm run build -w web",
    "start": "tsx server/src/index.ts",
    "typecheck": "tsc -p shared && tsc -p server && tsc -p web"
  }
}
```

`CCUI_TOKEN` fixo existe **só** no script de dev (o `tsx watch` reinicia a cada save e um token aleatório invalidaria a aba). O `npm start` usa token aleatório.

- [ ] **Step 2: Criar `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 3: Criar os pacotes `shared`, `server`, `web`**

`shared/package.json`:
```json
{ "name": "@ccui/shared", "version": "0.0.0", "private": true, "type": "module", "main": "src/index.ts", "types": "src/index.ts" }
```
`shared/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "lib": ["ES2023"] }, "include": ["src"] }
```
`server/package.json`:
```json
{ "name": "@ccui/server", "version": "0.0.0", "private": true, "type": "module" }
```
`server/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "lib": ["ES2023"], "types": ["node"] }, "include": ["src", "scripts"] }
```
`web/package.json`:
```json
{ "name": "@ccui/web", "version": "0.0.0", "private": true, "type": "module", "scripts": { "dev": "vite", "build": "vite build" } }
```
`web/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "lib": ["ES2023", "DOM", "DOM.Iterable"], "jsx": "react-jsx", "types": ["vite/client"] }, "include": ["src", "vite.config.ts"] }
```

- [ ] **Step 4: Instalar dependências**

```bash
npm i -D typescript tsx
npm i -w shared zod
npm i -w server @anthropic-ai/claude-agent-sdk ws hono @hono/node-server
npm i -D -w server @types/node @types/ws
npm i -w web react react-dom zustand
npm i -D -w web vite @vitejs/plugin-react tailwindcss @tailwindcss/vite @types/react @types/react-dom
```
Expected: instala sem erro; `node_modules/@ccui/shared` é symlink para `shared/`.

- [ ] **Step 5: Criar `shared/src/index.ts`**

```ts
import { z } from 'zod';

export const MODELS = ['haiku', 'sonnet'] as const;
export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Model = (typeof MODELS)[number];
export type Effort = (typeof EFFORTS)[number];
export const modelSchema = z.enum(MODELS);
export const effortSchema = z.enum(EFFORTS);
export const uuidSchema = z.string().uuid();

export interface Connection { id: string; kind: 'local' | 'ssh'; target?: string; label: string }
export interface Project { id: string; name: string; connectionId: string; path: string; lean: boolean; model?: Model; effort?: Effort }
export interface SessionMeta { sessionId: string; projectId: string; name?: string; model?: Model; effort?: Effort; createdAt: number; lastUsedAt: number }
export interface Config {
  version: 1;
  lastConnectionId: string | null;
  defaults: { model: Model; effort: Effort; maxBudgetUsd: number };
  connections: Connection[];
}
export interface SessionRow { sessionId: string; name: string; lastModified: number; live: boolean }
export const LOCAL: Connection = { id: 'local', kind: 'local', label: 'Local' };

const name = (max: number) => z.string().trim().min(1).max(max);
export const createProjectBody = z.object({ name: name(80), path: z.string().min(1).max(1024), lean: z.boolean().default(false) });
export const patchProjectBody = z.object({ name: name(80).optional(), lean: z.boolean().optional(), model: modelSchema.optional(), effort: effortSchema.optional() });
export const createSessionBody = z.object({ name: name(120), model: modelSchema.optional(), effort: effortSchema.optional() });
export const patchSessionBody = z.object({ projectId: z.string().min(1), name: name(120) });
export const lastConnectionBody = z.object({ connectionId: z.string().min(1) });

// ---- eventos (contrato único entre backend e React) ----
export type SessionState = 'idle' | 'running' | 'awaiting_permission' | 'exited';
export interface PendingPermission { reqId: string; toolName: string; input: unknown }
export type EventBody =
  | { type: 'session.state'; state: SessionState }
  | { type: 'user.message'; text: string }
  | { type: 'message.delta'; text: string }
  | { type: 'message.completed'; text: string }
  | { type: 'tool.started'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool.result'; toolUseId: string; output: string; isError: boolean }
  | ({ type: 'permission.requested' } & PendingPermission)
  | { type: 'permission.resolved'; reqId: string; allow: boolean }
  | { type: 'turn.completed'; totalCostUsd: number; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }
  | { type: 'error'; code: 'runtime' | 'budget' | 'exit'; message: string };
export type ClaudeEvent = EventBody & { sessionId: string; seq: number; ts: number };
export interface HistoryItem { role: 'user' | 'assistant'; text: string }

// ---- protocolo WebSocket ----
export const ClientMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  z.object({ type: z.literal('attach'), sessionId: uuidSchema, projectId: z.string().min(1), afterSeq: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('detach'), sessionId: uuidSchema }),
  z.object({ type: z.literal('send'), sessionId: uuidSchema, text: z.string().min(1).max(200_000) }),
  z.object({ type: z.literal('interrupt'), sessionId: uuidSchema }),
  z.object({ type: z.literal('permission'), sessionId: uuidSchema, reqId: z.string().min(1), allow: z.boolean() }),
]);
export type ClientMsgT = z.infer<typeof ClientMsg>;

export type ServerMsg =
  | { type: 'ready' }
  | { type: 'snapshot'; sessionId: string; history: HistoryItem[]; state: SessionState; lastSeq: number; totalCostUsd: number; pending: PendingPermission[] }
  | { type: 'event'; event: ClaudeEvent }
  | { type: 'error'; code: string; message: string };
```

- [ ] **Step 6: Verificar**

Run: `npx tsc -p shared`
Expected: sem saída (sucesso).

---

### Task 2: Store JSON e segurança

**Files:**
- Create: `server/src/store.ts`, `server/src/security.ts`

**Interfaces:**
- Consumes: `LOCAL`, `Config`, `Project`, `SessionMeta` de `@ccui/shared`.
- Produces:
  - `DATA_DIR: string`; `class JsonFile<T> { data: T; static open<T>(file, defaults): Promise<JsonFile<T>>; save(): Promise<void> }`; `openStore(): Promise<Store>` onde `Store = { config: JsonFile<Config>; projects: JsonFile<{version:1;projects:Project[]}>; sessions: JsonFile<{version:1;sessions:SessionMeta[]}> }`.
  - `makeToken(): string`; `tokenOk(given: string|undefined, token: string): boolean`; `hostOriginOk(port: number, host?: string|null, origin?: string|null): boolean`; `guard(port: number, token: string): MiddlewareHandler`.

- [ ] **Step 1: Criar `server/src/store.ts`**

```ts
import { promises as fs, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { LOCAL, type Config, type Project, type SessionMeta } from '@ccui/shared';

export const DATA_DIR = process.env.CCUI_DATA_DIR ?? path.join(homedir(), '.claude-code-ui');

export class JsonFile<T> {
  private queue: Promise<void> = Promise.resolve();
  private constructor(private file: string, public data: T) {}

  static async open<T>(file: string, defaults: T): Promise<JsonFile<T>> {
    for (const f of [file, file + '.bak']) {
      try {
        const data = JSON.parse(await fs.readFile(f, 'utf8')) as T;
        if (f !== file) console.error(`[store] ${path.basename(file)} ausente/corrompido, restaurado de .bak`);
        return new JsonFile(file, data);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[store] falha ao ler ${path.basename(f)}`);
      }
    }
    return new JsonFile(file, defaults);
  }

  // escrita atômica (tmp + rename), serializada, com .bak do último estado bom
  save(): Promise<void> {
    const run = async () => {
      const tmp = this.file + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
      await fs.copyFile(this.file, this.file + '.bak').catch(() => {});
      await fs.rename(tmp, this.file);
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

// um backend por diretório de dados
async function acquireLock(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const lock = path.join(DATA_DIR, 'lock');
  for (let i = 0; i < 2; i++) {
    try {
      const h = await fs.open(lock, 'wx');
      await h.writeFile(String(process.pid));
      await h.close();
      process.on('exit', () => { try { unlinkSync(lock); } catch {} });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = Number(await fs.readFile(lock, 'utf8').catch(() => ''));
      if (pid && alive(pid)) throw new Error(`outro backend já está rodando (pid ${pid})`);
      await fs.unlink(lock).catch(() => {}); // lock velho
    }
  }
  throw new Error('não foi possível obter o lock');
}

export async function openStore() {
  await acquireLock();
  const p = (n: string) => path.join(DATA_DIR, n);
  return {
    config: await JsonFile.open<Config>(p('config.json'), {
      version: 1, lastConnectionId: null, defaults: { model: 'sonnet', effort: 'medium', maxBudgetUsd: 2 }, connections: [LOCAL],
    }),
    projects: await JsonFile.open<{ version: 1; projects: Project[] }>(p('projects.json'), { version: 1, projects: [] }),
    sessions: await JsonFile.open<{ version: 1; sessions: SessionMeta[] }>(p('sessions.json'), { version: 1, sessions: [] }),
  };
}
export type Store = Awaited<ReturnType<typeof openStore>>;
```

- [ ] **Step 2: Criar `server/src/security.ts`**

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export const makeToken = () => process.env.CCUI_TOKEN ?? randomBytes(32).toString('base64url');

export function tokenOk(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Host: bloqueia DNS rebinding. Origin: bloqueia páginas de outros sites (ausente = cliente não-browser, ainda precisa de token).
export function hostOriginOk(port: number, host?: string | null, origin?: string | null): boolean {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  if (process.env.CCUI_DEV_ORIGIN) origins.add(process.env.CCUI_DEV_ORIGIN);
  return !!host && hosts.has(host) && (!origin || origins.has(origin));
}

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*";

export function guard(port: number, token: string): MiddlewareHandler {
  return async (c, next) => {
    if (!hostOriginOk(port, c.req.header('host'), c.req.header('origin'))) return c.text('forbidden', 403);
    if (c.req.path.startsWith('/api/')) {
      const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
      if (!tokenOk(m?.[1], token)) return c.text('unauthorized', 401);
    }
    c.header('Content-Security-Policy', CSP);
    await next();
  };
}
```

- [ ] **Step 3: Verificar**

Run: `npx tsc -p server`
Expected: sem saída. (Se acusar arquivos ainda inexistentes, ignore: `src` só tem estes por ora.)

---

### Task 3: Runtime (SDK + LocalTransport) e verificação das hipóteses

**Files:**
- Create: `server/src/runtime/types.ts`, `server/src/runtime/local-transport.ts`, `server/src/runtime/events.ts`, `server/src/runtime/sdk-runtime.ts`
- Create: `server/scripts/smoke-runtime.ts`, `server/scripts/check-h1.mjs`

**Interfaces:**
- Consumes: `EventBody`, `HistoryItem`, `Model`, `Effort`, `MODELS`, `EFFORTS` de `@ccui/shared`; `DATA_DIR` de `../store`.
- Produces:
  - `Transport { spawn(o: SpawnOptions, onStderr: (s: string) => void): SpawnedProcess; isDirectory(p: string): Promise<boolean> }`
  - `OpenOptions { cwd; sessionId; model: Model; effort: Effort; lean: boolean; maxBudgetUsd: number; permissionMode: 'default'|'plan' }`
  - `LiveSession { send(text): void; interrupt(): Promise<void>; answerPermission(reqId, allow): void; close(): Promise<void>; events: AsyncIterable<EventBody> }`
  - `SessionInfo { sessionId; summary; customTitle?; firstPrompt?; lastModified }`
  - `ClaudeRuntime { listSessions(cwd): Promise<SessionInfo[]>; history(sessionId, cwd): Promise<HistoryItem[]>; open(o: OpenOptions): Promise<LiveSession> }`
  - `localTransport: Transport`, `reportOrphans(): void`, `class SdkRuntime implements ClaudeRuntime` (`new SdkRuntime(transport)`), `mapMessage(m: SDKMessage): EventBody[]`, `blockText(c: unknown): string`.

- [ ] **Step 1: Criar `server/src/runtime/types.ts`**

```ts
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import type { Effort, EventBody, HistoryItem, Model } from '@ccui/shared';

export interface Transport {
  spawn(o: SpawnOptions, onStderr: (chunk: string) => void): SpawnedProcess;
  isDirectory(path: string): Promise<boolean>;
}
export interface OpenOptions {
  cwd: string; sessionId: string; model: Model; effort: Effort; lean: boolean; maxBudgetUsd: number; permissionMode: 'default' | 'plan';
}
export interface LiveSession {
  send(text: string): void;
  interrupt(): Promise<void>;
  answerPermission(reqId: string, allow: boolean): void;
  close(): Promise<void>;
  events: AsyncIterable<EventBody>;
}
export interface SessionInfo { sessionId: string; summary: string; customTitle?: string; firstPrompt?: string; lastModified: number }
export interface ClaudeRuntime {
  listSessions(cwd: string): Promise<SessionInfo[]>;
  history(sessionId: string, cwd: string): Promise<HistoryItem[]>;
  open(o: OpenOptions): Promise<LiveSession>;
}
```

- [ ] **Step 2: Criar `server/src/runtime/local-transport.ts`**

```ts
import { spawn } from 'node:child_process';
import { promises as fs, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { DATA_DIR } from '../store';
import type { Transport } from './types';

const RUN_FILE = path.join(DATA_DIR, 'run.json');
const pids = new Set<number>();
const persist = () => { try { writeFileSync(RUN_FILE, JSON.stringify([...pids])); } catch {} };

// No startup: avisa (não mata) sobre `claude` deixado por um backend que morreu sem limpar.
// ponytail: só Linux (/proc). Outros SOs apenas não avisam.
export function reportOrphans(): void {
  let old: number[] = [];
  try { old = JSON.parse(readFileSync(RUN_FILE, 'utf8')); } catch { return; }
  for (const pid of old) {
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('claude')) console.warn(`[runtime] possível claude órfão do run anterior: pid ${pid} (não encerrado)`);
    } catch { /* já morreu */ }
  }
  persist();
}

export const localTransport: Transport = {
  spawn(o, onStderr) {
    // detached => grupo de processos próprio; kill(-pid) derruba o claude e filhos (ferramentas, MCP)
    const child = spawn(o.command, o.args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', onStderr);
    if (child.pid) { pids.add(child.pid); persist(); }
    child.on('exit', () => { if (child.pid) { pids.delete(child.pid); persist(); } });
    const kill = (sig: NodeJS.Signals) => { try { process.kill(-child.pid!, sig); return true; } catch { return false; } };
    o.signal.addEventListener('abort', () => kill('SIGKILL'), { once: true });
    return {
      stdin: child.stdin!,
      stdout: child.stdout!,
      get killed() { return child.killed; },
      get exitCode() { return child.exitCode; },
      get signalCode() { return child.signalCode; },
      kill,
      on: child.on.bind(child),
      once: child.once.bind(child),
      off: child.off.bind(child),
    } as unknown as SpawnedProcess;
  },
  async isDirectory(p) {
    try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
  },
};
```

- [ ] **Step 3: Criar `server/src/runtime/events.ts`** (única fronteira SDK → `EventBody`)

```ts
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { EventBody } from '@ccui/shared';

export const blockText = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b?.type === 'text' ? b.text : '')).join('') : '';

export function mapMessage(m: SDKMessage): EventBody[] {
  if ('parent_tool_use_id' in m && m.parent_tool_use_id) return []; // ruído de subagente
  switch (m.type) {
    case 'stream_event': {
      const e = m.event;
      return e.type === 'content_block_delta' && e.delta.type === 'text_delta' ? [{ type: 'message.delta', text: e.delta.text }] : [];
    }
    case 'assistant': {
      const out: EventBody[] = [];
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text) out.push({ type: 'message.completed', text: b.text });
        else if (b.type === 'tool_use') out.push({ type: 'tool.started', toolUseId: b.id, name: b.name, input: b.input });
      }
      return out;
    }
    case 'user': {
      const c = m.message.content;
      if (!Array.isArray(c)) return [];
      return c.flatMap((b) =>
        b.type === 'tool_result' ? [{ type: 'tool.result' as const, toolUseId: b.tool_use_id, output: blockText(b.content), isError: !!b.is_error }] : [],
      );
    }
    case 'result': {
      const u = m.usage;
      const out: EventBody[] = [{
        type: 'turn.completed', totalCostUsd: m.total_cost_usd,
        inputTokens: u.input_tokens, outputTokens: u.output_tokens,
        cacheCreationTokens: u.cache_creation_input_tokens, cacheReadTokens: u.cache_read_input_tokens,
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
    default:
      return []; // hooks, status, rate_limit, etc.
  }
}
```

- [ ] **Step 4: Criar `server/src/runtime/sdk-runtime.ts`**

```ts
import { randomUUID } from 'node:crypto';
import {
  getSessionInfo, getSessionMessages, listSessions, query,
  type CanUseTool, type PermissionResult, type Query, type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { EFFORTS, MODELS, type EventBody, type HistoryItem } from '@ccui/shared';
import { blockText, mapMessage } from './events';
import type { ClaudeRuntime, LiveSession, OpenOptions, SessionInfo, Transport } from './types';

const PERMISSION_TIMEOUT_MS = 10 * 60_000;

// fila assíncrona: produtor faz push, consumidor faz for-await
function channel<T>() {
  const q: T[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  return {
    push(v: T) { q.push(v); wake?.(); },
    end() { done = true; wake?.(); },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      while (true) {
        if (q.length) { yield q.shift()!; continue; }
        if (done) return;
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    },
  };
}

class Live implements LiveSession {
  private input = channel<SDKUserMessage>();
  private out = channel<EventBody>();
  readonly events: AsyncIterable<EventBody> = this.out;
  private pending = new Map<string, (allow: boolean, why?: string) => void>();
  private stderrTail = '';
  private q: Query;
  private pump: Promise<void>;

  private canUseTool: CanUseTool = (toolName, input, { signal }) =>
    new Promise<PermissionResult>((resolve) => {
      const reqId = randomUUID();
      const done = (allow: boolean, why?: string) => {
        if (!this.pending.delete(reqId)) return;
        clearTimeout(timer);
        this.out.push({ type: 'permission.resolved', reqId, allow });
        resolve(allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: why ?? 'Negado pelo usuário' });
      };
      const timer = setTimeout(() => done(false, 'Sem resposta em 10 min'), PERMISSION_TIMEOUT_MS);
      signal.addEventListener('abort', () => done(false, 'Cancelado'), { once: true });
      this.pending.set(reqId, done);
      this.out.push({ type: 'permission.requested', reqId, toolName, input });
    });

  constructor(o: OpenOptions, resume: boolean, transport: Transport) {
    this.q = query({
      prompt: this.input,
      options: {
        cwd: o.cwd,
        ...(resume ? { resume: o.sessionId } : { sessionId: o.sessionId }),
        model: o.model,
        effort: o.effort,
        maxBudgetUsd: o.maxBudgetUsd,
        permissionMode: o.permissionMode,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: o.lean ? [] : ['user', 'project', 'local'],
        includePartialMessages: true,
        canUseTool: this.canUseTool,
        spawnClaudeCodeProcess: (so) => transport.spawn(so, (s) => { this.stderrTail = (this.stderrTail + s).slice(-2000); }),
      },
    });
    this.pump = this.run();
  }

  private async run() {
    try {
      for await (const m of this.q) {
        // defesa em profundidade: a allowlist é aplicada em open(), aqui confere o modelo efetivo
        if (m.type === 'system' && m.subtype === 'init' && /opus|fable/i.test(m.model)) {
          this.out.push({ type: 'error', code: 'runtime', message: `modelo não permitido: ${m.model}` });
          this.q.close();
          break;
        }
        for (const b of mapMessage(m)) this.out.push(b);
      }
    } catch (e) {
      this.out.push({ type: 'error', code: 'exit', message: `${(e as Error).message}\n${this.stderrTail}`.trim() });
    } finally {
      for (const done of [...this.pending.values()]) done(false, 'Sessão encerrada');
      this.out.end();
    }
  }

  send(text: string) {
    this.input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
  }
  async interrupt() { await this.q.interrupt(); }
  answerPermission(reqId: string, allow: boolean) { this.pending.get(reqId)?.(allow); }

  // fecha stdin (EOF) => o claude sai sozinho; se não sair em 2 s, encerra à força
  async close() {
    this.input.end();
    const t = setTimeout(() => this.q.close(), 2000);
    await this.pump;
    clearTimeout(t);
  }
}

export class SdkRuntime implements ClaudeRuntime {
  constructor(private transport: Transport) {}

  async listSessions(cwd: string): Promise<SessionInfo[]> {
    const list = await listSessions({ dir: cwd });
    return list.map((s) => ({ sessionId: s.sessionId, summary: s.summary, customTitle: s.customTitle, firstPrompt: s.firstPrompt, lastModified: s.lastModified }));
  }

  async history(sessionId: string, cwd: string): Promise<HistoryItem[]> {
    let msgs: Awaited<ReturnType<typeof getSessionMessages>> = [];
    try { msgs = await getSessionMessages(sessionId, { dir: cwd }); } catch { /* sessão ainda sem jsonl */ }
    return msgs.flatMap((m): HistoryItem[] => {
      if (m.type === 'system') return [];
      const text = blockText((m.message as { content?: unknown } | null)?.content).trim();
      return text ? [{ role: m.type, text }] : [];
    });
  }

  async open(o: OpenOptions): Promise<LiveSession> {
    if (!MODELS.includes(o.model) || !EFFORTS.includes(o.effort)) throw new Error('modelo/effort não permitido');
    if (o.permissionMode !== 'default' && o.permissionMode !== 'plan') throw new Error('permissionMode não permitido');
    const exists = !!(await getSessionInfo(o.sessionId, { dir: o.cwd }));
    return new Live(o, exists, this.transport);
  }
}
```

- [ ] **Step 5: Criar `server/scripts/smoke-runtime.ts`**

```ts
// Smoke real (haiku, low, lean): 2 turnos no mesmo processo; o 2º pede permissão de Write e é negado.
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { localTransport } from '../src/runtime/local-transport';
import { SdkRuntime } from '../src/runtime/sdk-runtime';

const rt = new SdkRuntime(localTransport);
const live = await rt.open({ cwd: tmpdir(), sessionId: randomUUID(), model: 'haiku', effort: 'low', lean: true, maxBudgetUsd: 0.5, permissionMode: 'default' });
const prompts = ['diga apenas: um', 'crie o arquivo smoke.txt com o conteúdo abc usando a ferramenta Write'];
let turns = 0;
live.send(prompts[0]);
for await (const ev of live.events) {
  console.log(JSON.stringify(ev).slice(0, 220));
  if (ev.type === 'permission.requested') live.answerPermission(ev.reqId, false);
  if (ev.type === 'turn.completed') {
    turns++;
    if (turns < prompts.length) live.send(prompts[turns]);
    else await live.close();
  }
}
console.log('FIM');
```

- [ ] **Step 6: Criar `server/scripts/check-h1.mjs`** (hipótese H1: pai morto com SIGKILL ⇒ `claude` filho sai por EOF)

```js
import { spawn } from 'node:child_process';

if (process.argv[2] === 'parent') {
  const c = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--setting-sources', ''],
    { stdio: ['pipe', 'pipe', 'ignore'], detached: true });
  console.log(c.pid);
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000);
} else {
  const p = spawn(process.execPath, [new URL(import.meta.url).pathname, 'parent'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.on('exit', () => setTimeout(() => {
    const pid = Number(out.trim());
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    console.log(alive ? `H1 FALSA: claude (pid ${pid}) continua vivo` : `H1 CONFIRMADA: claude (pid ${pid}) saiu`);
    if (alive) process.kill(-pid, 'SIGKILL');
  }, 5000));
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc -p server`
Expected: sem erros. Se o TS reclamar de tipos do SDK (ex.: `m.event.delta` ou `m.message.content` em `events.ts`, ou `SpawnOptions`/`SpawnedProcess` não exportados), ajuste **só a anotação de tipo** conforme `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` mantendo a lógica.

- [ ] **Step 8: Smoke do runtime (usa modelo real, ~US$0,02)**

Run: `npx tsx server/scripts/smoke-runtime.ts`
Expected, nesta ordem: `message.delta`/`message.completed` com "um"; `turn.completed` (anote `totalCostUsd`); depois `tool.started` (Write); `permission.requested`; `permission.resolved` com `allow:false`; `turn.completed` com `totalCostUsd` **maior** que o do 1º turno (confirma "acumulado", desvio 4); `FIM`. Se o 2º `totalCostUsd` for menor ou igual ao delta esperado do turno, o valor é por turno: ajustar a UI (Task 7) para somar em vez de exibir.

- [ ] **Step 9: Verificar H1**

Run: `node server/scripts/check-h1.mjs`
Expected: `H1 CONFIRMADA: claude (pid N) saiu`. Se imprimir `H1 FALSA`, registre no spec (§3 hipótese H1 resolvida como falsa) e mantenha o `run.json` como única proteção contra órfãos; o kill de grupo no shutdown continua valendo.

---

### Task 4: SessionHub e domínio

**Files:**
- Create: `server/src/hub.ts`, `server/src/domain.ts`

**Interfaces:**
- Consumes: `ClaudeRuntime`, `LiveSession`, `OpenOptions` (Task 3); `Store` (Task 2); tipos de `@ccui/shared`.
- Produces:
  - `interface Client { send(m: ServerMsg): void; sessions: Set<string> }`; `type OpenSpec = Omit<OpenOptions,'sessionId'>`.
  - `class SessionHub { constructor(runtime: ClaudeRuntime, spec: (sessionId: string) => OpenSpec); isLive(id): boolean; attach(c: Client, id: string, afterSeq?: number): Promise<void>; detach(c, id): void; drop(c): void; send(id, text): Promise<'ok'|'busy'>; interrupt(id): Promise<void>; answerPermission(id, reqId, allow): void; shutdown(): Promise<void> }`.
  - `openSpecFor(store, sessionId): OpenSpec` (lança se desconhecida); `ensureMeta(store, sessionId, projectId): Promise<void>`; `touch(store, sessionId): void`; `listProjectSessions(store, runtime, hub, project): Promise<SessionRow[]>`.

- [ ] **Step 1: Criar `server/src/hub.ts`**

```ts
import type { ClaudeEvent, EventBody, PendingPermission, ServerMsg, SessionState } from '@ccui/shared';
import type { ClaudeRuntime, LiveSession, OpenOptions } from './runtime/types';

const BUFFER = 2000;
const INTERRUPT_GRACE_MS = 5000;

export interface Client { send(m: ServerMsg): void; sessions: Set<string> }
export type OpenSpec = Omit<OpenOptions, 'sessionId'>;

interface Entry {
  seq: number;
  buffer: ClaudeEvent[];
  state: SessionState;
  live: LiveSession | null;
  clients: Set<Client>;
  pending: Map<string, PendingPermission>;
  totalCostUsd: number;
}

export class SessionHub {
  private entries = new Map<string, Entry>();
  constructor(private runtime: ClaudeRuntime, private spec: (sessionId: string) => OpenSpec) {}

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { seq: 0, buffer: [], state: 'idle', live: null, clients: new Set(), pending: new Map(), totalCostUsd: 0 };
      this.entries.set(id, e);
    }
    return e;
  }

  isLive(id: string) { return !!this.entries.get(id)?.live; }

  async attach(c: Client, id: string, afterSeq?: number) {
    const cwd = this.spec(id).cwd; // lança se a sessão for desconhecida
    const e = this.entry(id);
    e.clients.add(c);
    c.sessions.add(id);
    const first = e.buffer[0]?.seq;
    const canReplay = afterSeq !== undefined && afterSeq <= e.seq && (afterSeq === e.seq || (first !== undefined && first <= afterSeq + 1));
    if (canReplay) {
      for (const ev of e.buffer) if (ev.seq > afterSeq!) c.send({ type: 'event', event: ev });
      return;
    }
    const history = await this.runtime.history(id, cwd);
    // estado lido DEPOIS do await: eventos emitidos durante a leitura já foram enviados a `c` e o cliente os ignora até hidratar
    c.send({ type: 'snapshot', sessionId: id, history, state: e.state, lastSeq: e.seq, totalCostUsd: e.totalCostUsd, pending: [...e.pending.values()] });
  }

  detach(c: Client, id: string) { this.entries.get(id)?.clients.delete(c); c.sessions.delete(id); }
  drop(c: Client) { for (const id of c.sessions) this.entries.get(id)?.clients.delete(c); c.sessions.clear(); }

  async send(id: string, text: string): Promise<'ok' | 'busy'> {
    const spec = this.spec(id);
    const e = this.entry(id);
    if (e.state === 'running' || e.state === 'awaiting_permission') return 'busy';
    this.setState(id, e, 'running'); // reserva antes do await para não abrir dois processos
    if (!e.live) {
      try {
        e.live = await this.runtime.open({ ...spec, sessionId: id });
      } catch (err) {
        this.emit(id, e, { type: 'error', code: 'runtime', message: (err as Error).message });
        this.setState(id, e, 'idle');
        return 'ok';
      }
      void this.pump(id, e, e.live);
    }
    this.emit(id, e, { type: 'user.message', text });
    e.live.send(text);
    return 'ok';
  }

  private async pump(id: string, e: Entry, live: LiveSession) {
    for await (const b of live.events) this.emit(id, e, b);
    e.live = null;
    e.pending.clear();
    this.setState(id, e, 'exited');
  }

  async interrupt(id: string) {
    const e = this.entries.get(id);
    const live = e?.live;
    if (!e || !live) return;
    await live.interrupt().catch(() => {});
    // sem sair de running em 5 s => encerra o processo (a sessão continua retomável)
    setTimeout(() => {
      if (e.live === live && (e.state === 'running' || e.state === 'awaiting_permission')) void live.close();
    }, INTERRUPT_GRACE_MS);
  }

  answerPermission(id: string, reqId: string, allow: boolean) {
    this.entries.get(id)?.live?.answerPermission(reqId, allow);
  }

  async shutdown() {
    await Promise.all([...this.entries.values()].map((e) => e.live?.close()));
  }

  private emit(id: string, e: Entry, body: EventBody) {
    const ev = { ...body, sessionId: id, seq: ++e.seq, ts: Date.now() } as ClaudeEvent;
    e.buffer.push(ev);
    if (e.buffer.length > BUFFER) e.buffer.shift();
    for (const c of e.clients) c.send({ type: 'event', event: ev });
    switch (body.type) {
      case 'permission.requested':
        e.pending.set(body.reqId, { reqId: body.reqId, toolName: body.toolName, input: body.input });
        this.setState(id, e, 'awaiting_permission');
        break;
      case 'permission.resolved':
        e.pending.delete(body.reqId);
        if (e.pending.size === 0 && e.state === 'awaiting_permission') this.setState(id, e, 'running');
        break;
      case 'turn.completed':
        e.totalCostUsd = body.totalCostUsd;
        this.setState(id, e, 'idle');
        break;
    }
  }

  private setState(id: string, e: Entry, s: SessionState) {
    if (e.state === s) return;
    e.state = s;
    this.emit(id, e, { type: 'session.state', state: s });
  }
}
```

- [ ] **Step 2: Criar `server/src/domain.ts`**

```ts
import type { Project, SessionRow } from '@ccui/shared';
import type { OpenSpec, SessionHub } from './hub';
import type { ClaudeRuntime } from './runtime/types';
import type { Store } from './store';

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
    maxBudgetUsd: d.maxBudgetUsd,
    permissionMode: 'default',
  };
}

// sessões vindas do terminal ganham uma linha de meta ao serem abertas pela UI
export async function ensureMeta(store: Store, sessionId: string, projectId: string) {
  if (store.sessions.data.sessions.some((s) => s.sessionId === sessionId)) return;
  if (!store.projects.data.projects.some((p) => p.id === projectId)) throw new Error('projeto desconhecido');
  const now = Date.now();
  store.sessions.data.sessions.push({ sessionId, projectId, createdAt: now, lastUsedAt: now });
  await store.sessions.save();
}

export function touch(store: Store, sessionId: string) {
  const m = store.sessions.data.sessions.find((s) => s.sessionId === sessionId);
  if (m) { m.lastUsedAt = Date.now(); void store.sessions.save(); }
}

// união: disco (terminal + UI) ∪ metas da UI ainda sem jsonl
export async function listProjectSessions(store: Store, runtime: ClaudeRuntime, hub: SessionHub, project: Project): Promise<SessionRow[]> {
  const disk = await runtime.listSessions(project.path).catch(() => []);
  const metas = new Map(store.sessions.data.sessions.filter((s) => s.projectId === project.id).map((m) => [m.sessionId, m]));
  const rows = new Map<string, SessionRow>();
  for (const d of disk) {
    rows.set(d.sessionId, {
      sessionId: d.sessionId,
      name: metas.get(d.sessionId)?.name ?? d.customTitle ?? d.summary ?? d.firstPrompt ?? '(sem título)',
      lastModified: d.lastModified,
      live: hub.isLive(d.sessionId),
    });
  }
  for (const m of metas.values()) {
    if (!rows.has(m.sessionId)) rows.set(m.sessionId, { sessionId: m.sessionId, name: m.name ?? '(sem título)', lastModified: m.lastUsedAt, live: hub.isLive(m.sessionId) });
  }
  return [...rows.values()].sort((a, b) => b.lastModified - a.lastModified);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p server`
Expected: sem erros.

---

### Task 5: HTTP (REST + estáticos), WebSocket e entrypoint

**Files:**
- Create: `server/src/routes.ts`, `server/src/ws.ts`, `server/src/index.ts`
- Create: `server/scripts/smoke-ws.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–4.
- Produces: `buildApi(d: { store: Store; runtime: ClaudeRuntime; hub: SessionHub; transport: Transport }): Hono` (montado em `/api`); `attachWs(server: http.Server, o: { port; token; hub; store })`. Endpoints: `GET /api/state`, `POST /api/last-connection`, `POST /api/projects`, `PATCH|DELETE /api/projects/:id`, `GET|POST /api/projects/:id/sessions`, `PATCH /api/sessions/:id`.

- [ ] **Step 1: Criar `server/src/routes.ts`**

```ts
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  createProjectBody, createSessionBody, lastConnectionBody, patchProjectBody, patchSessionBody, uuidSchema,
  type Project, type SessionMeta,
} from '@ccui/shared';
import { ensureMeta, listProjectSessions } from './domain';
import type { SessionHub } from './hub';
import type { ClaudeRuntime, Transport } from './runtime/types';
import type { Store } from './store';

interface Deps { store: Store; runtime: ClaudeRuntime; hub: SessionHub; transport: Transport }

const body = async <T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T> | null> => {
  const r = schema.safeParse(await c.req.json().catch(() => null));
  return r.success ? r.data : null;
};

export function buildApi({ store, runtime, hub, transport }: Deps) {
  const api = new Hono();
  const projects = () => store.projects.data.projects;
  const project = (id: string) => projects().find((p) => p.id === id);
  const bad = (c: Context, msg: string) => c.json({ error: msg }, 400);

  api.get('/state', (c) => c.json({ config: store.config.data, projects: projects() }));

  api.post('/last-connection', async (c) => {
    const b = await body(c, lastConnectionBody);
    if (!b || !store.config.data.connections.some((x) => x.id === b.connectionId)) return bad(c, 'conexão inválida');
    store.config.data.lastConnectionId = b.connectionId;
    await store.config.save();
    return c.body(null, 204);
  });

  api.post('/projects', async (c) => {
    const b = await body(c, createProjectBody);
    if (!b) return bad(c, 'dados inválidos');
    if (!path.isAbsolute(b.path)) return bad(c, 'o caminho deve ser absoluto');
    const p = path.resolve(b.path);
    if (!(await transport.isDirectory(p))) return bad(c, 'diretório não encontrado');
    if (projects().some((x) => x.connectionId === 'local' && x.path === p)) return c.json({ error: 'projeto já cadastrado' }, 409);
    const created: Project = { id: randomUUID(), name: b.name, connectionId: 'local', path: p, lean: b.lean };
    projects().push(created);
    await store.projects.save();
    return c.json(created);
  });

  api.patch('/projects/:id', async (c) => {
    const p = project(c.req.param('id'));
    const b = await body(c, patchProjectBody);
    if (!p || !b) return bad(c, 'dados inválidos');
    Object.assign(p, b);
    await store.projects.save();
    return c.json(p);
  });

  // remove só metadata nossa; nunca toca no jsonl do Claude
  api.delete('/projects/:id', async (c) => {
    const id = c.req.param('id');
    store.projects.data.projects = projects().filter((p) => p.id !== id);
    store.sessions.data.sessions = store.sessions.data.sessions.filter((s) => s.projectId !== id);
    await Promise.all([store.projects.save(), store.sessions.save()]);
    return c.body(null, 204);
  });

  api.get('/projects/:id/sessions', async (c) => {
    const p = project(c.req.param('id'));
    if (!p) return c.json({ error: 'projeto desconhecido' }, 404);
    return c.json(await listProjectSessions(store, runtime, hub, p));
  });

  api.post('/projects/:id/sessions', async (c) => {
    const p = project(c.req.param('id'));
    const b = await body(c, createSessionBody);
    if (!p || !b) return bad(c, 'dados inválidos');
    const now = Date.now();
    const meta: SessionMeta = { sessionId: randomUUID(), projectId: p.id, name: b.name, model: b.model, effort: b.effort, createdAt: now, lastUsedAt: now };
    store.sessions.data.sessions.push(meta);
    await store.sessions.save();
    return c.json(meta);
  });

  api.patch('/sessions/:id', async (c) => {
    const id = uuidSchema.safeParse(c.req.param('id'));
    const b = await body(c, patchSessionBody);
    if (!id.success || !b) return bad(c, 'dados inválidos');
    try { await ensureMeta(store, id.data, b.projectId); } catch (e) { return bad(c, (e as Error).message); }
    store.sessions.data.sessions.find((s) => s.sessionId === id.data)!.name = b.name;
    await store.sessions.save();
    return c.body(null, 204);
  });

  return api;
}
```

- [ ] **Step 2: Criar `server/src/ws.ts`**

```ts
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { ClientMsg } from '@ccui/shared';
import { ensureMeta, touch } from './domain';
import type { Client, SessionHub } from './hub';
import { hostOriginOk, tokenOk } from './security';
import type { Store } from './store';

const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };

export function attachWs(server: Server, o: { port: number; token: string; hub: SessionHub; store: Store }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url !== '/ws' || !hostOriginOk(o.port, req.headers.host, req.headers.origin)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    let authed = false;
    let alive = true;
    const client: Client = { sessions: new Set(), send: (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); } };
    const authTimer = setTimeout(() => { if (!authed) ws.close(4401, 'auth'); }, 5000);
    // ponytail: 1 ciclo sem pong derruba; se houver falso positivo em redes lentas, tolerar 2 ciclos
    const hb = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 30_000);
    ws.on('pong', () => { alive = true; });

    ws.on('message', async (raw) => {
      const parsed = ClientMsg.safeParse(safeJson(raw.toString()));
      if (!parsed.success) return client.send({ type: 'error', code: 'bad_request', message: 'mensagem inválida' });
      const m = parsed.data;
      if (m.type === 'auth') {
        if (tokenOk(m.token, o.token)) { authed = true; clearTimeout(authTimer); client.send({ type: 'ready' }); } else ws.close(4401, 'auth');
        return;
      }
      if (!authed) return ws.close(4401, 'auth');
      try {
        switch (m.type) {
          case 'attach':
            await ensureMeta(o.store, m.sessionId, m.projectId);
            await o.hub.attach(client, m.sessionId, m.afterSeq);
            break;
          case 'detach': o.hub.detach(client, m.sessionId); break;
          case 'send':
            touch(o.store, m.sessionId);
            if ((await o.hub.send(m.sessionId, m.text)) === 'busy') client.send({ type: 'error', code: 'busy', message: 'sessão ocupada' });
            break;
          case 'interrupt': await o.hub.interrupt(m.sessionId); break;
          case 'permission': o.hub.answerPermission(m.sessionId, m.reqId, m.allow); break;
        }
      } catch (e) {
        client.send({ type: 'error', code: 'runtime', message: (e as Error).message });
      }
    });

    ws.on('close', () => { clearInterval(hb); clearTimeout(authTimer); o.hub.drop(client); });
  });
}
```

- [ ] **Step 3: Criar `server/src/index.ts`**

```ts
import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { openSpecFor } from './domain';
import { SessionHub } from './hub';
import { buildApi } from './routes';
import { localTransport, reportOrphans } from './runtime/local-transport';
import { SdkRuntime } from './runtime/sdk-runtime';
import { guard, makeToken } from './security';
import { openStore } from './store';
import { attachWs } from './ws';

const PORT = Number(process.env.CCUI_PORT ?? 4317);
const HOST = process.env.CCUI_HOST ?? '127.0.0.1';
if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
  console.error(`recusado: CCUI_HOST=${HOST} não é loopback`);
  process.exit(1);
}

const store = await openStore();
reportOrphans();
const runtime = new SdkRuntime(localTransport);
const hub = new SessionHub(runtime, (id) => openSpecFor(store, id));
const token = makeToken();

const app = new Hono();
app.use('*', guard(PORT, token));
app.route('/api', buildApi({ store, runtime, hub, transport: localTransport }));
app.use('/*', serveStatic({ root: './web/dist' }));

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }) as Server;
server.on('error', (e) => { console.error(`[server] ${e.message}`); process.exit(1); });
attachWs(server, { port: PORT, token, hub, store });

const url = `${process.env.CCUI_DEV_ORIGIN ?? `http://127.0.0.1:${PORT}`}/#token=${token}`;
console.log(`Claude Code UI: ${url}`);
// ponytail: só Linux/macOS
if (!process.env.CCUI_NO_OPEN) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await hub.shutdown().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
```

- [ ] **Step 4: Criar `server/scripts/smoke-ws.ts`**

```ts
// Smoke ponta a ponta do backend: REST + WS + reattach com replay. Requer o backend rodando com CCUI_TOKEN=t.
import WebSocket from 'ws';

const base = 'http://127.0.0.1:4317';
const H = { Authorization: 'Bearer t', 'Content-Type': 'application/json' };
const j = async (m: string, u: string, b?: unknown) => {
  const r = await fetch(base + u, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  return r.status === 204 ? null : r.json();
};
const p = await j('POST', '/api/projects', { name: 'smoke', path: '/tmp', lean: true });
const s = await j('POST', `/api/projects/${p.id}/sessions`, { name: 'smoke', model: 'haiku', effort: 'low' });
const connect = (onMsg: (m: any) => void) => {
  const ws = new WebSocket('ws://127.0.0.1:4317/ws', { headers: { Origin: base } });
  ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 't' })));
  ws.on('message', (d) => onMsg(JSON.parse(String(d))));
  return ws;
};
const out = (tag: string, m: unknown) => console.log(tag, JSON.stringify(m).slice(0, 170));
const a = connect((m) => {
  out('A', m);
  if (m.type === 'ready') a.send(JSON.stringify({ type: 'attach', sessionId: s.sessionId, projectId: p.id }));
  if (m.type === 'snapshot') a.send(JSON.stringify({ type: 'send', sessionId: s.sessionId, text: 'diga apenas: um' }));
  if (m.type === 'event' && m.event.type === 'turn.completed') {
    a.close();
    const b = connect((m2) => {
      out('B', m2);
      if (m2.type === 'ready') b.send(JSON.stringify({ type: 'attach', sessionId: s.sessionId, projectId: p.id, afterSeq: 0 }));
    });
    setTimeout(async () => { b.close(); await j('DELETE', `/api/projects/${p.id}`); process.exit(0); }, 2000);
  }
});
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: `shared`, `server` sem erros (`web` ainda não tem `src`; se `tsc -p web` falhar por "no inputs", ignore até a Task 6).

- [ ] **Step 6: Smoke de segurança (sem custo de modelo)**

Run:
```bash
CCUI_NO_OPEN=1 CCUI_TOKEN=t CCUI_DATA_DIR=/tmp/ccui-smoke npm start &
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4317/api/state
curl -s -H 'Authorization: Bearer t' http://127.0.0.1:4317/api/state
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.com' -H 'Authorization: Bearer t' http://127.0.0.1:4317/api/state
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: http://evil.com' -H 'Authorization: Bearer t' http://127.0.0.1:4317/api/state
```
Expected, na ordem: `401`; JSON com `config` e `projects: []`; `403`; `403`.

- [ ] **Step 7: Smoke ponta a ponta do backend (modelo real, ~US$0,01)** — com o backend do passo 6 ainda rodando

Run: `npx tsx server/scripts/smoke-ws.ts`
Expected: `A {"type":"ready"}`, `A {"type":"snapshot",...}`, eventos `A` com `session.state` running, `user.message`, `message.delta`…, `turn.completed`, `session.state` idle. Depois `B ready` e `B` recebendo o replay dos eventos com `seq > 0`.

- [ ] **Step 8: Verificar encerramento limpo**

Run: `kill %1; sleep 3; pgrep -af 'stream-json' || echo "sem órfãos"; rm -rf /tmp/ccui-smoke`
Expected: `sem órfãos`.

---

### Task 6: Frontend — base (Vite, Tailwind, API, WS, store, reducer)

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`
- Create: `web/src/main.tsx`, `web/src/index.css`, `web/src/api.ts`, `web/src/ws.ts`, `web/src/store.ts`
- Create: `web/src/features/chat/reduce.ts`

**Interfaces:**
- Consumes: tipos e `ClientMsgT`, `ServerMsg` de `@ccui/shared`; endpoints da Task 5.
- Produces:
  - `api.ts`: `initToken(): string | null`, `getToken()`, `api.{state,setConnection,addProject,patchProject,delProject,sessions,newSession,rename}`.
  - `ws.ts`: `createSocket(h: { onMsg(m: ServerMsg): void; onStatus(up: boolean): void; onReady(): void }): { send(m: ClientMsgT): void; close(): void }`.
  - `reduce.ts`: `Item`, `Chat`, `emptyChat()`, `applySnapshot(s)`, `applyEvent(c, ev)`, `addError(c, text)`.
  - `store.ts`: `useApp` com `{ tokenMissing, up, config, projects, rows, active, chats, start(), reloadProjects(), refreshRows(pid), open(pid, sid), send(text), interrupt(), answer(reqId, allow), chooseLocal() }`.

- [ ] **Step 1: Criar `web/index.html`, `web/vite.config.ts`, `web/src/index.css`, `web/src/main.tsx`**

`web/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Code UI</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
`web/vite.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:4317', ws: true, changeOrigin: true },
    },
  },
});
```
`web/src/index.css`:
```css
@import "tailwindcss";
```
`web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './index.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 2: Criar `web/src/api.ts`**

```ts
import type { Config, Effort, Model, Project, SessionRow } from '@ccui/shared';

const KEY = 'ccui-token';
let token: string | null = null;
export const getToken = () => token;

// o token chega em #token=… (fragmento não vai em logs nem Referer); guarda em memória + sessionStorage e limpa a URL
export function initToken(): string | null {
  const m = /token=([^&]+)/.exec(location.hash);
  if (m) {
    token = decodeURIComponent(m[1]);
    try { sessionStorage.setItem(KEY, token); } catch {}
    history.replaceState(null, '', location.pathname);
  } else {
    try { token = sessionStorage.getItem(KEY); } catch {}
  }
  return token;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.status === 204 ? (undefined as T) : r.json();
}

export const api = {
  state: () => req<{ config: Config; projects: Project[] }>('GET', '/api/state'),
  setConnection: (connectionId: string) => req<void>('POST', '/api/last-connection', { connectionId }),
  addProject: (b: { name: string; path: string; lean: boolean }) => req<Project>('POST', '/api/projects', b),
  patchProject: (id: string, b: Partial<Pick<Project, 'name' | 'lean' | 'model' | 'effort'>>) => req<Project>('PATCH', `/api/projects/${id}`, b),
  delProject: (id: string) => req<void>('DELETE', `/api/projects/${id}`),
  sessions: (pid: string) => req<SessionRow[]>('GET', `/api/projects/${pid}/sessions`),
  newSession: (pid: string, b: { name: string; model?: Model; effort?: Effort }) => req<{ sessionId: string }>('POST', `/api/projects/${pid}/sessions`, b),
  rename: (sid: string, projectId: string, name: string) => req<void>('PATCH', `/api/sessions/${sid}`, { projectId, name }),
};
```

- [ ] **Step 3: Criar `web/src/ws.ts`**

```ts
import type { ClientMsgT, ServerMsg } from '@ccui/shared';
import { getToken } from './api';

interface Handlers { onMsg(m: ServerMsg): void; onStatus(up: boolean): void; onReady(): void }

export function createSocket(h: Handlers) {
  let ws: WebSocket | null = null;
  let delay = 500;
  let closed = false;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => ws!.send(JSON.stringify({ type: 'auth', token: getToken() }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as ServerMsg;
      if (m.type === 'ready') { delay = 500; h.onStatus(true); h.onReady(); } else h.onMsg(m);
    };
    ws.onclose = () => {
      h.onStatus(false);
      if (!closed) setTimeout(open, (delay = Math.min(delay * 2, 5000)));
    };
  };
  open();
  return {
    send: (m: ClientMsgT) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    close() { closed = true; ws?.close(); },
  };
}
```

- [ ] **Step 4: Criar `web/src/features/chat/reduce.ts`**

```ts
import type { ClaudeEvent, PendingPermission, ServerMsg, SessionState } from '@ccui/shared';

export type Item =
  | { kind: 'user' | 'assistant'; text: string; streaming?: boolean }
  | { kind: 'tool'; toolUseId: string; name: string; input: unknown; output?: string; isError?: boolean }
  | { kind: 'error'; text: string };

export interface Chat {
  hydrated: boolean;
  items: Item[];
  state: SessionState;
  lastSeq: number;
  totalCostUsd: number;
  lastTokens?: { input: number; output: number; cacheCreation: number; cacheRead: number };
  pending: PendingPermission[];
  lastEventAt: number;
}

export const emptyChat = (): Chat => ({ hydrated: false, items: [], state: 'idle', lastSeq: 0, totalCostUsd: 0, pending: [], lastEventAt: Date.now() });

export function applySnapshot(s: Extract<ServerMsg, { type: 'snapshot' }>): Chat {
  return {
    hydrated: true,
    items: s.history.map((h) => ({ kind: h.role, text: h.text })),
    state: s.state,
    lastSeq: s.lastSeq,
    totalCostUsd: s.totalCostUsd,
    pending: s.pending,
    lastEventAt: Date.now(),
  };
}

export const addError = (c: Chat, text: string): Chat => ({ ...c, items: [...c.items, { kind: 'error', text }] });

// eventos antes do snapshot ou já vistos (seq <= lastSeq) são ignorados: dedupe na reconexão
export function applyEvent(c: Chat, ev: ClaudeEvent): Chat {
  if (!c.hydrated || ev.seq <= c.lastSeq) return c;
  const items = c.items.slice();
  const last = items[items.length - 1];
  const next: Chat = { ...c, items, lastSeq: ev.seq, lastEventAt: ev.ts };
  switch (ev.type) {
    case 'user.message':
      items.push({ kind: 'user', text: ev.text });
      break;
    case 'message.delta':
      if (last?.kind === 'assistant' && last.streaming) items[items.length - 1] = { ...last, text: last.text + ev.text };
      else items.push({ kind: 'assistant', text: ev.text, streaming: true });
      break;
    case 'message.completed':
      if (last?.kind === 'assistant' && last.streaming) items[items.length - 1] = { kind: 'assistant', text: ev.text };
      else items.push({ kind: 'assistant', text: ev.text });
      break;
    case 'tool.started':
      items.push({ kind: 'tool', toolUseId: ev.toolUseId, name: ev.name, input: ev.input });
      break;
    case 'tool.result': {
      const i = items.findIndex((x) => x.kind === 'tool' && x.toolUseId === ev.toolUseId);
      if (i >= 0) items[i] = { ...(items[i] as Extract<Item, { kind: 'tool' }>), output: ev.output, isError: ev.isError };
      break;
    }
    case 'permission.requested':
      next.pending = [...c.pending, { reqId: ev.reqId, toolName: ev.toolName, input: ev.input }];
      break;
    case 'permission.resolved':
      next.pending = c.pending.filter((p) => p.reqId !== ev.reqId);
      break;
    case 'session.state':
      next.state = ev.state;
      break;
    case 'turn.completed':
      next.totalCostUsd = ev.totalCostUsd;
      next.lastTokens = { input: ev.inputTokens, output: ev.outputTokens, cacheCreation: ev.cacheCreationTokens, cacheRead: ev.cacheReadTokens };
      break;
    case 'error':
      items.push({ kind: 'error', text: ev.message });
      break;
  }
  return next;
}
```

- [ ] **Step 5: Criar `web/src/store.ts`**

```ts
import { create } from 'zustand';
import type { Config, Project, ServerMsg, SessionRow } from '@ccui/shared';
import { api, initToken } from './api';
import { addError, applyEvent, applySnapshot, emptyChat, type Chat } from './features/chat/reduce';
import { createSocket } from './ws';

interface App {
  tokenMissing: boolean;
  up: boolean;
  config: Config | null;
  projects: Project[];
  rows: Record<string, SessionRow[]>;
  active: { projectId: string; sessionId: string } | null;
  chats: Record<string, Chat>;
  start(): Promise<void>;
  reloadProjects(): Promise<void>;
  refreshRows(projectId: string): Promise<void>;
  open(projectId: string, sessionId: string): void;
  send(text: string): void;
  interrupt(): void;
  answer(reqId: string, allow: boolean): void;
  chooseLocal(): Promise<void>;
}

let sock: ReturnType<typeof createSocket> | null = null;
const attached = new Map<string, string>(); // sessionId -> projectId (re-attach ao reconectar)

export const useApp = create<App>((set, get) => {
  const attach = (sessionId: string, projectId: string) => {
    const c = get().chats[sessionId];
    sock?.send({ type: 'attach', sessionId, projectId, afterSeq: c?.hydrated ? c.lastSeq : undefined });
  };
  const handle = (m: ServerMsg) => {
    if (m.type === 'snapshot') set((s) => ({ chats: { ...s.chats, [m.sessionId]: applySnapshot(m) } }));
    else if (m.type === 'event') {
      const id = m.event.sessionId;
      set((s) => (s.chats[id] ? { chats: { ...s.chats, [id]: applyEvent(s.chats[id], m.event) } } : s));
    } else if (m.type === 'error') {
      const a = get().active;
      if (a) set((s) => ({ chats: { ...s.chats, [a.sessionId]: addError(s.chats[a.sessionId] ?? emptyChat(), m.message) } }));
    }
  };

  return {
    tokenMissing: false, up: false, config: null, projects: [], rows: {}, active: null, chats: {},

    async start() {
      if (!initToken()) return set({ tokenMissing: true });
      await get().reloadProjects();
      sock = createSocket({
        onMsg: handle,
        onStatus: (up) => set({ up }),
        onReady: () => attached.forEach((pid, sid) => attach(sid, pid)),
      });
      // ponytail: polling de 10 s para o indicador de sessão viva e novas sessões do terminal; trocar por push se pesar
      setInterval(() => get().projects.forEach((p) => void get().refreshRows(p.id)), 10_000);
    },

    async reloadProjects() {
      const { config, projects } = await api.state();
      set({ config, projects });
      await Promise.all(projects.map((p) => get().refreshRows(p.id)));
    },

    async refreshRows(projectId) {
      const rows = await api.sessions(projectId).catch(() => null);
      if (rows) set((s) => ({ rows: { ...s.rows, [projectId]: rows } }));
    },

    open(projectId, sessionId) {
      attached.set(sessionId, projectId);
      set((s) => ({ active: { projectId, sessionId }, chats: s.chats[sessionId] ? s.chats : { ...s.chats, [sessionId]: emptyChat() } }));
      attach(sessionId, projectId);
    },

    send(text) {
      const a = get().active;
      if (a) sock?.send({ type: 'send', sessionId: a.sessionId, text });
    },
    interrupt() {
      const a = get().active;
      if (a) sock?.send({ type: 'interrupt', sessionId: a.sessionId });
    },
    answer(reqId, allow) {
      const a = get().active;
      if (a) sock?.send({ type: 'permission', sessionId: a.sessionId, reqId, allow });
    },

    async chooseLocal() {
      await api.setConnection('local');
      await get().reloadProjects();
    },
  };
});
```

- [ ] **Step 6: Verificar**

Run: `npx tsc -p web`
Expected: erro apenas por `./app/App` inexistente (`main.tsx`). Tudo o mais sem erros; resolvido na Task 7.

---

### Task 7: Frontend — telas (conexão, sidebar, nova sessão, chat)

**Files:**
- Create: `web/src/app/App.tsx`
- Create: `web/src/features/connect/ConnectScreen.tsx`
- Create: `web/src/features/projects/Sidebar.tsx`
- Create: `web/src/features/sessions/NewSessionModal.tsx`
- Create: `web/src/features/chat/Chat.tsx`

**Interfaces:**
- Consumes: `useApp`, `api`, `Chat`/`Item` (Task 6).
- Produces: `App` (default do `main.tsx`), `ConnectScreen`, `Sidebar({ onNewSession })`, `NewSessionModal({ onClose })`, `Chat()`.

- [ ] **Step 1: Criar `web/src/features/connect/ConnectScreen.tsx`**

```tsx
import { useApp } from '../../store';

export function ConnectScreen() {
  const chooseLocal = useApp((s) => s.chooseLocal);
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-96 space-y-4">
        <h1 className="text-center text-2xl font-semibold">Claude Code UI</h1>
        <p className="text-center text-zinc-400">Onde deseja executar o Claude?</p>
        <button onClick={chooseLocal} className="w-full rounded-lg border border-zinc-700 p-4 text-left hover:border-zinc-500">
          <div className="font-medium">Local</div>
          <div className="text-sm text-zinc-400">Executar nesta máquina</div>
        </button>
        <button disabled className="w-full cursor-not-allowed rounded-lg border border-zinc-800 p-4 text-left opacity-50">
          <div className="font-medium">Servidor remoto</div>
          <div className="text-sm text-zinc-400">Conectar via SSH — Fase 2</div>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar `web/src/features/projects/Sidebar.tsx`**

```tsx
import { useState } from 'react';
import { api } from '../../api';
import { useApp } from '../../store';

const ago = (t: number) => {
  const s = (t - Date.now()) / 1000, a = Math.abs(s);
  const f = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  return a < 3600 ? f.format(Math.round(s / 60), 'minute') : a < 86400 ? f.format(Math.round(s / 3600), 'hour') : f.format(Math.round(s / 86400), 'day');
};

export function Sidebar({ onNewSession }: { onNewSession: () => void }) {
  const { projects, rows, active, open, reloadProjects, refreshRows } = useApp();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', path: '', lean: false });
  const [err, setErr] = useState('');

  const addProject = async () => {
    try {
      await api.addProject(form);
      setForm({ name: '', path: '', lean: false });
      setAdding(false);
      setErr('');
      await reloadProjects();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <aside className="flex h-screen w-72 flex-col border-r border-zinc-800">
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <div className="text-xs font-semibold tracking-wide text-zinc-500">PROJETOS</div>
        {projects.map((p) => (
          <div key={p.id}>
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate font-medium" title={p.path}>{p.name}</span>
              <label className="flex items-center gap-1 text-xs text-zinc-500" title="lean: ignora hooks/plugins/skills/MCP/CLAUDE.md do usuário (~80% mais barato ao iniciar)">
                <input type="checkbox" checked={p.lean} onChange={async (e) => { await api.patchProject(p.id, { lean: e.target.checked }); await reloadProjects(); }} />
                lean
              </label>
              <button className="text-zinc-600 hover:text-red-400" title="Remover projeto (não apaga sessões do Claude)"
                onClick={async () => { if (confirm(`Remover "${p.name}" da lista?`)) { await api.delProject(p.id); await reloadProjects(); } }}>✕</button>
            </div>
            <ul className="mt-1 space-y-0.5">
              {(rows[p.id] ?? []).map((r) => (
                <li key={r.sessionId}>
                  <button
                    onClick={() => open(p.id, r.sessionId)}
                    onDoubleClick={async () => {
                      const name = prompt('Novo nome da sessão', r.name);
                      if (name) { await api.rename(r.sessionId, p.id, name); await refreshRows(p.id); }
                    }}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-zinc-900 ${active?.sessionId === r.sessionId ? 'bg-zinc-800' : ''}`}
                    title="Duplo clique para renomear"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${r.live ? 'bg-green-500' : 'bg-zinc-600'}`} />
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{ago(r.lastModified)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {adding ? (
          <div className="space-y-2 rounded border border-zinc-800 p-2 text-sm">
            <input className="w-full rounded bg-zinc-900 px-2 py-1" placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="w-full rounded bg-zinc-900 px-2 py-1" placeholder="/caminho/absoluto" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
            <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={form.lean} onChange={(e) => setForm({ ...form, lean: e.target.checked })} /> lean</label>
            {err && <div className="text-xs text-red-400">{err}</div>}
            <div className="flex gap-2">
              <button className="rounded bg-zinc-100 px-2 py-1 text-zinc-900" onClick={addProject}>Adicionar</button>
              <button className="px-2 py-1 text-zinc-400" onClick={() => { setAdding(false); setErr(''); }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="text-sm text-zinc-400 hover:text-zinc-200" onClick={() => setAdding(true)}>+ Novo projeto</button>
        )}
      </div>
      <button className="m-3 rounded bg-zinc-100 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40" disabled={!projects.length} onClick={onNewSession}>+ Nova sessão</button>
    </aside>
  );
}
```

- [ ] **Step 3: Criar `web/src/features/sessions/NewSessionModal.tsx`**

```tsx
import { useState } from 'react';
import { EFFORTS, MODELS, type Effort, type Model } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';

export function NewSessionModal({ onClose }: { onClose: () => void }) {
  const { projects, config, active, open, refreshRows } = useApp();
  const [pid, setPid] = useState(active?.projectId ?? projects[0]?.id ?? '');
  const [name, setName] = useState('Nova sessão');
  const [model, setModel] = useState<Model>(config!.defaults.model);
  const [effort, setEffort] = useState<Effort>(config!.defaults.effort);
  const [err, setErr] = useState('');

  const create = async () => {
    try {
      const s = await api.newSession(pid, { name, model, effort });
      await refreshRows(pid);
      open(pid, s.sessionId);
      onClose();
    } catch (e) { setErr((e as Error).message); }
  };
  const field = 'w-full rounded bg-zinc-900 px-2 py-1.5';

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-96 space-y-3 rounded-lg border border-zinc-700 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">Nova sessão</h2>
        <label className="block text-sm text-zinc-400">Projeto
          <select className={field} value={pid} onChange={(e) => setPid(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block text-sm text-zinc-400">Nome
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1 text-sm text-zinc-400">Modelo
            <select className={field} value={model} onChange={(e) => setModel(e.target.value as Model)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label className="block flex-1 text-sm text-zinc-400">Effort
            <select className={field} value={effort} onChange={(e) => setEffort(e.target.value as Effort)}>{EFFORTS.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
        </div>
        {err && <div className="text-sm text-red-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="px-3 py-1.5 text-zinc-400" onClick={onClose}>Cancelar</button>
          <button className="rounded bg-zinc-100 px-3 py-1.5 font-medium text-zinc-900" onClick={create}>Criar</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Criar `web/src/features/chat/Chat.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../store';
import type { Item } from './reduce';

const STUCK_MS = 60_000;
const badge: Record<string, string> = {
  idle: 'bg-zinc-700', running: 'bg-blue-600', awaiting_permission: 'bg-amber-600', exited: 'bg-zinc-800',
};
const json = (v: unknown) => JSON.stringify(v, null, 2)?.slice(0, 2000) ?? '';

function ItemView({ it }: { it: Item }) {
  if (it.kind === 'user') return <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-lg bg-zinc-800 px-3 py-2">{it.text}</div>;
  if (it.kind === 'assistant') return <div className="whitespace-pre-wrap">{it.text}</div>;
  if (it.kind === 'error') return <div className="whitespace-pre-wrap rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{it.text}</div>;
  return (
    <details className="rounded border border-zinc-800 px-3 py-1 text-sm text-zinc-400">
      <summary className="cursor-pointer">{it.name}{it.output === undefined ? ' …' : it.isError ? ' (erro)' : ''}</summary>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs">{json(it.input)}</pre>
      {it.output !== undefined && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap border-t border-zinc-800 pt-1 text-xs">{it.output.slice(0, 4000)}</pre>}
    </details>
  );
}

export function Chat() {
  const { active, chats, rows, up, send, interrupt, answer } = useApp();
  const chat = active ? chats[active.sessionId] : undefined;
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat?.items, chat?.pending.length]);

  if (!active || !chat) return <div className="flex h-screen flex-1 items-center justify-center text-zinc-500">Selecione ou crie uma sessão</div>;

  const name = rows[active.projectId]?.find((r) => r.sessionId === active.sessionId)?.name ?? 'Sessão';
  const busy = chat.state === 'running' || chat.state === 'awaiting_permission';
  const stuck = chat.state === 'running' && now - chat.lastEventAt > STUCK_MS;
  const submit = () => { const t = text.trim(); if (t && !busy && up) { send(t); setText(''); } };

  return (
    <main className="flex h-screen flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <h1 className="flex-1 truncate font-medium">{name}</h1>
        {!up && <span className="text-xs text-red-400">desconectado…</span>}
        <span className="text-xs text-zinc-400" title={chat.lastTokens ? `último turno: in ${chat.lastTokens.input} / out ${chat.lastTokens.output} / cache+ ${chat.lastTokens.cacheCreation} / cache↺ ${chat.lastTokens.cacheRead}` : ''}>
          ${chat.totalCostUsd.toFixed(4)}
        </span>
        <span className={`rounded px-2 py-0.5 text-xs ${badge[chat.state]}`}>{chat.state}</span>
        {busy && <button className="rounded border border-zinc-600 px-2 py-0.5 text-xs hover:bg-zinc-800" onClick={interrupt}>Interromper</button>}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {chat.items.map((it, i) => <ItemView key={i} it={it} />)}
        {chat.pending.map((p) => (
          <div key={p.reqId} className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm">
            <div className="font-medium">Permitir <code>{p.toolName}</code>?</div>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-zinc-300">{json(p.input)}</pre>
            <div className="mt-2 flex gap-2">
              <button className="rounded bg-green-700 px-3 py-1" onClick={() => answer(p.reqId, true)}>Permitir</button>
              <button className="rounded bg-zinc-700 px-3 py-1" onClick={() => answer(p.reqId, false)}>Negar</button>
            </div>
          </div>
        ))}
        {stuck && <div className="text-xs text-amber-400">Sem atividade há {Math.round((now - chat.lastEventAt) / 1000)} s. Use Interromper se necessário.</div>}
        <div ref={end} />
      </div>

      <div className="border-t border-zinc-800 p-3">
        <textarea
          className="h-24 w-full resize-none rounded bg-zinc-900 p-2 outline-none disabled:opacity-50"
          placeholder={busy ? 'Aguarde a resposta…' : 'Digite sua mensagem… (Enter envia, Shift+Enter quebra linha)'}
          value={text}
          disabled={busy || !up}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Criar `web/src/app/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ConnectScreen } from '../features/connect/ConnectScreen';
import { Chat } from '../features/chat/Chat';
import { Sidebar } from '../features/projects/Sidebar';
import { NewSessionModal } from '../features/sessions/NewSessionModal';
import { useApp } from '../store';

export function App() {
  const { tokenMissing, config, start } = useApp();
  const [modal, setModal] = useState(false);
  useEffect(() => { void start(); }, [start]);

  if (tokenMissing) return <div className="p-8 text-zinc-300">Abra a UI pelo link impresso no terminal (<code>Claude Code UI: http://…/#token=…</code>).</div>;
  if (!config) return <div className="p-8 text-zinc-500">Carregando…</div>;
  if (!config.lastConnectionId) return <ConnectScreen />;
  return (
    <div className="flex h-screen">
      <Sidebar onNewSession={() => setModal(true)} />
      <Chat />
      {modal && <NewSessionModal onClose={() => setModal(false)} />}
    </div>
  );
}
```

`start()` chama `initToken()` a cada execução; em `StrictMode` (dev) roda duas vezes: a 2ª lê do `sessionStorage`, e `setInterval`/`createSocket` duplicados só ocorrem em dev. Se incomodar: proteger com `let started = false` em `store.ts`.

- [ ] **Step 6: Typecheck geral**

Run: `npm run typecheck`
Expected: sem erros nos três projetos.

---

### Task 8: Build, execução e verificação ponta a ponta

**Files:** nenhum novo.

- [ ] **Step 1: Build do frontend**

Run: `npm run build`
Expected: `web/dist` gerado sem erros.

- [ ] **Step 2: Subir o backend em modo produção**

Run: `npm start`
Expected: imprime `Claude Code UI: http://127.0.0.1:4317/#token=…` e abre o navegador nessa URL.

- [ ] **Step 3: Checklist manual (haiku para economizar)**

1. Tela inicial: card **Local** clicável, **Servidor remoto** desabilitado. Clicar Local.
2. **+ Novo projeto**: nome e caminho absoluto de um repositório seu; marcar **lean**. Sessões existentes do terminal aparecem agrupadas com 🟢/⚪ (bolinha verde só se viva).
3. **+ Nova sessão**: modelo `haiku`, effort `low`. Enviar `diga apenas: oi`. A resposta aparece progressivamente; o custo no header muda; estado passa por `running` → `idle`.
4. Enviar `crie /tmp/ccui-teste.txt com o conteúdo abc usando Write`. Aparece o **card de permissão**; **Permitir** cria o arquivo (`cat /tmp/ccui-teste.txt`); repetir e **Negar** mostra o Claude reagindo à negativa.
5. **Interromper** durante uma resposta longa: estado volta a `idle`.
6. **F5** com a resposta em andamento: a conversa reaparece (snapshot + replay) sem duplicar texto.
7. Fechar a aba e reabrir pelo link do terminal: histórico carregado do jsonl, sem gastar tokens até enviar mensagem.
8. Duplo clique no nome da sessão: renomear; o nome persiste (`~/.claude-code-ui/sessions.json`) e a lista atualiza.
9. Abrir uma sessão criada no terminal: histórico aparece; enviar mensagem retoma com `--resume`.
10. `Ctrl+C` no backend: `pgrep -af stream-json || echo "sem órfãos"` ⇒ `sem órfãos`.
11. Segurança: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4317/api/state` ⇒ `401`. `CCUI_HOST=0.0.0.0 npm start` ⇒ `recusado: CCUI_HOST=0.0.0.0 não é loopback`.
12. Modelo: em `~/.claude-code-ui/sessions.json` trocar o `model` de uma sessão para `"opus"` e enviar mensagem ⇒ erro `modelo/effort não permitido` (allowlist ativa).

- [ ] **Step 4: Atualizar o spec com os resultados**

Em `docs/superpowers/specs/2026-09-21-claude-code-ui-design.md` §3, marcar H1 como confirmada/falsa (resultado do `check-h1.mjs`) e registrar o resultado do smoke de `totalCostUsd` (acumulado vs por turno).

---

## Self-Review (feita pelo autor do plano)

**Cobertura do spec (Fase 1):**
- §2 arquitetura/`Transport`/`ClaudeRuntime`/`LiveSession` → Tasks 3, 4 (desvio 1 documentado).
- §3 integração (SDK, `spawnClaudeCodeProcess`, `resume`/`sessionId`) → Task 3; H1 → Task 3 Step 9.
- §4 protocolo WS/REST, `attach` sem gasto, spawn no primeiro `send`, heartbeat, limite 1 MB → Tasks 4, 5 (desvios 2 e 5).
- §5 runtime local (detached, kill de grupo, EOF, `run.json`, SIGINT/SIGTERM) → Tasks 3, 5.
- §7 modelo de dados, união de sessões, renomear só na UI, status 🟢/⚪, remover projeto sem tocar no jsonl → Tasks 4, 5, 7.
- §8 persistência (atômica, `.bak`, lock, `version`) → Task 2.
- §9 política de modelo (allowlist no backend + checagem do modelo efetivo no `init`, effort, lean, custo visível, `maxBudgetUsd`) → Tasks 3, 4, 7.
- §10 segurança (loopback, token, Host/Origin, CSP, sem shell, zod nas bordas, enums, XSS por texto) → Tasks 2, 5, 7. Regras de SSH ficam para a Fase 2.
- §11 falhas: exit, stuck (aviso + Interromper + grace de 5 s), WS caiu, backend encerrado, `busy`, permissão sem cliente (auto-nega em 10 min), budget → Tasks 3, 4, 7.
- §12 MVP: tela Local/Remoto (Remoto desabilitado), sidebar, modal, lean, chat streaming, cards de ferramenta e permissão, Interromper, badge, custo → Task 7.

**Placeholder scan:** sem TBD/TODO; os únicos pontos condicionais são ajustes de anotação de tipo do SDK (Task 3 Step 7) e o critério de decisão sobre custo acumulado (Step 8), ambos com instrução exata.

**Consistência de tipos:** `EventBody`/`ClaudeEvent`/`ServerMsg`/`ClientMsgT` definidos na Task 1 e usados sem alteração nas Tasks 3–7; `OpenSpec`/`OpenOptions` alinhados entre `hub.ts`, `domain.ts` e `types.ts`; `PendingPermission` idêntico em snapshot, hub e reducer; `turn.completed.totalCostUsd` usado igual em `events.ts`, `hub.ts` e `reduce.ts`.

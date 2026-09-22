# Claude Code UI — Fase 2 (SSH) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (execução inline, decisão do usuário) ou superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> **Modelos:** subagentes SOMENTE `sonnet` ou `haiku`. Nunca Opus ou superior.

**Goal:** Executar e gerenciar o Claude Code numa máquina remota via SSH com a mesma UI da Fase 1: conexões remotas, projetos remotos, sessões com streaming, listagem/histórico remotos, status da conexão e recuperação após queda.

**Architecture:** O `SdkRuntime` da Fase 1 continua único; o `Transport` passa a encapsular tudo o que difere entre local e remoto (spawn, listagem, histórico, existência e espera de sessão). `SshTransport` usa o binário `ssh` do sistema (`BatchMode`, `ControlMaster`) e o `claude` remoto por caminho absoluto. Um registro `Connections` cria runtime/transport por conexão e monitora o status. O `SessionHub` resolve o runtime por sessão e, após queda de SSH, espera o `claude` remoto terminar o turno e reenvia o histórico completo.

**Tech Stack:** o da Fase 1. **Nenhuma dependência nova.**

**Specs:** `docs/superpowers/specs/2026-09-21-claude-code-ui-design.md` (§3 H2–H5, §6, §10, §11) · Fase 1: `docs/superpowers/plans/2026-09-21-claude-code-ui-fase1.md`

## Global Constraints

- Modelos do produto: `haiku`/`sonnet` (allowlist da Fase 1 inalterada). Smokes com modelo real: Haiku, `low`, lean.
- **Nenhuma variável de ambiente é encaminhada ao remoto.** O remoto usa o próprio ambiente e login. O `env` do SDK contém tokens locais.
- Comandos locais: `spawn('ssh', argsArray)`, nunca `shell: true`. O único texto interpretado por shell é o comando remoto, montado **só** com: `claudePath` validado, `cwd` e args entre aspas simples (`shq`), UUID validado por regex.
- Target SSH: regex `^(?!-)[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$`, sempre precedido de `--`. Sem senha (`BatchMode=yes`); `StrictHostKeyChecking` padrão. Nenhuma chave/senha armazenada.
- Opções SSH fixas: `-T`, `BatchMode=yes`, `ConnectTimeout=10`, `ServerAliveInterval=15`, `ServerAliveCountMax=3`, `ControlMaster=auto`, `ControlPersist=60`, `ControlPath=<DATA_DIR>/ctl/%C`.
- `claudePath` default `$HOME/.local/bin/claude`; nunca depender do `PATH` remoto (confirmado: `~/.local/bin` não está no PATH do ssh não-interativo).
- Escopo remoto: Linux (`stat -c`, `pgrep`, `tail`, `head`). Shell de login do usuário remoto deve aceitar `cd X && exec Y` (bash/zsh/sh/fish ≥3).
- Codificação de `cwd` do diretório de projetos do Claude: `cwd.replace(/[^A-Za-z0-9]/g, '-')` (confirmada em host real; caminhos muito longos não testados).
- Nunca logar token nem conteúdo de prompt/resposta.
- **Sem testes e sem git** (decisão do usuário). Verificação = typecheck + scripts de smoke.
- Smokes remotos: alvo `SSH_TARGET=guilhermegranja@192.168.15.43`. Só podem criar/remover `/tmp/ccui-smoke-ssh*` e o diretório de projeto correspondente em `~/.claude/projects/` no remoto. Nada mais.
- Todos os comandos rodam a partir de `/home/guilhermegranja/Guilherme/claude-code-ui`.

## Desvios deliberados

1. Sem novo estado `disconnected` em `SessionState`: queda de SSH aparece como `exited` + `error` (`exit`) + `connection.status`. Menos superfície.
2. Nome exibido de sessão remota: nome da UI ou primeiro prompt (o `summary` do SDK só existe localmente).
3. Sem endpoint de edição de conexão nem encerramento de sessões vivas ao remover conexão (Fase 3).
4. O aviso de versão (H5) compara `major.minor` do CLI remoto com `claudeCodeVersion` declarado no `package.json` do SDK.

## File Structure

```text
shared/src/index.ts                     (modify)  Connection.claudePath, ConnStatus, bodies, ServerMsg
server/src/ssh-util.ts                  (create)  validators, shq, encodeCwd, sshArgv, runSsh, ping, checkConnection
server/src/runtime/types.ts             (modify)  Transport ampliado, ClaudeRuntime.settle
server/src/runtime/child.ts             (create)  spawnManaged + reportOrphans (extraídos)
server/src/runtime/local-transport.ts   (modify)  usa child.ts; list/history/exists do SDK local
server/src/runtime/sdk-runtime.ts       (modify)  delega ao Transport; settle; espera antes de resume
server/src/runtime/jsonl.ts             (create)  parseHistory, firstPrompt
server/src/runtime/ssh-transport.ts     (create)  SshTransport
server/src/connections.ts               (create)  registro por conexão + monitor + versão
server/src/hub.ts                       (modify)  runtimeFor, recover após queda
server/src/domain.ts                    (modify)  connectionIdFor
server/src/routes.ts, ws.ts, index.ts   (modify)  conexões, projetos remotos, status
server/scripts/check-ssh-helpers.ts smoke-ssh.ts smoke-ssh-drop.ts   (create)
web/src/api.ts store.ts                 (modify)
web/src/features/connect/ServerForm.tsx (create)
web/src/features/connect/ConnectScreen.tsx, projects/Sidebar.tsx, chat/Chat.tsx (modify)
```

---

### Task 1: Refatorar o `Transport` (sem mudar comportamento local)

**Files:**
- Modify: `server/src/runtime/types.ts`, `server/src/runtime/local-transport.ts`, `server/src/runtime/sdk-runtime.ts`
- Create: `server/src/runtime/child.ts`

**Interfaces:**
- Produces:
  - `Transport { spawn(o, onStderr): SpawnedProcess; isDirectory(p): Promise<boolean>; listSessions(cwd): Promise<SessionInfo[]>; history(sessionId, cwd): Promise<HistoryItem[]>; sessionExists(sessionId, cwd): Promise<boolean>; waitSessionIdle(sessionId, timeoutMs): Promise<void> }`
  - `ClaudeRuntime` ganha `settle(sessionId, cwd): Promise<void>`.
  - `spawnManaged(cmd: string, args: string[], opts: { cwd?: string; env: NodeJS.ProcessEnv; signal: AbortSignal }, onStderr: (s: string) => void): SpawnedProcess`; `reportOrphans(): void` (em `child.ts`; `local-transport.ts` re-exporta `reportOrphans` para o `index.ts` não mudar).

- [ ] **Step 1: Substituir `server/src/runtime/types.ts`**

```ts
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import type { Effort, EventBody, HistoryItem, Model } from '@ccui/shared';

export interface SessionInfo { sessionId: string; summary: string; customTitle?: string; firstPrompt?: string; lastModified: number }

// Tudo o que difere entre rodar o Claude local ou remoto.
export interface Transport {
  spawn(o: SpawnOptions, onStderr: (chunk: string) => void): SpawnedProcess;
  isDirectory(path: string): Promise<boolean>;
  listSessions(cwd: string): Promise<SessionInfo[]>;
  history(sessionId: string, cwd: string): Promise<HistoryItem[]>;
  sessionExists(sessionId: string, cwd: string): Promise<boolean>;
  /** espera não haver `claude` ativo para a sessão (remoto: turno terminando após queda de SSH). Lança no timeout. */
  waitSessionIdle(sessionId: string, timeoutMs: number): Promise<void>;
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
export interface ClaudeRuntime {
  listSessions(cwd: string): Promise<SessionInfo[]>;
  history(sessionId: string, cwd: string): Promise<HistoryItem[]>;
  open(o: OpenOptions): Promise<LiveSession>;
  /** após uma queda: espera o claude da sessão terminar (não lança) */
  settle(sessionId: string, cwd: string): Promise<void>;
}
```

- [ ] **Step 2: Criar `server/src/runtime/child.ts`** (código movido de `local-transport.ts`)

```ts
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { DATA_DIR } from '../store';

const RUN_FILE = path.join(DATA_DIR, 'run.json');
const pids = new Set<number>();
const persist = () => { try { writeFileSync(RUN_FILE, JSON.stringify([...pids])); } catch {} };

// No startup: avisa (não mata) sobre `claude`/`ssh` deixado por um backend que morreu sem limpar.
// ponytail: só Linux (/proc). Outros SOs apenas não avisam.
export function reportOrphans(): void {
  let old: number[] = [];
  try { old = JSON.parse(readFileSync(RUN_FILE, 'utf8')); } catch { return; }
  for (const pid of old) {
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('claude')) console.warn(`[runtime] possível processo órfão do run anterior: pid ${pid} (não encerrado)`);
    } catch { /* já morreu */ }
  }
  persist();
}

// detached => grupo de processos próprio; kill(-pid) derruba o processo e filhos
export function spawnManaged(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env: NodeJS.ProcessEnv; signal: AbortSignal },
  onStderr: (chunk: string) => void,
): SpawnedProcess {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', onStderr);
  if (child.pid) { pids.add(child.pid); persist(); }
  child.on('exit', () => { if (child.pid) { pids.delete(child.pid); persist(); } });
  const kill = (sig: NodeJS.Signals) => { try { process.kill(-child.pid!, sig); return true; } catch { return false; } };
  opts.signal.addEventListener('abort', () => kill('SIGKILL'), { once: true });
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
}
```

- [ ] **Step 3: Substituir `server/src/runtime/local-transport.ts`**

```ts
import { promises as fs } from 'node:fs';
import { getSessionInfo, getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { HistoryItem } from '@ccui/shared';
import { spawnManaged } from './child';
import { blockText } from './events';
import type { Transport } from './types';

export { reportOrphans } from './child';

export const localTransport: Transport = {
  spawn: (o, onStderr) => spawnManaged(o.command, o.args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, signal: o.signal }, onStderr),

  async isDirectory(p) {
    try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
  },

  async listSessions(cwd) {
    const list = await listSessions({ dir: cwd });
    return list.map((s) => ({ sessionId: s.sessionId, summary: s.summary, customTitle: s.customTitle, firstPrompt: s.firstPrompt, lastModified: s.lastModified }));
  },

  async history(sessionId, cwd) {
    let msgs: Awaited<ReturnType<typeof getSessionMessages>> = [];
    try { msgs = await getSessionMessages(sessionId, { dir: cwd }); } catch { /* sessão ainda sem jsonl */ }
    return msgs.flatMap((m): HistoryItem[] => {
      if (m.type === 'system') return [];
      const text = blockText((m.message as { content?: unknown } | null)?.content).trim();
      return text ? [{ role: m.type, text }] : [];
    });
  },

  async sessionExists(sessionId, cwd) {
    return !!(await getSessionInfo(sessionId, { dir: cwd }));
  },

  async waitSessionIdle() { /* local: o processo é nosso e já terminou */ },
};
```

- [ ] **Step 4: Editar `server/src/runtime/sdk-runtime.ts`**

Substituir o bloco de imports do topo por:
```ts
import { randomUUID } from 'node:crypto';
import { query, type CanUseTool, type PermissionResult, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { EFFORTS, MODELS, type EventBody, type HistoryItem } from '@ccui/shared';
import { mapMessage } from './events';
import type { ClaudeRuntime, LiveSession, OpenOptions, SessionInfo, Transport } from './types';
```
e substituir a classe `SdkRuntime` inteira (do `export class SdkRuntime` até o fim do arquivo) por:
```ts
const IDLE_WAIT_MS = 30_000;

export class SdkRuntime implements ClaudeRuntime {
  constructor(private transport: Transport) {}

  listSessions(cwd: string): Promise<SessionInfo[]> { return this.transport.listSessions(cwd); }
  history(sessionId: string, cwd: string): Promise<HistoryItem[]> { return this.transport.history(sessionId, cwd); }

  async settle(sessionId: string): Promise<void> {
    await this.transport.waitSessionIdle(sessionId, IDLE_WAIT_MS).catch(() => {});
  }

  async open(o: OpenOptions): Promise<LiveSession> {
    if (!MODELS.includes(o.model) || !EFFORTS.includes(o.effort)) throw new Error('modelo/effort não permitido');
    if (o.permissionMode !== 'default' && o.permissionMode !== 'plan') throw new Error('permissionMode não permitido');
    const exists = await this.transport.sessionExists(o.sessionId, o.cwd);
    // remoto: um claude antigo pode estar terminando o turno; dois escritores no mesmo jsonl corromperiam o histórico
    if (exists) await this.transport.waitSessionIdle(o.sessionId, IDLE_WAIT_MS);
    return new Live(o, exists, this.transport);
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^npm notice\|^> \|^$"; echo "exit=${pipestatus[1]}"`
Expected: `exit=0`. (`hub.ts` e `routes.ts` continuam compilando: `ClaudeRuntime` só ganhou um método que `SdkRuntime` implementa.)

- [ ] **Step 6: Regressão do runtime local (Haiku, ~US$0,02)**

Run: `timeout 150 npx tsx server/scripts/smoke-runtime.ts 2>&1 | grep -v "^npm notice" | cut -c1-140`
Expected: mesma sequência da Fase 1: `message.delta`/`message.completed` "um", `turn.completed`, `tool.started` Write, `permission.requested`, `permission.resolved` `allow:false`, segundo `turn.completed` com custo maior, `FIM`.

---

### Task 2: Helpers SSH (validação, quoting, execução) com script de verificação

**Files:**
- Create: `server/src/ssh-util.ts`, `server/scripts/check-ssh-helpers.ts`

**Interfaces:**
- Consumes: `DATA_DIR` de `./store`.
- Produces:
  - `TARGET_RE`, `validTarget(s): boolean`, `DEFAULT_CLAUDE_PATH`, `validClaudePath(s): boolean`, `claudeExpr(p): string` (palavra de shell já entre aspas duplas), `shq(s): string`, `encodeCwd(cwd): string`, `SESSION_ID_RE`.
  - `sshArgv(target, remoteCmd): string[]`; `runSsh(target, remoteCmd, o?: { timeoutMs?: number }): Promise<{ code: number | null; stdout: string; stderr: string }>`.
  - `explainSshError(stderr, target, code): string`; `ping(target): Promise<{ ok: true } | { ok: false; error: string }>`; `checkConnection(target, claudePath?): Promise<{ ok: true; version: string } | { ok: false; error: string }>`.

- [ ] **Step 1: Criar `server/src/ssh-util.ts`**

```ts
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store';

export const TARGET_RE = /^(?!-)[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$/;
export const validTarget = (s: string) => s.length <= 255 && TARGET_RE.test(s);

export const DEFAULT_CLAUDE_PATH = '$HOME/.local/bin/claude';
const CLAUDE_PATH_RE = /^(\$HOME|~)?\/[A-Za-z0-9._@+/-]+$/;
export const validClaudePath = (s: string) => s.length <= 255 && CLAUDE_PATH_RE.test(s) && !s.includes('..');

// caminho já validado (sem `"`, `$` fora do prefixo, crase ou barra invertida) => seguro entre aspas duplas
export function claudeExpr(p: string): string {
  return p.startsWith('$HOME') || p.startsWith('~') ? `"$HOME${p.replace(/^(\$HOME|~)/, '')}"` : `"${p}"`;
}

// aspas simples POSIX: só `'` precisa de escape
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// mesma regra do Claude Code para nomear o diretório de projeto (confirmada em host real)
export const encodeCwd = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-');

export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CTL_DIR = path.join(DATA_DIR, 'ctl');
export function sshArgv(target: string, remoteCmd: string): string[] {
  mkdirSync(CTL_DIR, { recursive: true, mode: 0o700 });
  return [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPersist=60',
    '-o', `ControlPath=${CTL_DIR}/%C`,
    '--', target, remoteCmd,
  ];
}

const MAX_OUT = 32 * 1024 * 1024;

export function runSsh(target: string, remoteCmd: string, o: { timeoutMs?: number } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('ssh', sshArgv(target, remoteCmd), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { if (stdout.length < MAX_OUT) stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { if (stderr.length < 4000) stderr += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 15_000);
    child.on('error', (e) => { clearTimeout(t); resolve({ code: 255, stdout, stderr: e.message }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
  });
}

export function explainSshError(stderr: string, target: string, code: number | null): string {
  const last = stderr.trim().split('\n').pop() ?? '';
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION/i.test(stderr)) return `host desconhecido ou chave alterada: rode "ssh ${target}" uma vez no terminal para conferir e aceitar a chave`;
  if (/Permission denied/i.test(stderr)) return 'autenticação falhou (sem senha: configure chave SSH ou agente para este host)';
  if (/timed out|No route|refused|Could not resolve|Network is unreachable/i.test(stderr)) return `servidor inacessível: ${last}`;
  return last || `ssh falhou (código ${code})`;
}

export async function ping(target: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await runSsh(target, 'true');
  return r.code === 0 ? { ok: true } : { ok: false, error: explainSshError(r.stderr, target, r.code) };
}

export async function checkConnection(target: string, claudePath = DEFAULT_CLAUDE_PATH): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const c = claudeExpr(claudePath);
  const r = await runSsh(target, `test -x ${c} || { echo NOCLAUDE; exit 3; }; ${c} --version`, { timeoutMs: 20_000 });
  if (r.code === 0) return { ok: true, version: /(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1] ?? r.stdout.trim() };
  if (r.code === 3) return { ok: false, error: `claude não encontrado em ${claudePath} no servidor (ajuste o caminho do claude)` };
  return { ok: false, error: explainSshError(r.stderr, target, r.code) };
}
```

- [ ] **Step 2: Criar `server/scripts/check-ssh-helpers.ts`** (caminho de segurança: uma verificação executável)

```ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { claudeExpr, encodeCwd, shq, validClaudePath, validTarget } from '../src/ssh-util';

// target: aceita user@host/host; rejeita injeção de opção e metacaracteres
for (const ok of ['guilhermegranja@192.168.15.43', 'host', 'a.b-c@d.e', 'my_host']) assert.ok(validTarget(ok), `deveria aceitar ${ok}`);
for (const bad of ['-oProxyCommand=x', '-o', 'a b', 'a;b', '', "u@h'x", 'u@h;rm -rf /', 'u@@h', '@h', 'u@', 'a\nb', 'a$(x)']) assert.ok(!validTarget(bad), `deveria rejeitar ${JSON.stringify(bad)}`);

// claudePath
for (const ok of ['$HOME/.local/bin/claude', '~/bin/claude', '/opt/claude/bin/claude']) assert.ok(validClaudePath(ok), ok);
for (const bad of ['claude', '$HOME/../x', '/a b/c', '/x"; rm -rf /; "', '$(x)', '/x$y', '/x`y`', '']) assert.ok(!validClaudePath(bad), `deveria rejeitar ${JSON.stringify(bad)}`);
assert.equal(claudeExpr('$HOME/.local/bin/claude'), '"$HOME/.local/bin/claude"');
assert.equal(claudeExpr('~/bin/claude'), '"$HOME/bin/claude"');
assert.equal(claudeExpr('/opt/c'), '"/opt/c"');

// shq: ida-e-volta por um sh real com entradas hostis
for (const s of ["a'b", '$(id)', '; rm -rf /', 'é ü', 'line1\nline2', '`x`', '"q"', '\\', "''", '']) {
  assert.equal(execFileSync('sh', ['-c', `printf %s ${shq(s)}`]).toString(), s, `shq falhou para ${JSON.stringify(s)}`);
}

// codificação de cwd (regra confirmada em host real)
assert.equal(encodeCwd('/tmp/ccui h4.é_x'), '-tmp-ccui-h4---x');
assert.equal(encodeCwd('/home/u/proj-1'), '-home-u-proj-1');

console.log('ssh helpers OK');
```

- [ ] **Step 3: Typecheck e verificação**

Run: `npx tsc -p server 2>&1 | grep -v "^npm notice"; npx tsx server/scripts/check-ssh-helpers.ts 2>&1 | grep -v "^npm notice"`
Expected: sem erros de tipo, depois `ssh helpers OK`. Se algum `assert` falhar, corrigir o helper (nunca afrouxar o caso hostil).

---

### Task 3: `SshTransport` e smoke real no host remoto

**Files:**
- Create: `server/src/runtime/jsonl.ts`, `server/src/runtime/ssh-transport.ts`
- Create: `server/scripts/smoke-ssh.ts`, `server/scripts/smoke-ssh-drop.ts`

**Interfaces:**
- Consumes: `Transport`/`SessionInfo` (Task 1), `spawnManaged` (Task 1), helpers (Task 2), `blockText` de `./events`.
- Produces: `parseHistory(jsonl: string): HistoryItem[]`, `firstPrompt(jsonl: string): string | undefined`; `sshTransport(conn: { target: string; claudePath?: string }): Transport`.

- [ ] **Step 1: Criar `server/src/runtime/jsonl.ts`**

```ts
import type { HistoryItem } from '@ccui/shared';
import { blockText } from './events';

interface Entry { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: { content?: unknown } }

// jsonl do Claude Code -> histórico de texto (mesmo formato que o getSessionMessages local entrega)
export function parseHistory(jsonl: string): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line) continue;
    let e: Entry;
    try { e = JSON.parse(line); } catch { continue; } // linha cortada por head/tail
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain || e.isMeta) continue;
    const text = blockText(e.message?.content).trim();
    if (text) out.push({ role: e.type, text });
  }
  return out;
}

export const firstPrompt = (jsonl: string): string | undefined => parseHistory(jsonl).find((h) => h.role === 'user')?.text.slice(0, 80);
```

- [ ] **Step 2: Criar `server/src/runtime/ssh-transport.ts`**

```ts
import { claudeExpr, DEFAULT_CLAUDE_PATH, encodeCwd, runSsh, SESSION_ID_RE, shq, sshArgv } from '../ssh-util';
import { spawnManaged } from './child';
import { firstPrompt, parseHistory } from './jsonl';
import type { Transport } from './types';

const LIST_LIMIT = 50;
const HEAD_BYTES = 16 * 1024;
const HISTORY_LINES = 5000;

export function sshTransport(conn: { target: string; claudePath?: string }): Transport {
  const { target } = conn;
  const claude = claudeExpr(conn.claudePath ?? DEFAULT_CLAUDE_PATH);
  const titles = new Map<string, { mtime: number; title: string }>(); // (id, mtime) -> primeiro prompt; evita reler o head a cada polling
  const dir = (cwd: string) => `"$HOME/.claude/projects/${encodeCwd(cwd)}"`;
  const sh = (cmd: string, timeoutMs = 15_000) => runSsh(target, cmd, { timeoutMs });

  return {
    spawn(o, onStderr) {
      // Nenhuma variável de ambiente é encaminhada: o remoto usa o próprio ambiente e login.
      // `o.command` (binário local do SDK) é ignorado; os args do SDK seguem e vão entre aspas simples.
      const remote = `cd ${shq(o.cwd ?? '.')} && exec ${claude} ${o.args.map(shq).join(' ')}`;
      return spawnManaged('ssh', sshArgv(target, remote), { env: process.env, signal: o.signal }, onStderr);
    },

    async isDirectory(p) {
      return (await sh(`test -d ${shq(p)}`)).code === 0;
    },

    async listSessions(cwd) {
      const r = await sh(`cd ${dir(cwd)} 2>/dev/null && stat -c '%Y %n' -- *.jsonl 2>/dev/null`);
      const files = r.stdout.split('\n').flatMap((l) => {
        const m = /^(\d+) ([0-9a-f-]{36})\.jsonl$/i.exec(l.trim());
        return m && SESSION_ID_RE.test(m[2]) ? [{ id: m[2], mtime: Number(m[1]) * 1000 }] : [];
      }).sort((a, b) => b.mtime - a.mtime).slice(0, LIST_LIMIT);

      const missing = files.filter((f) => titles.get(f.id)?.mtime !== f.mtime);
      if (missing.length) {
        const cmd = `cd ${dir(cwd)} && for f in ${missing.map((f) => `${f.id}.jsonl`).join(' ')}; do echo "@@@ $f"; head -c ${HEAD_BYTES} "$f"; echo; done`;
        const h = await sh(cmd, 30_000);
        for (const part of h.stdout.split(/^@@@ /m).slice(1)) {
          const nl = part.indexOf('\n');
          const id = part.slice(0, nl).trim().replace(/\.jsonl$/, '');
          const f = missing.find((x) => x.id === id);
          if (f) titles.set(id, { mtime: f.mtime, title: firstPrompt(part.slice(nl + 1)) ?? '' });
        }
      }
      return files.map((f) => ({ sessionId: f.id, summary: titles.get(f.id)?.title || '(sem título)', lastModified: f.mtime }));
    },

    async history(id, cwd) {
      if (!SESSION_ID_RE.test(id)) return [];
      const r = await sh(`tail -n ${HISTORY_LINES} ${dir(cwd)}/${id}.jsonl`, 30_000);
      return r.code === 0 ? parseHistory(r.stdout) : [];
    },

    async sessionExists(id, cwd) {
      return SESSION_ID_RE.test(id) && (await sh(`test -f ${dir(cwd)}/${id}.jsonl`)).code === 0;
    },

    async waitSessionIdle(id, timeoutMs) {
      if (!SESSION_ID_RE.test(id)) throw new Error('sessionId inválido');
      const pattern = `[${id[0]}]${id.slice(1)}`; // o colchete evita casar o próprio pgrep/shell
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const r = await sh(`pgrep -f ${shq(pattern)}`);
        if (r.code === 1) return; // nenhum processo
        if (r.code !== 0) throw new Error('não foi possível consultar o servidor remoto');
        await new Promise((res) => setTimeout(res, 1000));
      }
      throw new Error('a sessão ainda está ativa no servidor remoto');
    },
  };
}
```

- [ ] **Step 3: Criar `server/scripts/smoke-ssh.ts`** (Haiku, ~US$0,03; cria e remove só `/tmp/ccui-smoke-ssh*`)

```ts
// Smoke real do SshTransport. Uso: SSH_TARGET=user@host npx tsx server/scripts/smoke-ssh.ts
import { randomUUID } from 'node:crypto';
import { SdkRuntime } from '../src/runtime/sdk-runtime';
import { sshTransport } from '../src/runtime/ssh-transport';
import { checkConnection, encodeCwd, runSsh, shq } from '../src/ssh-util';

const target = process.env.SSH_TARGET;
if (!target) throw new Error('defina SSH_TARGET=user@host');
const cwd = '/tmp/ccui-smoke-ssh';
const line = (tag: string, v: unknown) => console.log(tag, typeof v === 'string' ? v : JSON.stringify(v));

line('check:', await checkConnection(target));
await runSsh(target, `mkdir -p ${shq(cwd)}`);
const t = sshTransport({ target });
line('isDirectory (existe / não existe):', [await t.isDirectory(cwd), await t.isDirectory('/nao/existe')]);

const rt = new SdkRuntime(t);
const sessionId = randomUUID();
line('sessões antes:', (await rt.listSessions(cwd)).length);

const run = async (text: string) => {
  const live = await rt.open({ cwd, sessionId, model: 'haiku', effort: 'low', lean: true, maxBudgetUsd: 0.5, permissionMode: 'default' });
  live.send(text);
  for await (const ev of live.events) {
    if (ev.type === 'message.completed' || ev.type === 'turn.completed' || ev.type === 'error') line('  ev:', JSON.stringify(ev).slice(0, 150));
    if (ev.type === 'turn.completed') await live.close();
  }
};

await run('diga apenas: remoto ok');
line('histórico:', await rt.history(sessionId, cwd));
line('sessões depois:', await rt.listSessions(cwd));
line('existe:', String(await t.sessionExists(sessionId, cwd)));
await t.waitSessionIdle(sessionId, 20_000);
line('idle: ok', '');
await run('qual foi a minha primeira mensagem? responda em poucas palavras'); // valida --resume via ssh
line('histórico após resume:', (await rt.history(sessionId, cwd)).map((h) => `${h.role}: ${h.text.slice(0, 40)}`));

await runSsh(target, `rm -rf ${shq(cwd)} "$HOME/.claude/projects/${encodeCwd(cwd)}"`); // só artefatos deste smoke
line('limpo', '');
process.exit(0);
```

- [ ] **Step 4: Criar `server/scripts/smoke-ssh-drop.ts`** (queda de SSH no meio do turno; Haiku, ~US$0,02)

```ts
// Mata o cliente ssh local no meio de um turno e confere que o histórico completo aparece depois do settle.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { SdkRuntime } from '../src/runtime/sdk-runtime';
import { sshTransport } from '../src/runtime/ssh-transport';
import { encodeCwd, runSsh, shq } from '../src/ssh-util';

const target = process.env.SSH_TARGET;
if (!target) throw new Error('defina SSH_TARGET=user@host');
const cwd = '/tmp/ccui-smoke-ssh-drop';
await runSsh(target, `mkdir -p ${shq(cwd)}`);
const rt = new SdkRuntime(sshTransport({ target }));
const sessionId = randomUUID();
const live = await rt.open({ cwd, sessionId, model: 'haiku', effort: 'low', lean: true, maxBudgetUsd: 0.5, permissionMode: 'default' });
live.send('Responda direto no chat, sem usar nenhuma ferramenta: escreva um poema de 60 versos numerados sobre o mar.');

let deltas = 0, killed = false, sawExit = false;
for await (const ev of live.events) {
  if (ev.type === 'message.delta') deltas++;
  if (deltas >= 5 && !killed) {
    killed = true;
    execFileSync('pkill', ['-f', `session-id=${sessionId}`]); // derruba só o cliente ssh deste smoke
    console.log(`ssh local morto após ${deltas} deltas`);
  }
  if (ev.type === 'error') { sawExit = true; console.log('error:', ev.code, ev.message.slice(0, 120).replace(/\n/g, ' ')); }
}
console.log('stream terminou; erro de saída visto:', sawExit);

const t0 = Date.now();
await rt.settle(sessionId, cwd);
console.log(`settle em ${Math.round((Date.now() - t0) / 1000)}s`);
const h = await rt.history(sessionId, cwd);
const versos = (h.find((x) => x.role === 'assistant')?.text.match(/^\d+/gm) ?? []).length;
console.log(`histórico: ${h.length} itens; versos no texto final: ${versos} (esperado 60; deltas vistos ao vivo: ${deltas})`);

await runSsh(target, `rm -rf ${shq(cwd)} "$HOME/.claude/projects/${encodeCwd(cwd)}"`);
console.log('limpo');
process.exit(0);
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p server 2>&1 | grep -v "^npm notice"; echo done`
Expected: sem erros. Ajuste apenas anotações de tipo se o TS reclamar de `setEncoding(...).on` (usar duas instruções) — a lógica não muda.

- [ ] **Step 6: Smoke do transporte SSH real**

Run: `SSH_TARGET=guilhermegranja@192.168.15.43 timeout 200 npx tsx server/scripts/smoke-ssh.ts 2>&1 | grep -v "^npm notice"`
Expected, nesta ordem:
- `check: {"ok":true,"version":"2.1.278"}`
- `isDirectory (existe / não existe): [true,false]`
- `sessões antes: 0`
- eventos do 1º turno: `message.completed` "remoto ok", `turn.completed`
- `histórico:` com um item `user` e um `assistant`
- `sessões depois:` uma sessão com `summary` "diga apenas: remoto ok"
- `existe: true`, `idle: ok`
- 2º turno (`--resume` via ssh): `message.completed` citando "diga apenas: remoto ok"
- `histórico após resume:` 4 itens, `limpo`.

Se o script travar depois do 1º turno, suspeita: `ssh` mestre do `ControlPersist` segurando o pipe (o `close` de `runSsh` não dispara). Correção: trocar `'close'` por `'exit'` + aguardar o fim do stdout em `runSsh`, nunca mexer no `ControlPersist`.
Se a 2ª sessão perder a conexão, suspeita: o kill do grupo derrubou o ControlMaster (deveria ter feito `setsid`). Anotar e me avisar antes de mudar o design.

- [ ] **Step 7: Smoke da queda de SSH**

Run: `SSH_TARGET=guilhermegranja@192.168.15.43 timeout 200 npx tsx server/scripts/smoke-ssh-drop.ts 2>&1 | grep -v "^npm notice"`
Expected: `ssh local morto após N deltas`, um `error: exit …` (ou stream terminando), `stream terminou; erro de saída visto: true`, `settle em ~5-12s`, e `histórico: 2 itens; versos no texto final: 60` (turno completo no remoto apesar da queda), depois `limpo`.

---

### Task 4: Registro de conexões, hub multi-conexão e recuperação

**Files:**
- Modify: `shared/src/index.ts`, `server/src/hub.ts`, `server/src/domain.ts`
- Create: `server/src/connections.ts`

**Interfaces:**
- Produces:
  - shared: `Connection.claudePath?: string`; `type ConnStatus = 'up' | 'down' | 'reconnecting'`; `createConnectionBody`; `createProjectBody` com `connectionId` (default `'local'`); `ServerMsg` ganha `{ type: 'connection.status'; id: string; status: ConnStatus; message?: string }`.
  - `class Connections { constructor(store: Store, onStatus: (id: string, status: ConnStatus, message?: string) => void); get(id: string): { runtime: ClaudeRuntime; transport: Transport }; drop(id: string): void; status(id: string): ConnStatus; all(): Record<string, ConnStatus>; start(): void }`; `expectedCliVersion: string`; `versionWarning(remote: string): string | undefined`.
  - `SessionHub` constructor: `(runtimeFor: (sessionId: string) => ClaudeRuntime, spec: (sessionId: string) => OpenSpec)`.
  - `connectionIdFor(store, sessionId): string`.

- [ ] **Step 1: Editar `shared/src/index.ts`**

Substituir a linha de `Connection`:
```ts
export interface Connection { id: string; kind: 'local' | 'ssh'; target?: string; label: string; claudePath?: string }
export type ConnStatus = 'up' | 'down' | 'reconnecting';
```
Substituir `createProjectBody` por:
```ts
export const createProjectBody = z.object({ name: name(80), path: z.string().min(1).max(1024), lean: z.boolean().default(false), connectionId: z.string().min(1).default('local') });
export const createConnectionBody = z.object({ target: z.string().min(1).max(255), label: name(80).optional(), claudePath: z.string().max(255).optional() });
```
Adicionar a linha ao final da união `ServerMsg` (antes do `;`, junto às demais):
```ts
  | { type: 'connection.status'; id: string; status: ConnStatus; message?: string }
```

- [ ] **Step 2: Editar `server/src/domain.ts`** — acrescentar ao final:

```ts
export function connectionIdFor(store: Store, sessionId: string): string {
  const meta = store.sessions.data.sessions.find((s) => s.sessionId === sessionId);
  const project = meta && store.projects.data.projects.find((p) => p.id === meta.projectId);
  if (!project) throw new Error('sessão desconhecida');
  return project.connectionId;
}
```

- [ ] **Step 3: Criar `server/src/connections.ts`**

```ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ConnStatus } from '@ccui/shared';
import { localTransport } from './runtime/local-transport';
import { SdkRuntime } from './runtime/sdk-runtime';
import { sshTransport } from './runtime/ssh-transport';
import type { ClaudeRuntime, Transport } from './runtime/types';
import { ping } from './ssh-util';
import type { Store } from './store';

const MONITOR_MS = 15_000;

// versão do CLI que este SDK espera (declarada no package.json do próprio SDK)
export const expectedCliVersion: string = JSON.parse(
  readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')), 'package.json'), 'utf8'),
).claudeCodeVersion;

// H5: CLI remoto com major.minor diferente do esperado pelo SDK => aviso (não bloqueia)
export function versionWarning(remote: string): string | undefined {
  const mm = (v: string) => v.split('.').slice(0, 2).join('.');
  return mm(remote) === mm(expectedCliVersion)
    ? undefined
    : `o claude remoto é ${remote} e este backend espera ${expectedCliVersion}: alguns recursos podem se comportar de forma diferente`;
}

export class Connections {
  private cache = new Map<string, { runtime: ClaudeRuntime; transport: Transport }>();
  private statuses = new Map<string, ConnStatus>();

  constructor(private store: Store, private onStatus: (id: string, status: ConnStatus, message?: string) => void) {
    this.cache.set('local', { transport: localTransport, runtime: new SdkRuntime(localTransport) });
  }

  get(id: string) {
    let c = this.cache.get(id);
    if (!c) {
      const conn = this.store.config.data.connections.find((x) => x.id === id && x.kind === 'ssh' && x.target);
      if (!conn) throw new Error('conexão desconhecida');
      const transport = sshTransport({ target: conn.target!, claudePath: conn.claudePath });
      c = { transport, runtime: new SdkRuntime(transport) };
      this.cache.set(id, c);
    }
    return c;
  }

  drop(id: string) { this.cache.delete(id); this.statuses.delete(id); }

  status(id: string): ConnStatus { return id === 'local' ? 'up' : this.statuses.get(id) ?? 'reconnecting'; }

  all(): Record<string, ConnStatus> {
    return Object.fromEntries(this.store.config.data.connections.map((c) => [c.id, this.status(c.id)]));
  }

  // ponytail: polling de 15 s (ssh true via ControlMaster é barato); trocar por `ssh -O check` se pesar
  start() {
    const tick = async () => {
      for (const c of this.store.config.data.connections) {
        if (c.kind !== 'ssh' || !c.target) continue;
        if (this.statuses.get(c.id) === 'down') this.set(c.id, 'reconnecting');
        const r = await ping(c.target);
        this.set(c.id, r.ok ? 'up' : 'down', r.ok ? undefined : r.error);
      }
    };
    void tick();
    setInterval(() => void tick(), MONITOR_MS).unref();
  }

  private set(id: string, status: ConnStatus, message?: string) {
    if (this.statuses.get(id) === status) return;
    this.statuses.set(id, status);
    this.onStatus(id, status, message);
  }
}
```

- [ ] **Step 4: Substituir `server/src/hub.ts`** (mudanças: `runtimeFor`, `snapshot()` reutilizável, `recover()` após queda)

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
  constructor(private runtimeFor: (sessionId: string) => ClaudeRuntime, private spec: (sessionId: string) => OpenSpec) {}

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { seq: 0, buffer: [], state: 'idle', live: null, clients: new Set(), pending: new Map(), totalCostUsd: 0 };
      this.entries.set(id, e);
    }
    return e;
  }

  isLive(id: string) { return !!this.entries.get(id)?.live; }

  private async snapshot(c: Client, id: string, e: Entry) {
    const history = await this.runtimeFor(id).history(id, this.spec(id).cwd);
    // estado lido DEPOIS do await: eventos emitidos durante a leitura já foram enviados a `c` e o cliente os ignora até hidratar
    c.send({ type: 'snapshot', sessionId: id, history, state: e.state, lastSeq: e.seq, totalCostUsd: e.totalCostUsd, pending: [...e.pending.values()] });
  }

  async attach(c: Client, id: string, afterSeq?: number) {
    this.spec(id); // lança se a sessão for desconhecida
    const e = this.entry(id);
    e.clients.add(c);
    c.sessions.add(id);
    const first = e.buffer[0]?.seq;
    const canReplay = afterSeq !== undefined && afterSeq <= e.seq && (afterSeq === e.seq || (first !== undefined && first <= afterSeq + 1));
    if (canReplay) {
      for (const ev of e.buffer) if (ev.seq > afterSeq!) c.send({ type: 'event', event: ev });
      return;
    }
    await this.snapshot(c, id, e);
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
        e.live = await this.runtimeFor(id).open({ ...spec, sessionId: id });
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
    let crashed = false;
    for await (const b of live.events) {
      if (b.type === 'error' && b.code === 'exit') crashed = true;
      this.emit(id, e, b);
    }
    e.live = null;
    e.pending.clear();
    this.setState(id, e, 'exited');
    if (crashed) void this.recover(id, e);
  }

  // queda de SSH/crash: o claude remoto termina o turno sozinho; espera ele sair e reenvia o histórico completo
  private async recover(id: string, e: Entry) {
    try {
      await this.runtimeFor(id).settle(id, this.spec(id).cwd);
      for (const c of e.clients) await this.snapshot(c, id, e);
    } catch { /* conexão ainda fora: o usuário reabre a sessão depois */ }
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

- [ ] **Step 5: Verificar**

Run: `npx tsc -p shared && npx tsc -p server 2>&1 | grep -v "^npm notice"`
Expected: erros **somente** em `server/src/routes.ts` e `server/src/index.ts` (ainda usam a API antiga: `SessionHub(runtime, …)`, `buildApi({ runtime, transport })`, `createProjectBody` sem conexão). Nenhum erro em `hub.ts`, `connections.ts`, `domain.ts`, `shared`. Resolvidos na Task 5.

---

### Task 5: REST, WebSocket e entrypoint multi-conexão

**Files:**
- Modify: `server/src/routes.ts` (substituição completa), `server/src/ws.ts` (edições), `server/src/index.ts` (substituição completa)

**Interfaces:**
- Consumes: `Connections`, `versionWarning` (Task 4); `checkConnection`, `validTarget`, `validClaudePath`, `DEFAULT_CLAUDE_PATH` (Task 2); `connectionIdFor`.
- Produces: REST `POST /api/connections/test`, `POST /api/connections`, `DELETE /api/connections/:id`; `GET /api/state` inclui `status`; `POST /api/projects` aceita `connectionId`. `attachWs(server, o)` retorna `{ broadcast(m: ServerMsg): void }`.

- [ ] **Step 1: Substituir `server/src/routes.ts`**

```ts
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  createConnectionBody, createProjectBody, createSessionBody, lastConnectionBody, patchProjectBody, patchSessionBody, uuidSchema,
  type Connection, type Project, type SessionMeta,
} from '@ccui/shared';
import { versionWarning, type Connections } from './connections';
import { ensureMeta, listProjectSessions } from './domain';
import type { SessionHub } from './hub';
import { checkConnection, validClaudePath, validTarget } from './ssh-util';
import type { Store } from './store';

interface Deps { store: Store; hub: SessionHub; conns: Connections }

const body = async <T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T> | null> => {
  const r = schema.safeParse(await c.req.json().catch(() => null));
  return r.success ? r.data : null;
};

export function buildApi({ store, hub, conns }: Deps) {
  const api = new Hono();
  const projects = () => store.projects.data.projects;
  const connections = () => store.config.data.connections;
  const project = (id: string) => projects().find((p) => p.id === id);
  const bad = (c: Context, msg: string) => c.json({ error: msg }, 400);

  api.get('/state', (c) => c.json({ config: store.config.data, projects: projects(), status: conns.all() }));

  api.post('/last-connection', async (c) => {
    const b = await body(c, lastConnectionBody);
    if (!b || !connections().some((x) => x.id === b.connectionId)) return bad(c, 'conexão inválida');
    store.config.data.lastConnectionId = b.connectionId;
    await store.config.save();
    return c.body(null, 204);
  });

  // valida target/claudePath e testa a conexão real (ssh + claude --version); não salva nada
  const probe = async (c: Context) => {
    const b = await body(c, createConnectionBody);
    if (!b) return { err: bad(c, 'dados inválidos') };
    if (!validTarget(b.target)) return { err: bad(c, 'destino inválido: use usuario@host') };
    if (b.claudePath !== undefined && !validClaudePath(b.claudePath)) return { err: bad(c, 'caminho do claude inválido') };
    const r = await checkConnection(b.target, b.claudePath);
    return { b, r };
  };

  api.post('/connections/test', async (c) => {
    const p = await probe(c);
    if (p.err) return p.err;
    return c.json(p.r.ok ? { ok: true, version: p.r.version, warning: versionWarning(p.r.version) } : { ok: false, error: p.r.error });
  });

  api.post('/connections', async (c) => {
    const p = await probe(c);
    if (p.err) return p.err;
    if (!p.r.ok) return bad(c, p.r.error);
    if (connections().some((x) => x.target === p.b.target)) return c.json({ error: 'servidor já cadastrado' }, 409);
    const conn: Connection = {
      id: 'ssh-' + p.b.target.replace(/[^A-Za-z0-9]/g, '-'), kind: 'ssh', target: p.b.target, label: p.b.label ?? p.b.target,
      ...(p.b.claudePath ? { claudePath: p.b.claudePath } : {}),
    };
    connections().push(conn);
    await store.config.save();
    return c.json({ connection: conn, warning: versionWarning(p.r.version) });
  });

  // remove só metadata nossa; sessões vivas dessa conexão terminam sozinhas (Fase 3: encerrar ao remover)
  api.delete('/connections/:id', async (c) => {
    const id = c.req.param('id');
    if (id === 'local') return bad(c, 'a conexão local não pode ser removida');
    const doomed = new Set(projects().filter((p) => p.connectionId === id).map((p) => p.id));
    store.config.data.connections = connections().filter((x) => x.id !== id);
    if (store.config.data.lastConnectionId === id) store.config.data.lastConnectionId = 'local';
    store.projects.data.projects = projects().filter((p) => !doomed.has(p.id));
    store.sessions.data.sessions = store.sessions.data.sessions.filter((s) => !doomed.has(s.projectId));
    conns.drop(id);
    await Promise.all([store.config.save(), store.projects.save(), store.sessions.save()]);
    return c.body(null, 204);
  });

  api.post('/projects', async (c) => {
    const b = await body(c, createProjectBody);
    if (!b) return bad(c, 'dados inválidos');
    if (!connections().some((x) => x.id === b.connectionId)) return bad(c, 'conexão inválida');
    // caminhos POSIX (local Linux/macOS e remoto Linux); sem caracteres de controle
    const p = path.posix.normalize(b.path);
    if (!p.startsWith('/') || /[\u0000-\u001f]/.test(p)) return bad(c, 'o caminho deve ser absoluto');
    if (!(await conns.get(b.connectionId).transport.isDirectory(p))) return bad(c, 'diretório não encontrado');
    if (projects().some((x) => x.connectionId === b.connectionId && x.path === p)) return c.json({ error: 'projeto já cadastrado' }, 409);
    const created: Project = { id: randomUUID(), name: b.name, connectionId: b.connectionId, path: p, lean: b.lean };
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
    return c.json(await listProjectSessions(store, conns.get(p.connectionId).runtime, hub, p));
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

- [ ] **Step 2: Editar `server/src/ws.ts`**

(a) Trocar as duas primeiras linhas de import de `ws`/shared por:
```ts
import { WebSocketServer } from 'ws';
import { ClientMsg, type ConnStatus, type ServerMsg } from '@ccui/shared';
```
(b) Trocar a assinatura e o começo da função por:
```ts
export function attachWs(server: Server, o: { port: number; token: string; hub: SessionHub; store: Store; statuses: () => Record<string, ConnStatus> }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
  const authed = new Set<Client>();
```
(c) Dentro de `wss.on('connection', …)`, trocar `let authed = false;` por `let ok = false;` e ajustar os usos: no tratamento de `auth`:
```ts
      if (m.type === 'auth') {
        if (tokenOk(m.token, o.token)) {
          ok = true; clearTimeout(authTimer); authed.add(client);
          client.send({ type: 'ready' });
          for (const [id, status] of Object.entries(o.statuses())) if (id !== 'local') client.send({ type: 'connection.status', id, status });
        } else ws.close(4401, 'auth');
        return;
      }
      if (!ok) return ws.close(4401, 'auth');
```
e o `authTimer` para `if (!ok) ws.close(4401, 'auth')`.
(d) No `ws.on('close', …)` acrescentar `authed.delete(client);`.
(e) Ao final da função `attachWs` (depois do bloco `wss.on('connection', …)`) acrescentar:
```ts
  return { broadcast: (m: ServerMsg) => { for (const c of authed) c.send(m); } };
```

- [ ] **Step 3: Substituir `server/src/index.ts`**

```ts
import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { ServerMsg } from '@ccui/shared';
import { Connections } from './connections';
import { connectionIdFor, openSpecFor } from './domain';
import { SessionHub } from './hub';
import { buildApi } from './routes';
import { reportOrphans } from './runtime/local-transport';
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
let broadcast: (m: ServerMsg) => void = () => {};
const conns = new Connections(store, (id, status, message) => broadcast({ type: 'connection.status', id, status, message }));
const hub = new SessionHub((sid) => conns.get(connectionIdFor(store, sid)).runtime, (id) => openSpecFor(store, id));
const token = makeToken();

const app = new Hono();
app.use('*', guard(PORT, token));
app.route('/api', buildApi({ store, hub, conns }));
app.use('/*', serveStatic({ root: './web/dist' }));

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }) as Server;
server.on('error', (e) => { console.error(`[server] ${e.message}`); process.exit(1); });
broadcast = attachWs(server, { port: PORT, token, hub, store, statuses: () => conns.all() }).broadcast;
conns.start();

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

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^npm notice\|^> \|^$"; echo "exit=${pipestatus[1]}"`
Expected: `shared` e `server` sem erros. (`web` pode acusar erros em `Sidebar`/`store` por causa de `createProjectBody`/`ServerMsg`; resolvidos na Task 6. Só siga se os erros forem no `web`.)

- [ ] **Step 5: Smoke da API com o host remoto**

Run:
```bash
rm -rf /tmp/ccui-p2 && CCUI_NO_OPEN=1 CCUI_TOKEN=t CCUI_DATA_DIR=/tmp/ccui-p2 nohup npm start > /tmp/ccui-p2.log 2>&1 &
sleep 5
H='Authorization: Bearer t'; J='Content-Type: application/json'; B=http://127.0.0.1:4317/api
echo "--- testar (válido):";  curl -s -H "$H" -H "$J" -d '{"target":"guilhermegranja@192.168.15.43"}' $B/connections/test; echo
echo "--- testar (injeção):"; curl -s -H "$H" -H "$J" -d '{"target":"-oProxyCommand=id"}' $B/connections/test; echo
echo "--- testar (caminho ruim):"; curl -s -H "$H" -H "$J" -d '{"target":"guilhermegranja@192.168.15.43","claudePath":"/x\"; id; \""}' $B/connections/test; echo
echo "--- testar (claude ausente):"; curl -s -H "$H" -H "$J" -d '{"target":"guilhermegranja@192.168.15.43","claudePath":"/opt/nao/existe"}' $B/connections/test; echo
echo "--- criar conexão:"; curl -s -H "$H" -H "$J" -d '{"target":"guilhermegranja@192.168.15.43"}' $B/connections; echo
echo "--- projeto remoto (/tmp):"; curl -s -H "$H" -H "$J" -d '{"name":"remoto-tmp","path":"/tmp","connectionId":"ssh-guilhermegranja-192-168-15-43"}' $B/projects; echo
echo "--- projeto remoto inexistente:"; curl -s -H "$H" -H "$J" -d '{"name":"x","path":"/nao/existe","connectionId":"ssh-guilhermegranja-192-168-15-43"}' $B/projects; echo
echo "--- state (status):"; curl -s -H "$H" $B/state | jq -c '{status, conexoes: [.config.connections[].id]}'
```
Expected: `{"ok":true,"version":"2.1.278"}` (sem `warning`); `{"error":"destino inválido: use usuario@host"}`; `{"error":"caminho do claude inválido"}`; `{"ok":false,"error":"claude não encontrado em /opt/nao/existe …"}`; conexão criada com `connection.id` `ssh-guilhermegranja-192-168-15-43`; projeto remoto criado; erro `diretório não encontrado`; `status` com `ssh-…: "up"` (após o 1º ciclo do monitor) e `local: "up"`.

- [ ] **Step 6: Smoke ponta a ponta remoto por WebSocket (Haiku, ~US$0,01)** — com o backend do passo 5 rodando

Run: (a) ajustar o script `smoke-ws.ts` para aceitar conexão remota. Substituir a linha de criação do projeto por:
```ts
const conn = process.env.CONN_ID;
const p = await j('POST', '/api/projects', { name: 'smoke', path: process.env.PROJ_PATH ?? '/tmp', lean: true, ...(conn ? { connectionId: conn } : {}) });
```
(b) depois `CONN_ID=ssh-guilhermegranja-192-168-15-43 PROJ_PATH=/tmp/ccui-smoke-ws ...`: primeiro criar o diretório remoto: `ssh guilhermegranja@192.168.15.43 "mkdir -p /tmp/ccui-smoke-ws"`, então:
`CONN_ID=ssh-guilhermegranja-192-168-15-43 PROJ_PATH=/tmp/ccui-smoke-ws timeout 90 npx tsx server/scripts/smoke-ws.ts 2>&1 | grep -v "^npm notice"`
Expected: igual à Fase 1 (`ready`, `snapshot`, eventos `running`/`user.message`/`message.delta`/`turn.completed`/`idle`, e o cliente B recebendo o replay). Também aparece `A {"type":"event"…}`; e o `ready` é seguido por `connection.status` `up` para o servidor.
Depois limpar só o que criei: `ssh guilhermegranja@192.168.15.43 'rm -rf /tmp/ccui-smoke-ws "$HOME/.claude/projects/-tmp-ccui-smoke-ws"'`.

- [ ] **Step 7: Encerrar**

Run: `pkill -INT -f "[t]sx server/src/index"; sleep 4; pgrep -f "[i]nclude-partial-messages" || echo "sem claude local órfão"; rm -rf /tmp/ccui-p2 /tmp/ccui-p2.log`
Expected: `sem claude local órfão`. (O cliente `ssh` de controle pode ficar até 60 s por causa do `ControlPersist`; isso é esperado e não é órfão do `claude`.)

---

### Task 6: Frontend (servidores, sidebar por conexão, status)

**Files:**
- Modify: `web/src/api.ts`, `web/src/store.ts`, `web/src/features/connect/ConnectScreen.tsx`, `web/src/features/projects/Sidebar.tsx`, `web/src/features/chat/Chat.tsx`
- Create: `web/src/features/connect/ServerForm.tsx`

**Interfaces:**
- Consumes: REST da Task 5; `ConnStatus`, `Connection` (shared).
- Produces: `api.testConnection`, `api.addConnection`, `api.delConnection`; `useApp.status: Record<string, ConnStatus>`; `useApp.chooseConnection(id)` (substitui `chooseLocal`); `ServerForm({ onDone(id: string): void })`.

- [ ] **Step 1: Editar `web/src/api.ts`**

Trocar o import de tipos por: `import type { Config, ConnStatus, Connection, Effort, Model, Project, SessionRow } from '@ccui/shared';`
Trocar a linha de `state` e `addProject` e acrescentar as três novas funções dentro do objeto `api`:
```ts
  state: () => req<{ config: Config; projects: Project[]; status: Record<string, ConnStatus> }>('GET', '/api/state'),
  addProject: (b: { name: string; path: string; lean: boolean; connectionId: string }) => req<Project>('POST', '/api/projects', b),
  testConnection: (b: { target: string; claudePath?: string }) => req<{ ok: boolean; version?: string; warning?: string; error?: string }>('POST', '/api/connections/test', b),
  addConnection: (b: { target: string; label?: string; claudePath?: string }) => req<{ connection: Connection; warning?: string }>('POST', '/api/connections', b),
  delConnection: (id: string) => req<void>('DELETE', `/api/connections/${id}`),
```

- [ ] **Step 2: Editar `web/src/store.ts`**

(a) Import: `import type { Config, ConnStatus, Project, ServerMsg, SessionRow } from '@ccui/shared';`
(b) Na interface `App`: acrescentar `status: Record<string, ConnStatus>;` e trocar `chooseLocal(): Promise<void>;` por `chooseConnection(connectionId: string): Promise<void>;`
(c) No estado inicial: acrescentar `status: {},` (junto de `tokenMissing: false, up: false, …`).
(d) Em `handle`, acrescentar antes do `else if (m.type === 'error')`:
```ts
    else if (m.type === 'connection.status') set((s) => ({ status: { ...s.status, [m.id]: m.status } }));
```
(e) Em `reloadProjects`: `const { config, projects, status } = await api.state(); set({ config, projects, status: { ...get().status, ...status } });`
(f) Trocar `chooseLocal` por:
```ts
    async chooseConnection(connectionId) {
      await api.setConnection(connectionId);
      await get().reloadProjects();
    },
```

- [ ] **Step 3: Criar `web/src/features/connect/ServerForm.tsx`**

```tsx
import { useState } from 'react';
import { api } from '../../api';

export function ServerForm({ onDone }: { onDone: (connectionId: string) => void }) {
  const [target, setTarget] = useState('');
  const [claudePath, setClaudePath] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = 'w-full rounded bg-zinc-900 px-2 py-1.5 text-sm';
  const body = () => ({ target: target.trim(), ...(claudePath.trim() ? { claudePath: claudePath.trim() } : {}) });

  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.testConnection(body());
      if (!r.ok) setMsg({ kind: 'err', text: r.error ?? 'falhou' });
      else setMsg(r.warning ? { kind: 'warn', text: `claude ${r.version}: ${r.warning}` } : { kind: 'ok', text: `Conectado. claude ${r.version}` });
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
    setBusy(false);
  };
  const connect = async () => {
    setBusy(true); setMsg(null);
    try { onDone((await api.addConnection(body())).connection.id); } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <input className={input} placeholder="usuario@192.168.1.12" value={target} onChange={(e) => setTarget(e.target.value)} />
      {advanced
        ? <input className={input} placeholder="Caminho do claude no servidor (padrão: $HOME/.local/bin/claude)" value={claudePath} onChange={(e) => setClaudePath(e.target.value)} />
        : <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setAdvanced(true)}>avançado…</button>}
      {msg && <div className={`text-xs ${msg.kind === 'ok' ? 'text-green-400' : msg.kind === 'warn' ? 'text-amber-400' : 'text-red-400'}`}>{msg.text}</div>}
      <div className="flex gap-2">
        <button className="rounded border border-zinc-600 px-3 py-1 text-sm hover:bg-zinc-800 disabled:opacity-40" disabled={busy || !target.trim()} onClick={test}>Testar</button>
        <button className="rounded bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-900 disabled:opacity-40" disabled={busy || !target.trim()} onClick={connect}>Conectar</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Substituir `web/src/features/connect/ConnectScreen.tsx`**

```tsx
import { useState } from 'react';
import { useApp } from '../../store';
import { ServerForm } from './ServerForm';

export function ConnectScreen() {
  const chooseConnection = useApp((s) => s.chooseConnection);
  const [remote, setRemote] = useState(false);
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-96 space-y-4">
        <h1 className="text-center text-2xl font-semibold">Claude Code UI</h1>
        <p className="text-center text-zinc-400">Onde deseja executar o Claude?</p>
        <button onClick={() => chooseConnection('local')} className="w-full rounded-lg border border-zinc-700 p-4 text-left hover:border-zinc-500">
          <div className="font-medium">Local</div>
          <div className="text-sm text-zinc-400">Executar nesta máquina</div>
        </button>
        <div className="rounded-lg border border-zinc-700 p-4">
          <button className="w-full text-left" onClick={() => setRemote(true)}>
            <div className="font-medium">Servidor remoto</div>
            <div className="text-sm text-zinc-400">Conectar via SSH (usa sua configuração SSH existente)</div>
          </button>
          {remote && <div className="mt-3"><ServerForm onDone={(id) => void chooseConnection(id)} /></div>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Substituir `web/src/features/projects/Sidebar.tsx`**

```tsx
import { useState } from 'react';
import { api } from '../../api';
import { useApp } from '../../store';
import { ServerForm } from '../connect/ServerForm';

const ago = (t: number) => {
  const s = (t - Date.now()) / 1000, a = Math.abs(s);
  const f = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  return a < 3600 ? f.format(Math.round(s / 60), 'minute') : a < 86400 ? f.format(Math.round(s / 3600), 'hour') : f.format(Math.round(s / 86400), 'day');
};
const dot = { up: 'bg-green-500', reconnecting: 'bg-amber-500', down: 'bg-red-500' } as const;

export function Sidebar({ onNewSession }: { onNewSession: () => void }) {
  const { config, projects, rows, active, status, open, reloadProjects, refreshRows } = useApp();
  const [adding, setAdding] = useState(false);
  const [addingServer, setAddingServer] = useState(false);
  const [form, setForm] = useState({ name: '', path: '', lean: false, connectionId: 'local' });
  const [err, setErr] = useState('');
  const connections = config?.connections ?? [];

  const addProject = async () => {
    try {
      await api.addProject(form);
      setForm({ ...form, name: '', path: '' });
      setAdding(false);
      setErr('');
      await reloadProjects();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <aside className="flex h-screen w-72 flex-col border-r border-zinc-800">
      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        {connections.map((c) => (
          <section key={c.id} className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-zinc-500">
              {c.kind === 'ssh' && <span className={`h-2 w-2 rounded-full ${dot[status[c.id] ?? 'reconnecting']}`} title={status[c.id] ?? 'reconnecting'} />}
              <span className="flex-1 truncate">{c.kind === 'local' ? 'LOCAL' : c.label.toUpperCase()}</span>
              {c.kind === 'ssh' && (
                <button className="text-zinc-600 hover:text-red-400" title="Remover servidor (não apaga nada no servidor)"
                  onClick={async () => { if (confirm(`Remover o servidor "${c.label}" e seus projetos da lista?`)) { await api.delConnection(c.id); await reloadProjects(); } }}>✕</button>
              )}
            </div>
            {projects.filter((p) => p.connectionId === c.id).map((p) => (
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
          </section>
        ))}

        {adding ? (
          <div className="space-y-2 rounded border border-zinc-800 p-2 text-sm">
            <select className="w-full rounded bg-zinc-900 px-2 py-1" value={form.connectionId} onChange={(e) => setForm({ ...form, connectionId: e.target.value })}>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <input className="w-full rounded bg-zinc-900 px-2 py-1" placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="w-full rounded bg-zinc-900 px-2 py-1" placeholder="/caminho/absoluto (no servidor escolhido)" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
            <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={form.lean} onChange={(e) => setForm({ ...form, lean: e.target.checked })} /> lean</label>
            {err && <div className="text-xs text-red-400">{err}</div>}
            <div className="flex gap-2">
              <button className="rounded bg-zinc-100 px-2 py-1 text-zinc-900" onClick={addProject}>Adicionar</button>
              <button className="px-2 py-1 text-zinc-400" onClick={() => { setAdding(false); setErr(''); }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="block text-sm text-zinc-400 hover:text-zinc-200" onClick={() => setAdding(true)}>+ Novo projeto</button>
        )}

        {addingServer ? (
          <div className="rounded border border-zinc-800 p-2">
            <ServerForm onDone={async () => { setAddingServer(false); await reloadProjects(); }} />
            <button className="mt-2 text-xs text-zinc-500" onClick={() => setAddingServer(false)}>Cancelar</button>
          </div>
        ) : (
          <button className="block text-sm text-zinc-400 hover:text-zinc-200" onClick={() => setAddingServer(true)}>+ Servidor remoto</button>
        )}
      </div>
      <button className="m-3 rounded bg-zinc-100 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40" disabled={!projects.length} onClick={onNewSession}>+ Nova sessão</button>
    </aside>
  );
}
```

- [ ] **Step 6: Editar `web/src/features/chat/Chat.tsx`** (aviso quando a conexão do projeto ativo não está `up`)

(a) Trocar `const { active, chats, rows, up, send, interrupt, answer } = useApp();` por:
```tsx
  const { active, chats, rows, projects, config, status, up, send, interrupt, answer } = useApp();
```
(b) Depois da linha `const submit = …` acrescentar:
```tsx
  const connId = projects.find((p) => p.id === active.projectId)?.connectionId ?? 'local';
  const connState = status[connId] ?? 'up';
  const connLabel = config?.connections.find((c) => c.id === connId)?.label ?? connId;
```
(c) Logo depois do `</header>` acrescentar:
```tsx
      {connState !== 'up' && (
        <div className="border-b border-amber-900 bg-amber-950/40 px-4 py-1 text-xs text-amber-300">
          Servidor {connLabel}: {connState === 'down' ? 'sem conexão. O turno em andamento termina no servidor e o histórico completo aparece ao reconectar.' : 'reconectando…'}
        </div>
      )}
```

- [ ] **Step 7: Typecheck e build**

Run: `npm run typecheck 2>&1 | grep -v "^npm notice\|^> \|^$"; echo "exit=${pipestatus[1]}"; npm run build 2>&1 | grep -v "^npm notice" | tail -4`
Expected: `exit=0` e `built in …`.

---

### Task 7: Regressão, verificação ponta a ponta e documentação

**Files:** `docs/superpowers/specs/2026-09-21-claude-code-ui-design.md` (atualizar status).

- [ ] **Step 1: Regressão local completa (Fase 1 intacta)**

Run: `rm -rf /tmp/ccui-p2 && CCUI_NO_OPEN=1 CCUI_TOKEN=t CCUI_DATA_DIR=/tmp/ccui-p2 nohup npm start > /tmp/ccui-p2.log 2>&1 & sleep 5; timeout 90 npx tsx server/scripts/smoke-ws.ts 2>&1 | grep -v "^npm notice" | cut -c1-140; pkill -INT -f "[t]sx server/src/index"; sleep 4; rm -rf /tmp/ccui-p2 /tmp/ccui-p2.log`
Expected: mesma saída da Fase 1 (A: ready/snapshot/eventos/turn.completed; B: replay).

- [ ] **Step 2: Segurança**

Run (backend em pé como no Step 1): repetir os quatro `curl` da Fase 1 (401 sem token, 403 com `Host: evil.com`, 403 com `Origin` falso, JSON com token) e `CCUI_HOST=0.0.0.0 npm start` ⇒ `recusado`. Confirmar também que nenhum segredo vai ao remoto: `ps -eo args | grep "[s]sh .*session-id"` (durante um turno remoto) não deve conter `CLAUDE_CODE_MESSAGING_TOKEN`, `ANTHROPIC` nem o token da UI.
Expected: tudo conforme a Fase 1; nenhuma variável de ambiente na linha de comando do `ssh`.

- [ ] **Step 3: Checklist manual no navegador (roda o usuário; o agente não tem navegador)**

Backend: `npm run build && npm start`.
1. Card **Servidor remoto**: digitar `guilhermegranja@192.168.15.43`, **Testar** ⇒ "Conectado. claude 2.1.278"; **Conectar**.
2. **+ Novo projeto**, conexão do servidor, caminho `/tmp` (ou um projeto real); aparece o grupo com bolinha verde e as sessões existentes no servidor (nome = primeiro prompt).
3. **+ Nova sessão** (haiku, low): `diga apenas: oi`, streaming ao vivo; F5 no meio e reabrir: snapshot e replay sem duplicar.
4. Card de permissão para uma escrita no servidor: Permitir/Negar funcionam.
5. **Queda de SSH no meio do turno:** pedir um texto longo ("poema de 60 versos") e, em outro terminal, `pkill -f "ssh.*session-id"`. Esperado: aviso de erro no chat e estado `exited`; em até ~12 s o histórico completo (60 versos) aparece sozinho; o próximo `send` funciona (`--resume`).
6. **Servidor offline:** bloquear a rede/desligar o servidor: bolinha vermelha em até ~15–25 s, banner âmbar no chat, `send` retorna erro claro; ao voltar, bolinha verde.
7. **Host desconhecido:** `+ Servidor remoto` com um host que nunca foi acessado por ssh ⇒ mensagem pedindo `ssh usuario@host` uma vez.
8. Remover o servidor (✕): some o grupo e os projetos; nada é apagado no servidor.
9. Ctrl+C no backend: `pgrep -af "[i]nclude-partial-messages"` vazio.

- [ ] **Step 4: Atualizar documentação**

No spec: cabeçalho `Status:` para "Fase 1 e 2 implementadas; checklist de navegador pendente do usuário", e em §13 marcar Fase 2 como implementada com os resultados dos smokes (`smoke-ssh`, `smoke-ssh-drop`). Atualizar a memória do projeto (`project_claude-code-ui.md`) com o estado da Fase 2.

---

## Self-Review

**Cobertura do spec §6/§11 e requisitos da Fase 2:**
- SSH do sistema, `ControlMaster`, `BatchMode`, timeouts, `--` e target validado → Tasks 2, 3.
- Nenhuma credencial armazenada; nenhum env encaminhado → Task 3 (`spawn`), verificado na Task 7 Step 2.
- `claudePath` absoluto validado + teste de conexão + aviso de versão (H5) → Tasks 2, 4, 5.
- Listagem/histórico/existência remotos com regra H4 → Task 3.
- Queda de SSH (turno termina no remoto; espera do `claude` antigo; snapshot completo) → Tasks 1 (`waitSessionIdle` antes do resume), 3 (smoke de queda), 4 (`recover`).
- Status de conexão (`up/down/reconnecting`) e WS `connection.status` → Tasks 4, 5, 6.
- Projetos remotos e conexões na UI → Tasks 5, 6.
- Servidor offline: `ConnectTimeout`, `send` com erro claro (falha no `sessionExists`/spawn) → Tasks 2, 3; observado no checklist.
- Duas abas/`busy`, permissões, custo: inalterados da Fase 1.

**Placeholder scan:** sem TBD/TODO. Pontos condicionais com instrução exata: `setEncoding` encadeado (Task 3 Step 5) e suspeitas de `ControlPersist`/grupo de processos (Task 3 Step 6), ambos com ação definida.

**Consistência de tipos:** `Transport` (Task 1) usado igual em `local-transport`, `ssh-transport`, `sdk-runtime`, `connections`; `ClaudeRuntime.settle` definido na Task 1 e consumido no hub (Task 4); `SessionHub(runtimeFor, spec)` (Task 4) e `index.ts` (Task 5) alinhados; `ConnStatus`/`connection.status` (Task 4) consumidos em `ws.ts` (Task 5) e store (Task 6); `createProjectBody.connectionId` (Task 4) usado em routes (Task 5) e `api.addProject` (Task 6); `chooseConnection` substitui `chooseLocal` em store e `ConnectScreen`.

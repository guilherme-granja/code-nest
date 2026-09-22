# Architecture

## Visão geral

Claude Code UI é um app web (browser) que abre e conversa com sessões do Claude Code, local ou remoto (SSH), via `@anthropic-ai/claude-agent-sdk`. Backend Node (Hono + WebSocket) mantém o estado de cada sessão e faz a ponte entre o SDK e os clientes conectados; frontend React consome eventos via WebSocket e renderiza chat, tabs, terminal read-only etc.

## Componentes principais

- **`web`** — SPA React. Consome `/api/*` (HTTP) e `/ws` (WebSocket). Ver `docs/frontend.md`.
- **`server`** — Hono serve API + estáticos de `web/dist`; `attachWs` liga o WebSocket ao `SessionHub`. Ver `docs/backend.md`.
- **`shared`** (`@ccui/shared`) — tipos TS e o protocolo de eventos (`EventBody`, `ServerMsg`) usados por `web` e `server`; única fonte de verdade dos formatos de mensagem.
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — spawna o processo `claude`, expõe `query()`/`Query` (envio de mensagem, `setModel`, `interrupt`, permissões via `canUseTool`). O backend não reimplementa protocolo do Claude Code, só embrulha o SDK.

## Runtime

Abstração em `server/src/runtime/types.ts`:

- `Transport` — tudo que difere entre execução local e remota: `spawn`, `listSessions`, `history`, `usage`, `shell`, `git`, `waitSessionIdle`. Implementações: `local-transport.ts` e `ssh-transport.ts`.
- `OpenOptions` — `cwd, sessionId, model, effort, lean, routing, maxBudgetUsd, permissionMode`.
- `LiveSession` — sessão aberta: `send`, `interrupt`, `answerPermission`, `setModel`, `close`, `events` (AsyncIterable de `EventBody`).
- `ClaudeRuntime` — fachada usada pelo `SessionHub`: `open`, `listSessions`, `history`, `usage`, `shell`, `commands`, `classify`, `settle`. Implementação única `SdkRuntime` (`sdk-runtime.ts`), parametrizada por `Transport` — local e SSH usam a mesma classe `SdkRuntime`, só o `Transport` muda.

Fluxo de alto nível de uma mensagem:

```
SessionHub.send(sessionId, text)
    ↓ openSpecFor() já resolvido em domain.ts (spec por sessão)
    ↓ runtime.open(OpenOptions) na 1ª mensagem  → LiveSession
    ↓ (se spec.routing) runtime.classify() → live.setModel()
    ↓ live.send(text)
    ↓ live.events (AsyncIterable<EventBody>) → SessionHub.pump() → emit()
    ↓ WebSocket → ServerMsg { type:'event', event }
    ↓ React store.ts → applyEvent() (shared reducer) → UI
```

`SessionHub.send` (`server/src/hub.ts:86`) marca o estado `running` antes do `await` de abrir o processo, pra nunca abrir dois processos pra mesma sessão em paralelo.

## Remote / SSH

Decisões confirmadas em código (`server/src/runtime/ssh-transport.ts`, `server/src/ssh-util.ts`), preservar ao alterar:

- **Sobrevivência da sessão remota**: quando o cliente SSH cai no meio de um turno, o `claude` remoto termina o turno por conta própria; o backend detecta a queda (evento `error/exit`), e `SessionHub.recover()` (`hub.ts:141`) espera via `waitSessionIdle` (polling `pgrep -f`) e reenvia o snapshot completo do jsonl assim que o processo remoto sai.
- **`claudePath` absoluto**: resolvido via `claudeExpr()`/`DEFAULT_CLAUDE_PATH` (`ssh-util.ts`) porque `~/.local/bin` não está no `PATH` de sessão SSH não-interativa.
- **`cwd` → nome de diretório**: `encodeCwd(cwd)` substitui tudo que não é `[A-Za-z0-9]` por `-` (`ssh-util.ts:22`), usado em `$HOME/.claude/projects/<encoded>` no host remoto.
- **Sem repasse de env local**: `spawn()` em `ssh-transport.ts:19-24` não encaminha variáveis de ambiente locais; o remoto usa o próprio ambiente de login.
- **`pgrep -f` com cuidado**: pattern usado em `waitSessionIdle` (`ssh-transport.ts:86`) é `[${id[0]}]${id.slice(1)}` — o colchete evita que o próprio `pgrep`/shell se autocaseie no grep.
- **Dois writers no mesmo jsonl**: ao reabrir uma sessão que já existe (`SdkRuntime.open`, `sdk-runtime.ts:224-226`), espera `waitSessionIdle` antes de abrir novo processo, pra não corromper o histórico com dois `claude` escrevendo ao mesmo tempo.

Isso é diferente do **lock local do backend** (`~/.claude-code-ui/lock`, PID único, um backend por `DATA_DIR`, usado por `restart.sh`) e do **`run.json`** (`server/src/runtime/child.ts`), que só registra PIDs de processos `claude`/`ssh` filhos pra avisar (não matar) órfãos no próximo start — nenhum dos dois usa `pkill -f`.

## WebSocket protocol

Eventos e conceitos arquiteturalmente relevantes (protocolo completo em `shared/src/index.ts`, não listar tudo aqui):

- `routing.started` / `model.routed { model }` — ciclo do Model Routing por mensagem (ver seção abaixo).
- `permission.requested { reqId, toolName, input }` / mensagem cliente→servidor `{ type:'permission', sessionId, reqId, allow, updatedInput? }` — mecanismo único usado tanto pra aprovação normal de tool quanto pras respostas do modal `AskUserQuestion` (`updatedInput` carrega as respostas do usuário, resolvido no `canUseTool` do SDK).
- `turn.completed { totals, modelUsage, ... }` — fecha o turno; `SessionHub` calcula o delta por modelo desta execução (`diffModelUsage`, `hub.ts:26`) porque o jsonl guarda acumulado, não por-turno.
- `session.state` — `idle | running | awaiting_permission | exited`.

## Model Routing

- **Objetivo**: por mensagem, decidir Haiku (barato) vs Sonnet (capaz), economizando tokens sem perder qualidade em tarefa complexa.
- **Quando roda**: só se `project.routing === true` (opt-in, default `false`). Se desligado, `SessionHub.send` pula todo o bloco (`hub.ts:101`) — zero overhead, modelo fixo vem da hierarquia `session.model ?? project.model ?? config.defaults.model` (`domain.ts:13`).
- **Heurística** (`server/src/runtime/routing.ts`): texto vazio → `haiku`; > 400 chars → `sonnet`; bate `SONNET_HINTS` (implementa/refatora/cria/arquiteta/corrige bug/migra/integra/escreve função...) → `sonnet`; bate `HAIKU_HINTS` (o que/explica/lista/mostra/confirma/qual...) e < 200 chars → `haiku`; nenhuma bate → **zona cinza**, `null`.
- **Zona cinza**: `SdkRuntime.classifyViaHaiku` (`sdk-runtime.ts:168`) abre sessão Haiku descartável (`persistSession:false, maxTurns:1`, prompt de sistema `CLASSIFY_SYSTEM_PROMPT`), pede 1 palavra (`haiku`/`sonnet`), timeout 15s. Erro/timeout/ambíguo → `sonnet` (nunca cai pro barato em caso de falha).
- **Escalação**: com routing ligado, o SDK ganha uma MCP tool interna `request_model_upgrade(reason)` (`sdk-runtime.ts:74-84`) — o próprio modelo (rodando em Haiku) pode pedir upgrade pra Sonnet no meio do turno; passa pelo fluxo normal de permissão (`canUseTool`) antes de `q.setModel('sonnet')` rodar.
- **Estados visuais do turno** (frontend, `reduce.ts`): `routing.started` → fase `routing`; `model.routed` → fase `thinking` (guarda o modelo em `pendingRoutedModel`, exibido na próxima mensagem do usuário); qualquer evento de conteúdo real encerra a fase (`idle`).
- **Restrição fixa**: roteamento nunca escolhe Opus/Fable — esses ficam bloqueados independente de routing, ver `forbiddenModel` abaixo.

## Decisões importantes

- **Allowlist de modelo**: `forbiddenModel = /opus|fable/i` (`sdk-runtime.ts:43`), checado em `SdkRuntime.open` (allowlist de `MODELS`/`EFFORTS`) e a cada mensagem do SDK (`run()`, defesa em profundidade contra troca de modelo em runtime via comando/config/env). Nunca remover essa checagem redundante.
- **`bypass` (bypass permissions)**: flag por projeto (`project.bypass`) vira `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true` no SDK (`domain.ts:18`, `sdk-runtime.ts:95`). Feature real, não vulnerabilidade — usuário optou explicitamente por projeto.
- **Terminal (`!cmd`)**: modo shell é intencionalmente síncrono e sem PTY — roda o comando digitado no `Transport.shell()` (local ou via SSH) e publica `shell.started`/`shell.result` como eventos normais de sessão (replay incluso). Não é um terminal interativo de propósito — SDK's exec de comando bypassaria aprovação de permissão.

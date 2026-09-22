# Backend (`server/`)

Node.js + Hono + WebSocket. Sem Controller/Service/Repository — módulos são arquivos por responsabilidade em `server/src/`.

## File map

- `index.ts` — entry point: `openStore()`, `Connections`, `SessionHub`, Hono app (`/api` + estáticos de `web/dist`), `attachWs`, shutdown gracioso em SIGINT/SIGTERM.
- `hub.ts` — `SessionHub`: coordena estado por sessão, buffer de eventos pra replay, ponte WebSocket↔runtime. Ver `docs/architecture.md` pro fluxo completo.
- `domain.ts` — `openSpecFor()` monta o `OpenSpec` (hierarquia session→project→config), `ensureMeta`, `touch`, `listProjectSessions`, `connectionIdFor`.
- `store.ts` — `JsonFile<T>` (leitura/escrita atômica com `.bak`), `openStore()` carrega `config.json`/`projects.json`/`sessions.json`, `acquireLock()` — um backend por `DATA_DIR` via `~/.claude-code-ui/lock` (PID).
- `connections.ts` — `Connections`: runtimes ativos (local + SSH configuradas), monitora status SSH periodicamente.
- `ws.ts` — `attachWs`: handshake de auth por token, dispatch de mensagens cliente (`send`, `permission`, `shell`, `interrupt`, `attach`).
- `routes.ts` — API REST (`/api/projects`, `/api/sessions`, etc.).
- `security.ts` — `guard` (checagem de token/host), `makeToken`.
- `ssh-util.ts` — helpers SSH: `claudeExpr`, `encodeCwd`, `explainSshError`, `runSsh`, `shq` (shell-quote), `sshArgv`, `SESSION_ID_RE`.
- `commands.ts` — `visibleCommands` (filtra slash-commands do SDK pros permitidos na UI, ex.: bloqueia `/model` headless).
- `git.ts` — parse de `git status --porcelain=v2 --branch` pra `GitInfo`.

### `runtime/`

- `types.ts` — interfaces `Transport`, `OpenOptions`, `LiveSession`, `ClaudeRuntime` (ver `docs/architecture.md`).
- `sdk-runtime.ts` — `SdkRuntime` (única implementação de `ClaudeRuntime`) + classe interna `Live` (`LiveSession`). Usa `@anthropic-ai/claude-agent-sdk`: `query()`, `tool()`, `createSdkMcpServer()`, `canUseTool`. Contém `forbiddenModel`, classificador (`classify`/`classifyViaHaiku`), MCP server de escalação de routing.
- `local-transport.ts` — `Transport` local (spawna `claude` direto), `reportOrphans()`.
- `ssh-transport.ts` — `Transport` via SSH (`sshTransport(conn)`), ver decisões em `docs/architecture.md` §Remote/SSH.
- `child.ts` — `spawnManaged` (processo detached, grupo próprio, kill em cascata), `run.json` (registro de PIDs pra aviso de órfão, não é lock).
- `events.ts` — `mapMessage()`: traduz mensagens do SDK pra `EventBody` do protocolo.
- `routing.ts` — `classifyHeuristic`, `CLASSIFY_SYSTEM_PROMPT` (ver Model Routing em `docs/architecture.md`).
- `jsonl.ts` — parse do jsonl do Claude Code: `parseHistory`, `firstPrompt`, `lastCostState`.

## SessionHub

`send(id, text)` (`hub.ts:86`): reserva estado `running` antes do `await` de abrir sessão (evita processo duplicado); se `spec.routing`, emite `routing.started` → `runtime.classify()` → `live.setModel()` → emite `model.routed`; sempre emite `user.message` e chama `live.send(text)`.

`answerPermission(id, reqId, allow, updatedInput?)` — repassa pro `live.answerPermission`, mesmo canal usado por aprovação normal de tool e pelas respostas do `AskUserQuestion`.

`recover(id, e)` (`hub.ts:141`) — chamado quando o processo cai (`error/exit`); espera `runtime.settle()` (que usa `waitSessionIdle`) e reenvia snapshot pra todos os clientes conectados.

## SSH

Ver `docs/architecture.md` §Remote/SSH — fatos confirmados no código, não reimplementar de forma genérica sem checar `ssh-transport.ts`/`ssh-util.ts` primeiro.

## Model Routing

Implementação dividida em `routing.ts` (heurística + prompt de classificação) e `sdk-runtime.ts` (`classify`, `classifyViaHaiku`, MCP tool `request_model_upgrade`). Toggle lido em `domain.ts:16` (`project.routing ?? false`). Detalhe completo em `docs/architecture.md` §Model Routing.

## Configuração

- Store em `~/.claude-code-ui/{config,projects,sessions}.json` (ou `CCUI_DATA_DIR`), escrita atômica com backup `.bak` (`store.ts:26`).
- Hierarquia de config: `SessionMeta.model/effort` (por sessão) → `Project.model/effort/routing/bypass/lean` (por projeto) → `Config.defaults` (global, `model:'sonnet', effort:'medium', maxBudgetUsd:2`).
- `permissionMode`: `default | plan | bypassPermissions`, derivado de `project.bypass` em `domain.ts:18`.

## Tratamento de erros

- Timeout de permissão: 10 min (`PERMISSION_TIMEOUT_MS`, `sdk-runtime.ts:10`) → nega automaticamente.
- Timeout de classificação: 15s (`CLASSIFY_TIMEOUT_MS`) → assume `sonnet`.
- Modelo proibido detectado em qualquer mensagem do SDK → emite `error` e encerra a sessão (`sdk-runtime.ts:115-119`).
- Erros de SSH têm mensagem amigável via `explainSshError()` (`ssh-util.ts`).
- Órfãos de processo (`claude`/`ssh` de um backend anterior que não saiu limpo) são só reportados no log (`reportOrphans`), nunca matados automaticamente.

## Portas e boot

- Porta padrão `4317` (`CCUI_PORT`), host fixo em loopback (`127.0.0.1`/`localhost`, recusa qualquer outro `CCUI_HOST`).
- `npm run start` roda `server/src/index.ts` direto com `tsx`; `npm run dev:server` usa `tsx watch` com token/origin de dev fixos.

# Claude Code UI — Design

Data: 2026-09-21 · Status: Fases 1, 2 e 3 implementadas; checklists de navegador pendentes do usuário · Ambiente verificado: Claude Code CLI 2.1.278, Node 24, Agent SDK 0.3.278

## 1. Problema

UI web local para gerenciar e conversar com sessões do Claude Code. O Claude Code continua dono de agente, modelo, ferramentas, filesystem, Git, MCP e contexto. A UI é um **session manager + cliente de chat**: lista projetos e sessões, cria/retoma sessões, mostra streaming, aprova permissões, e (Fase 2) executa tudo numa máquina remota via SSH.

Requisitos transversais definidos na conversa:
- **Nunca usar Opus ou superior** (nem Fable). Modelos eficientes, uso de tokens otimizado. Enforçado no backend.
- Aprovação de permissões **na UI**.
- Listar sessões existentes do terminal **e** as criadas pela UI.
- Sem testes nesta etapa.

## 2. Arquitetura

```text
React (Vite) ──WS + REST──► Node backend (127.0.0.1)
                             ├─ Store        (JSON atômico em ~/.claude-code-ui/)
                             ├─ SessionHub   (sessões vivas, buffer de eventos com seq, fan-out)
                             └─ SdkRuntime(transport)
                                   ├─ LocalTransport  (Fase 1)
                                   └─ SshTransport    (Fase 2)
                                          └─► claude (Agent SDK, stream-json)
```

Local e remoto diferem só em **como spawnar o processo** e **como ler arquivos**. Portanto há **um** `SdkRuntime` parametrizado por um `Transport`, não dois runtimes.

```ts
interface Transport {
  spawn(o: SpawnOptions): SpawnedProcess   // SpawnedProcess = contrato do SDK
  readFile(path): Promise<string>
  list(dir): Promise<FileInfo[]>
  stat(path): Promise<FileInfo | null>
}
interface ClaudeRuntime {
  listSessions(cwd): Promise<SessionInfo[]>
  history(sessionId, cwd): Promise<HistoryItem[]>
  open(o: { cwd, sessionId?, resume?, model, effort, permissionMode, lean }): Promise<LiveSession>
}
interface LiveSession {
  send(text): void
  interrupt(): void
  answerPermission(reqId, allow: boolean): void
  close(): Promise<void>
  events: AsyncIterable<ClaudeEvent>
}
```

O React só conhece `ClaudeEvent` (`shared/`). O mapeamento SDK → `ClaudeEvent` vive em **um arquivo** (`server/src/runtime/events.ts`).

## 3. Integração com Claude Code

### Confirmado empiricamente
- `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose` abre **processo persistente multi-turn**; cada linha JSON no stdin é um turno; `session_id` constante.
- Eventos: `system/init`, `stream_event` (`content_block_delta`/`text_delta`), `assistant`, `user` (tool results), `result` (custo, `stop_reason`, usage), `rate_limit_event`, mais eventos `system` de hooks (devem ser filtrados).
- `--resume <id>` mantém o mesmo `session_id`. `--session-id <uuid>` permite à UI escolher o ID.
- Transcripts: `~/.claude/projects/<cwd-codificado>/<uuid>.jsonl`, compartilhado com sessões do terminal. O jsonl só existe após a primeira mensagem.
- Sem handler de permissão, `Write` é negado em `-p`.
- Fechar o stdin encerra o processo com código 0.
- `@anthropic-ai/claude-agent-sdk@0.3.278` (versão espelhada ao CLI) expõe: `query()` com `canUseTool`, `listSessions`, `getSessionInfo`, `getSessionMessages`, `renameSession`, `forkSession`, `spawnClaudeCodeProcess` (qualquer processo com stdin/stdout), `pathToClaudeCodeExecutable`.
- Custo de sessão fria (Haiku 4.5): `--setting-sources user,project,local` = 15.019 tokens de cache_create / $0,0316; `--setting-sources ""` = 3.120 tokens / $0,0082.

### Hipóteses (verificar antes de depender)
- ~~H1~~ **Confirmada (2026-09-21, `server/scripts/check-h1.mjs`):** com o processo pai morto por SIGKILL, o `claude` filho sai sozinho (EOF no pipe). `run.json` segue como aviso de restos, não como mecanismo principal.
- Medido no smoke real (Haiku, `server/scripts/smoke-runtime.ts`): `total_cost_usd` é **acumulado** entre turnos do mesmo processo (0,0168 → 0,0310); os tokens de `usage` são **por turno**. A UI mostra o total acumulado e os tokens do último turno.
- ~~H2~~ **Confirmada (2026-09-21, host real `192.168.15.43`):** `ssh host 'cd path && exec "$HOME/.local/bin/claude" -p --input-format stream-json …'` funciona como processo do SDK. Se o SSH cai **no meio do turno**, o `claude` remoto **termina o turno sozinho** (60/60 itens, `end_turn`) e sai por EOF em <12 s: não fica órfão e a resposta completa fica no jsonl remoto (só o stream ao vivo se perde). Achado: `~/.local/bin` **não está no PATH** do ssh não-interativo; usar caminho absoluto configurável (`claudePath`).
- ~~H3~~ **Descartada:** `claude --bg`/`logs` entrega *terminal output* (texto, inferido do `--help`; não executado), sem canal stream-json, e não é necessária dado o comportamento de H2.
- ~~H4~~ **Regra confirmada no remoto:** todo caractere fora de `[A-Za-z0-9]` vira `-` (`/tmp/ccui h4.é_x` → `-tmp-ccui-h4---x`). Não testado: caminhos muito longos (possível truncamento). O `SessionStore` do SDK é adaptador de espelhamento (alpha) e não serve para ler o disco remoto.
- H5: compatibilidade SDK local com CLI remoto de versão diferente. Só testado com versões iguais (2.1.278). Mitigação: comparar `claude --version` local vs remoto na conexão e avisar se divergir.
- H6: cache de prompt expira; retomar sessão fria paga cache_create de novo (TTL exato não assumido).

**Decisão:** Agent SDK como adapter (protocolo de controle — permissões, interrupt — é a parte frágil e o SDK o mantém). Trocar por spawn cru + NDJSON é possível reescrevendo só `SdkRuntime`.

## 4. Comunicação frontend ↔ backend

**WebSocket** para o fluxo vivo (bidirecional: enviar, permissão, interromper, reattach com `afterSeq`). SSE exigiria POSTs separados para cada ação; HTTP streaming não agrega. Lib: `ws`.
**REST** só para CRUD e leitura: `GET/POST /connections`, `/projects`, `GET /projects/:id/sessions`, `POST /projects/:id/sessions`, `PATCH /sessions/:id`, `GET /sessions/:id/history`.

```text
cliente → servidor                          servidor → cliente
attach   {sessionId, afterSeq?}             snapshot {history, state, lastSeq}
detach   {sessionId}                        event    {seq, …ClaudeEvent}
send     {sessionId, text}                  connection.status {id, up|down|reconnecting}
interrupt{sessionId}                        error    {code, message}
permission{sessionId, reqId, allow}
```

- `attach` só lê o jsonl e se inscreve: **não gasta tokens**. O processo do Claude é spawnado no **primeiro `send`**, com `--resume`.
- Heartbeat ping/pong a cada 30 s; 2 ciclos sem resposta derrubam o socket; cliente reconecta com backoff e refaz `attach {afterSeq}`.
- Limite de 1 MB por mensagem.

### Modelo de eventos (envelope `{sessionId, seq, ts, …}`)
`session.state` (idle | running | awaiting_permission | disconnected | exited), `message.delta`, `message.completed`, `tool.started`, `tool.result`, `permission.requested`, `permission.resolved`, `turn.completed` (tokens + custo), `error`.

## 5. Local runtime

`LocalTransport.spawn` usa `child_process.spawn(bin, argsArray)` sem shell, `detached: true` (grupo de processos próprio), stdio em pipe. Ciclo de vida:
- Fim normal: `close()` fecha stdin → aguarda 2 s → SIGTERM ao grupo → SIGKILL.
- `exit` do processo vira `session.state=exited` + `error` com o final do stderr; a sessão é retomável (`--resume`).
- Backend em SIGINT/SIGTERM: mesmo procedimento para todas as sessões vivas.
- PIDs registrados em `~/.claude-code-ui/run.json`; no startup, restos são reportados (não mortos).
- Hooks/plugins do usuário emitem eventos `system`; o mapeador os ignora.

## 6. Remote runtime (Fase 2)

`SshTransport.spawn` executa o binário `ssh` do sistema (reaproveita `~/.ssh/config`, agente, ProxyJump, known_hosts; **nenhuma chave ou senha armazenada**):

```text
ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3
    -o ControlMaster=auto -o ControlPersist=60 -o ControlPath=~/.claude-code-ui/ctl/%C
    -- <target> "cd '<cwd>' && claude -p --input-format stream-json …"
```

Comparação:
- **A. `ssh` do sistema (escolhido):** config existente intacta, é exatamente o que `spawnClaudeCodeProcess` espera. Contra: depende do binário instalado (presente aqui, OpenSSH 10.2).
- **B. `ssh2`:** controle fino, mas reimplementa comportamento do OpenSSH e trata config/agente manualmente. Rejeitada.
- **C. tmux / `claude --bg`:** camada de **sobrevivência** sobre A, só se H3 confirmar. tmux por padrão reintroduz parsing de terminal e é evitado.

Queda do SSH **não perde o turno** (ver H2): o `claude` remoto termina o turno e sai. Ao reconectar, o backend espera (até 30 s) o `claude` antigo daquela sessão sair (`pgrep -f` pelo `session-id`) antes de retomar com `--resume`, para evitar dois escritores no mesmo jsonl, e o `snapshot` relê o histórico do jsonl remoto. Listagem/histórico remotos: `stat`/`head`/`cat` via ssh e parse local, com a regra de H4; nome exibido = nome da UI ou primeiro prompt. Escopo: remoto Linux. Comando remoto sempre com `claudePath` absoluto validado na conexão (`test -x` + `--version`).

## 7. Sessões, projetos, conexões

```ts
Connection  { id: "local" | "<slug>", kind: "local" | "ssh", target?: "user@host", label }
Project     { id, name, connectionId, path, lean: boolean, model?, effort? }   // único por (connectionId, path)
SessionMeta { sessionId, projectId, name, createdAt, lastUsedAt }               // só metadata nossa
```

`SessionMeta.sessionId` é o UUID do próprio Claude. Não existe ID paralelo.

**Lista de sessões de um projeto** = união por `sessionId` de `runtime.listSessions(project.path)` (disco: terminal e UI) e `sessions.json` (sessões da UI ainda sem jsonl).
Nome exibido = `meta.name ?? customTitle ?? summary ?? firstPrompt`. Ordem = `lastModified` do jsonl (fallback `lastUsedAt`).

**Nova sessão:** UI gera UUID, grava `SessionMeta` no "Criar", passa `sessionId` ao SDK. **Reabrir:** `open({resume})`. **Renomear:** só `sessions.json` (não chama `renameSession()` do SDK; custo: `/resume` no terminal mostra o nome original). **Status 🟢/⚪:** 🟢 = hub tem `LiveSession`. Múltiplas abas na mesma sessão compartilham um processo. **Remover projeto:** apaga projeto e metas; nunca toca no jsonl.

## 8. Persistência

`~/.claude-code-ui/`: `config.json` (`version`, `lastConnectionId`, `defaults`, `connections`), `projects.json`, `sessions.json`. Escrita atômica (tmp + `rename`) em fila serializada, cópia `.bak` do último estado bom (parse falho → carrega `.bak` e avisa), lockfile por PID (`fs.open` `wx`) impedindo dois backends. Cada arquivo tem `version` (gancho de migração). Tudo atrás de um `Store` fino.

**JSON vs SQLite:** dados são pequenos (nomes, tempos) e o transcript fica no jsonl do Claude; um único escritor elimina concorrência. SQLite só compensaria com busca full-text ou histórico de eventos (Fase 3). Escolhido: JSON.

## 9. Política de modelo e tokens

- Allowlist no backend: `haiku`, `sonnet`; **default `sonnet`**. Opus/Fable rejeitados em `open()`. `--fallback-model` também dentro da allowlist.
- Effort exposto: `low | medium | high`, default `medium`.
- **Lean** por projeto (`--setting-sources ""`): ~80% menos custo de sessão fria (medido); opt-in, default desligado (muda o comportamento do agente).
- Um processo persistente por sessão viva (cache reaproveitado entre turnos).
- `turn.completed` mostra tokens e custo; acumulado por sessão. `maxBudgetUsd` por sessão (`--max-budget-usd`), default $2,00, configurável.
- `attach` de sessões antigas não gasta tokens.

## 10. Segurança

| Risco | Mitigação |
|---|---|
| Exposição na rede | Bind fixo `127.0.0.1`; host diferente na config ⇒ backend recusa iniciar. |
| CSRF / DNS rebinding | Token aleatório por execução (32 bytes) em `#token=` na URL impressa/aberta; `Authorization: Bearer` no REST, primeira mensagem no WS; valida `Host` e `Origin`; sem CORS (mesma origem). |
| Injeção de comando local | `spawn(bin, argsArray)`, sem shell; nenhum texto livre em argv (prompt vai por stdin JSON). |
| Injeção via SSH target | Regex `^[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$`, sem `-` inicial, `ssh … -- target`. |
| Injeção no comando remoto | Só enums (model, effort, permission-mode), UUID validado e `cwd` entre aspas simples com escape de `'`. |
| SSH pendurado | `BatchMode=yes`, `ConnectTimeout=10`, `ServerAlive*`. |
| Host desconhecido | `StrictHostKeyChecking` padrão; erro orienta a rodar `ssh user@host` uma vez. |
| Credenciais | Nenhuma chave/senha armazenada; usa `~/.ssh/config` e agente existentes. |
| Path traversal | Cliente nunca envia caminho de arquivo; `cwd` só de projeto registrado; jsonl localizado por `sessionId` (UUID) no diretório do projeto. |
| Execução sem aprovação | `permissionMode` aceito: `default`, `plan`. `bypassPermissions`/`acceptEdits` rejeitados. |
| XSS via saída do modelo | Saída e inputs de ferramenta são dados não confiáveis, renderizados como texto; markdown (Fase 3) só sanitizado. |
| Vazamento em log | Nunca logar token ou conteúdo de prompt/resposta; só ids, estados, códigos. |

## 11. Cenários de falha

| Cenário | Comportamento |
|---|---|
| Claude encerrou | `exit` → `session.state=exited` + `error`; próximo `send` faz `--resume`. |
| Claude travou | Sem kill automático. `running` sem eventos por 60 s ⇒ UI mostra "sem atividade" + Interromper; sem saída em 5 s ⇒ SIGTERM ao grupo, depois SIGKILL. |
| Browser fechou / WS caiu | Backend e Claude seguem; hub bufferiza; `attach {afterSeq}` reenvia, ou `snapshot` se o buffer estourou. |
| Backend encerrou (SIGINT/SIGTERM) | Fecha stdin, 2 s, SIGTERM ao grupo, SIGKILL; turno perdido, jsonl preservado, sessão retomável. |
| Backend morto à força | Depende de H1; `run.json` avisa sobre restos no startup. |
| Órfão | `detached` + kill de grupo + EOF + `run.json`. |
| SSH caiu (Fase 2) | `ServerAlive` detecta (~45 s); sessões da conexão ⇒ `disconnected`; backoff reabre o master. O turno em andamento **termina no remoto** (H2); ao reconectar, espera o `claude` antigo sair, recarrega o histórico do jsonl remoto e só então permite novo `send`. Permissão pendente no momento da queda é negada pelo EOF. |
| Remoto offline | `ConnectTimeout`; conexão `down`; listas remotas em modo "desatualizado"; `send` retorna erro claro. |
| Duas abas, mesma sessão | Um `LiveSession`, N clientes; `send` em `running` é **rejeitado** com `busy`. |
| Terminal + UI na mesma sessão | Não detectado no MVP; limitação documentada. |
| Permissão pendente sem cliente | Hub guarda e reenvia no `attach`; 10 min sem resposta ⇒ nega. |
| Limite de custo | `result` de erro ⇒ `error {code: budget}`; sessão volta a `idle`. |

## 12. MVP (Fase 1: só local)

**Backend:** `Store`, `security`, `LocalTransport`, `SdkRuntime` + mapeador, `SessionHub`, REST + WS, serve o build do frontend.
**Frontend:** tela Local/Remoto (Remoto **desabilitado**, "Fase 2"); sidebar de projetos/sessões com 🟢/⚪; modal Nova sessão (projeto, nome, modelo, effort); toggle lean; chat com streaming em texto puro (`whitespace-pre-wrap`), cards de ferramenta recolhidos, card de permissão, Interromper, badge de estado, custo por turno e acumulado.
**Fora do MVP:** SSH, markdown/highlight, busca, tags, favoritos, arquivar, tema, terminal, git status, testes.

## 13. Roadmap

- **Fase 1** (fatias verticais): (1) scaffold, `Store`, `security`; (2) uma mensagem streamada do Claude até o WS + script manual de H1; (3) lista, criar, retomar; (4) permissões, interrupt, custo; (5) acabamento de UI.
- **Fase 2:** `SshTransport`, conexões habilitadas, verificação de H2/H3/H4/H5, listagem remota, reconexão e status.
  - **Implementada (2026-09-21).** Plano: `docs/superpowers/plans/2026-09-21-claude-code-ui-fase2.md`. Verificado em host real (`192.168.15.43`, Haiku): `smoke-ssh` (listagem, histórico, `--resume`, `waitSessionIdle`), `smoke-ssh-drop` (SSH morto aos 5 deltas: erro `exit`, `settle` em 13 s, histórico com os 60 itens completos), smoke WS remoto com `connection.status` e replay, e verificação de que o `claude` remoto **não recebe nenhuma variável de ambiente local** (só as de sessão de login). `check-ssh-helpers` cobre validação de target/claudePath, `shq` e a codificação de `cwd`.
  - Desvios: sem estado `disconnected` (queda = `exited` + erro + `connection.status`); nome de sessão remota = nome da UI ou primeiro prompt; aviso de versão (H5) compara `major.minor` com o `claudeCodeVersion` do `package.json` do SDK; monitor de conexão por polling de 15 s.
  - Não verificado: interface no navegador (checklist da Task 7 do plano da Fase 2), servidor offline de verdade (só simulado por SSH morto), host com CLI de versão diferente, caminhos de projeto muito longos (H4).
- **Fase 3:** melhorias da lista original (markdown e sessões simultâneas primeiro), na ordem escolhida pelo usuário; possível SQLite; sincronização opcional de nome com o jsonl.
  - **Implementada (2026-09-21).** Plano compacto: `docs/superpowers/plans/2026-09-21-claude-code-ui-fase3.md`. Itens: markdown + realce (`react-markdown`/`remark-gfm`/`rehype-highlight`, sem HTML cru), cartões de ferramenta (Bash/Edit/Write), painel de comandos **somente leitura** (decisão do usuário; sem PTY), tema claro/escuro (inversão da escala zinc por variáveis CSS, seguindo o sistema), busca por nome/#tag, tags/favoritas/arquivar (no `SessionMeta`), abas de sessões simultâneas, notificações (opt-in, sem conteúdo), status do Git (local e via ssh, `core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0`) e atalhos (`Ctrl+K`, `Alt+N`, `Alt+↑/↓`, `Ctrl+J`, `?`).
  - Verificado: typecheck/build; `smoke-git` (local + remoto); API de meta de sessão (tags normalizadas, entradas inválidas rejeitadas); `check-search`; `check-markdown` (sem `<script>`/`<img>`/`onerror`, `javascript:` neutralizado, realce, tabela); regressão WS/segurança/encerramento.
  - **Não verificado:** toda a interface no navegador (tema claro, abas, paleta, atalhos, notificações, barra Git).
  - Limites: busca só por nome/tag (conteúdo exigiria SQLite); cartões de ferramenta e painel de comandos só mostram o que chegou ao vivo (o histórico do jsonl é só texto); nome/tags não são sincronizados com o jsonl do Claude; markdown re-renderiza a cada delta.

## 14. Estrutura e dependências

```text
claude-code-ui/                      (npm workspaces)
├─ shared/   events.ts, protocol.ts  (schemas zod + tipos)
├─ server/src/ index.ts store.ts hub.ts routes.ts ws.ts security.ts
│              runtime/ sdk-runtime.ts local-transport.ts events.ts   (ssh-transport.ts na Fase 2)
└─ web/src/    app/  features/{projects,sessions,chat}  store.ts  ws.ts
```

| Pacote | Justificativa |
|---|---|
| `@anthropic-ai/claude-agent-sdk` | Integração oficial (eventos, `canUseTool`, `listSessions`, `spawnClaudeCodeProcess`). |
| `ws` | WebSocket sem Socket.IO. |
| `hono`, `@hono/node-server` | REST + estáticos sem escrever roteador. |
| `zod` | Validação na borda de confiança; tipos derivados em `shared/`. |
| `tsx`, `typescript` (dev) | Rodar/checar TS. |
| `react`, `react-dom`, `vite`, `@vitejs/plugin-react` | Stack pedida. |
| `tailwindcss`, `@tailwindcss/vite` | Stack pedida. |
| `zustand` | Estado global pequeno. |

Não usados: `react-router`, SQLite, nanoid, lib de lockfile, `ssh2`, `node-pty`, Socket.IO, Vitest (por ora).

## 15. Decisões

Aprovadas: Agent SDK como adapter; WebSocket + REST; JSON; `ssh` do sistema (Fase 2); permissões na UI; descobrir sessões existentes; sem testes agora; allowlist haiku/sonnet (default sonnet), effort low–high (default medium), `maxBudgetUsd` $2; lean desligado por padrão; token por execução; renomear só na UI; `busy` rejeitado; sem `react-router`, com Hono + zod; card Remoto desabilitado na Fase 1.

Em aberto: `git init` + commit deste spec (o diretório não é repositório; nada foi commitado).

## 16. Ajustes pós-Fase 3 (2026-09-21)

- **Comandos `/` (autocomplete):** `GET /api/projects/:id/commands` sobe um processo sem enviar mensagem e chama `supportedCommands()` do SDK (sem custo de tokens; cache de 5 min por projeto e lean; local e SSH). Popup no chat com `↑↓`, `Tab`/`Enter`, `Esc`. No modo lean só existem os comandos nativos.
  - **Bloqueados no envio (`ws.ts`) e escondidos da lista:** `/clear` (`/reset`, `/new`), `/model`, `/fast`, `/advisor`, `/effort`, `/config`. Motivo medido: em modo headless `/model opus` **troca o modelo no meio da sessão**, furando a regra de nunca usar Opus/Fable, que só era checada ao abrir a sessão. `/clear` emite `conversation_reset` e desalinha o histórico do jsonl.
  - **Defesa em profundidade:** o modelo efetivo é conferido no `init` e em **toda** mensagem `assistant`; Opus/Fable encerra a sessão com erro.
- **Sidebar:** barra oculta/visível (`Alt+L`), grupos (LOCAL/servidor), projetos e Favoritas recolhíveis, com contagem e indicador de atividade quando recolhidos; estado lembrado em `localStorage`; busca ignora o recolhimento; ações do projeto ao passar o mouse.
- **Custo e tokens no cabeçalho (centro):** total acumulado da sessão = último `cost-state` do jsonl (custo e `modelUsage` por modelo, inclusive execuções anteriores), atualizado a cada turno por `modelUsage` do `result`. Exibe custo estimado + **entrada + saída** (cache no tooltip). Motivo do antigo `$0.0000`: o total só existia depois de um turno na execução atual do backend. O custo é estimativa a preço de API (plano de assinatura não é cobrado por isso).
- **Histórico do terminal legível:** `<bash-input>`, `<bash-stdout>`, `<bash-stderr>`, `<command-name>/<args>` e `<local-command-stdout>` viram blocos de código/texto em vez de tags cruas.
- **Modo shell (`!cmd`) — decisão do usuário: executar direto.** Medido: pelo SDK/stream-json o `!` **não** é modo shell, vai ao modelo como texto (o modelo chama a ferramenta Bash, com custo). Agora `!cmd` roda no diretório do projeto (local: shell de login do usuário com `-lc` e args em array; remoto: via ssh no shell do usuário), com timeout de 120 s, saída máxima de 200 KB, um comando por vez por sessão, resultado como cartão no chat e no painel Terminal, **sem custo de tokens**; a saída só vai ao Claude pelo botão "Enviar saída ao Claude".
  - **Mudança de confiança consciente:** é o único ponto em que texto livre do usuário vira comando de shell (inclusive no remoto, onde os demais comandos só usam valores validados). O comando é digitado pelo próprio usuário autenticado (token), com os privilégios dele, equivalente a um terminal. Não passa pela aprovação de permissões do Claude. Não é persistido no jsonl (some ao recarregar). Limite: shell de login não lê `~/.zshrc`.


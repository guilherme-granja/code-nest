# Claude Code UI

Web app pra rodar e conversar com sessões do [Claude Code](https://claude.com/claude-code) direto do browser — sem abrir terminal. Suporta projetos locais e remotos (via SSH), múltiplas sessões em abas, e roteamento automático entre modelos Haiku/Sonnet por mensagem.

## Por que

Terminal é ótimo pra codar, ruim pra acompanhar várias sessões de Claude Code ao mesmo tempo, revisar histórico, ou operar de um servidor remoto sem ficar com uma aba SSH aberta o dia todo. Esse projeto resolve isso: uma interface web fina em cima do [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), com o backend rodando local (loopback only) e o browser como cliente.

## Features

- **Chat com Claude** — streaming de resposta, markdown renderizado (GFM + syntax highlight), custo/tokens por turno.
- **Múltiplas sessões/abas** — cada sessão continua rodando em background mesmo com a aba fechada.
- **Projetos locais e remotos (SSH)** — abre sessões `claude` num host remoto como se fosse local; sobrevive a queda de conexão SSH (o processo remoto termina o turno sozinho, e a UI reconecta e re-sincroniza o histórico).
- **Model Routing** — por mensagem, decide entre Haiku (rápido/barato) e Sonnet (mais capaz) com heurística de texto + fallback via classificador Haiku descartável, com escalação automática no meio do turno quando a tarefa fica mais complexa do que o esperado. Opt-in por projeto — desligado, roda no modelo fixo configurado, sem overhead nenhum.
- **Terminal read-only** — mostra os comandos rodados (`!cmd`) e o log de subagentes (Task tool), mas não aceita input direto: aprovação de permissão nunca é contornada.
- **Slash commands com autocomplete**, **busca/tags/favoritos/arquivamento** de sessões, **barra de status do Git**, **temas** (light/dark/system), **notificações do browser**, **atalhos de teclado** e **command palette** (`Ctrl/Cmd+K`).
- **Permission bypass** por projeto, com confirmação explícita — pra quem quer rodar sem aprovação manual em ambientes de confiança.

Só usa `haiku` e `sonnet` — Opus e Fable ficam bloqueados por design (custo), enforçado no backend em toda resposta do modelo, não só na configuração inicial.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite + Tailwind 4, estado em Zustand |
| Backend | Node.js + Hono + WebSocket (`ws`) |
| Orquestração | `@anthropic-ai/claude-agent-sdk` |
| Tipos compartilhados | workspace `shared` (`@ccui/shared`) — mesmo contrato de protocolo pros dois lados |
| Linguagem | TypeScript estrito, sem `any`, 3 workspaces via npm workspaces |

Sem framework de state machine, sem ORM, sem camadas de Controller/Service — cada arquivo tem uma responsabilidade direta.

## Estrutura

```
web/     → SPA React (chat, tabs, sidebar, terminal read-only, temas)
server/  → API Hono + WebSocket + runtime do Agent SDK (local e SSH)
shared/  → tipos e protocolo de eventos WebSocket usados pelos dois lados
docs/    → documentação de arquitetura/frontend/backend/testes
```

Documentação técnica completa em [`docs/architecture.md`](docs/architecture.md), [`docs/frontend.md`](docs/frontend.md), [`docs/backend.md`](docs/backend.md) e [`docs/testing.md`](docs/testing.md). Regras e convenções do projeto (pra humano ou IA) em [`CLAUDE.md`](CLAUDE.md).

## Como rodar

Requer Node.js e o binário `claude` instalado (`npm install -g @anthropic-ai/claude-code` ou equivalente).

```bash
npm install

# desenvolvimento (2 terminais)
npm run dev:server   # backend em watch mode, porta 4317
npm run dev:web       # Vite dev server do frontend

# produção
npm run build         # builda o frontend pra web/dist
npm run start         # roda o backend, servindo o frontend estático
```

O backend abre automaticamente o browser no endereço `http://127.0.0.1:4317/#token=...` — o token é gerado por execução e escuta só em loopback.

Pra reiniciar o app em produção depois de mudar código:

```bash
./restart.sh
```

## Validação

```bash
npm run typecheck   # tsc nos 3 workspaces (shared, server, web)
npm run build       # confirma que o frontend compila
```

Sem suíte de testes automatizada por escolha do projeto (ver [`docs/testing.md`](docs/testing.md)) — validação de UI é manual, no browser.

## Segurança

- Backend só escuta em `127.0.0.1`/`localhost` (recusa qualquer outro host).
- Token de autenticação por execução, exigido em toda conexão WebSocket/API.
- Bypass de permissão é opt-in explícito por projeto, nunca default.
- Allowlist de modelo (`haiku`/`sonnet`) é checada tanto na abertura da sessão quanto em cada resposta do SDK — defesa em profundidade contra troca de modelo em runtime.

## Status

Fases 1 (local), 2 (SSH), 3 (markdown/tabs/busca/tema/git/shortcuts) e 5 (terminal com subagentes) implementadas e com typecheck passando. Histórico de design/decisões de cada feature em `docs/superpowers/{specs,plans}/`.

# Claude Code UI

Web app pra rodar sessões do Claude Code no browser em vez do terminal: chat, múltiplas abas/sessões, projetos locais e remotos via SSH, Model Routing (Haiku/Sonnet por mensagem).

## Stack

- Frontend: React + Vite + Tailwind, workspace `web`
- Backend: Node.js + Hono + WebSocket, workspace `server`
- Tipos compartilhados: workspace `shared` (`@ccui/shared`)
- Orquestração de sessões: `@anthropic-ai/claude-agent-sdk`
- TypeScript strict em todos os workspaces (npm workspaces, sem monorepo tool)

## Structure

- `web/src/` — UI React (componentes em `features/*`, estado em `store.ts`, WS client em `ws.ts`)
- `server/src/` — API Hono + WebSocket + runtime do Agent SDK (`hub.ts`, `domain.ts`, `runtime/`)
- `shared/src/` — tipos e protocolo de eventos WebSocket compartilhados entre os dois
- `docs/` — documentação operacional (este repo) + `docs/superpowers/{specs,plans}/` (specs/planos históricos de feature)

## Important Rules

- Preservar padrões existentes; reusar abstrações já presentes (`Transport`, `ClaudeRuntime`, `OpenOptions`, `LiveSession`, `SessionHub`) em vez de criar camadas novas.
- Não duplicar lógica; não introduzir Controller/Service/Repository — o projeto não usa essas camadas.
- Mudança focada: sem refactor não relacionado, sem trocar dependência sem necessidade, sem tocar em `web/dist` (gerado) ou `node_modules`.
- **Nunca usar Opus ou Fable**, em nenhum modelo/config/sugestão. Só `haiku`/`sonnet` (ver `MODELS` em `shared/src/index.ts`, e a checagem `forbiddenModel` em `server/src/runtime/sdk-runtime.ts:43`).
- Preservar as decisões de runtime remoto (SSH) já confirmadas — ver `docs/architecture.md` §Remote/SSH — não substituir por implementação genérica sem verificar o código primeiro.
- Ausência de testes automatizados e de `git init` é decisão explícita do projeto, não pendência. Não sugerir adicionar sem o usuário pedir.

## Before changing code

1. Identificar os arquivos reais envolvidos (grep pelo símbolo/evento, não adivinhar caminho).
2. Checar `docs/architecture.md`, `docs/frontend.md` ou `docs/backend.md` conforme a área; se precisar de histórico/decisão de feature específica, procurar em `docs/superpowers/specs/` ou `.../plans/` pelo nome da feature.
3. Verificar o padrão já usado no arquivo/módulo vizinho antes de escrever algo novo.
4. Implementar a menor mudança que resolve o pedido.
5. Validar com os comandos reais (seção abaixo).

## Validation

- `npm run typecheck` — roda `tsc -p shared && tsc -p server && tsc -p web`
- `npm run build` — build do frontend (`web`)
- `npm run dev:server` / `npm run dev:web` — dev local
- `./restart.sh` — mata backend antigo via PID do lock (`~/.claude-code-ui/lock`), builda e sobe de novo
- Não existe script de lint nem de teste automatizado no `package.json` — não invente `npm test`/`npm run lint`.

## Context Efficiency

- Não escanear o repo inteiro; começar pelo arquivo/módulo que a tarefa cita.
- Buscas direcionadas (grep pelo nome do símbolo/evento) em vez de ler tudo.
- Ler só a parte relevante de arquivos grandes; seguir imports/usages apenas quando necessário pra tarefa.
- Nunca ler `node_modules`, `web/dist`, caches ou logs.
- Nunca carregar `docs/superpowers/` inteiro — abrir só o spec/plan cujo nome bate com a feature da tarefa.
- Não carregar todos os `docs/*.md` numa tarefa que só toca uma área (frontend OU backend, não os dois por hábito).

## Documentation

- `docs/architecture.md` — visão geral, runtime (local/SSH), protocolo WebSocket, Model Routing. Ler antes de mudar fluxo entre frontend/backend ou runtime.
- `docs/frontend.md` — estrutura de `web/src`, estado, padrões de componente. Ler antes de tocar UI.
- `docs/backend.md` — estrutura de `server/src`, SessionHub, transports, SDK. Ler antes de tocar backend/runtime.
- `docs/testing.md` — estado real de validação (sem testes automatizados) e o que checar manualmente.
- `docs/superpowers/specs/` e `.../plans/` — specs e planos detalhados por feature; consultar só a spec/plan relevante quando precisar de profundidade/histórico, nunca como leitura geral.

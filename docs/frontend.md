# Frontend (`web/`)

React + Vite + Tailwind, TypeScript strict. Sem router SPA — layout único (Sidebar + Tabs + Chat) controlado por estado global.

## Estrutura (`web/src/`)

```
app/App.tsx          entry visual, keybindings globais
main.tsx              boot React
store.ts              estado global (Zustand) + ciclo de vida do WebSocket
ws.ts                 client WS (auto-reconnect)
api.ts                client HTTP + token
notify.ts             Notification API (opt-in, nunca mostra conteúdo de mensagem)
theme.ts              tema light/dark/system (fora do React, localStorage)
features/chat/        Chat, reduce.ts (reducer de eventos), Markdown, GitBar, CommandsPanel,
                       ShellCard, SlashMenu, ToolCard, AskUserQuestionModal
features/sessions/    Tabs, Palette (Ctrl+K), Shortcuts (modal ?), NewSessionModal
features/projects/    Sidebar (projetos, toggle routing/bypass)
features/connect/     ConnectScreen, ServerForm (setup inicial de conexão)
lib/                  commands.ts (busca de slash-commands), format.ts (fmtTokens etc.),
                       search.ts (normalização/matchRow)
```

## Estado (`store.ts`)

Zustand, uma store global (`useApp`, hook único — não há hooks locais por feature). Guarda: config, projects, `tabs`, `chats` (por `sessionId`), estado de UI (palette/help/newSession/terminal). WebSocket é criado dentro de `start()` e reanexado em reconexão. Preferências de layout (sidebar visível, grupos colapsados) persistem em `localStorage` sob prefixo `ccui-`.

Ações principais: `open()`, `closeTab()`, `send()`, `interrupt()`, `answer()`, `shell()`.

## WebSocket

`ws.ts`: `createSocket(handlers)` conecta em `/ws`, autentica com `{ type:'auth', token }`, reconecta com backoff exponencial (500ms–5s).

`store.ts` (handler de mensagem) despacha `snapshot` (hidrata via `applySnapshot`) e `event` (via `applyEvent`, ambos em `features/chat/reduce.ts` — reducer puro, mesma forma de `Chat`/`Item` usada em toda a UI de chat).

`answer(reqId, allow, updatedInput?)` envia `{ type:'permission', sessionId, reqId, allow, updatedInput }` — usado tanto pra permissão normal quanto pro modal `AskUserQuestion`.

## Model Routing UI

`reduce.ts`: campo `turnPhase: 'idle' | 'routing' | 'thinking'` no `Chat`. `routing.started` → `routing`; `model.routed` → `thinking` (guarda `pendingRoutedModel`, anexado na próxima mensagem do usuário como `Item.routedModel`); qualquer evento de conteúdo real volta pra `idle`. `Chat.tsx` renderiza `TurnLoading` (dots animados + timer) com label diferente por fase.

## Padrões / pontos de extensão

- **Componentes**: `PascalCase`, função exportada (ou `memo()` quando re-render é caro, ex. `Markdown`).
- **Reducer de chat**: mudanças no protocolo de eventos entram em `features/chat/reduce.ts` (`applyEvent`) — é o único lugar que traduz `EventBody` → `Item`/`Chat`. Não duplicar essa lógica em componentes.
- **Tipos**: sempre importados de `@ccui/shared`, nunca duplicados localmente.
- **Storage keys**: prefixo `ccui-` (`ccui-theme`, `ccui-notify`, layout).
- **Busca/filtro**: `lib/search.ts` (`norm` + `matchRow`) é reusado por `Palette` e pela lista de sessões — não reimplementar normalização de texto em outro componente.

## Componentes notáveis

| Feature | Arquivo | Nota |
|---|---|---|
| Markdown | `features/chat/Markdown.tsx` | `react-markdown` + `remark-gfm` + `rehype-highlight`, memoizado (evita re-render a cada delta de streaming) |
| Tabs | `features/sessions/Tabs.tsx` | cor do dot = estado da sessão (amber=awaiting_permission, azul pulsando=running, verde=evento novo, cinza=idle) |
| Git bar | `features/chat/GitBar.tsx` | busca `/api/projects/{id}/git`, atualiza ao fim do turno |
| Terminal read-only | `features/chat/CommandsPanel.tsx` | mostra comandos `!` e tabs por Task (subagente) ativo; não aceita input — decisão deliberada, ver `docs/architecture.md` |
| Slash autocomplete | `features/chat/SlashMenu.tsx` | ranking: prefixo > alias > nome contém > descrição contém, máx 40 itens |
| Bypass permissions | `features/projects/Sidebar.tsx` | toggle por projeto com confirmação, badge vermelho quando ativo |
| Modal AskUserQuestion | `features/chat/AskUserQuestionModal.tsx` | single/multi-select + texto livre, resposta via `updatedInput` |
| Command palette | `features/sessions/Palette.tsx` | Ctrl/Cmd+K, busca sessões + ações globais (nova sessão, tema, sidebar, terminal) |

## Atalhos globais

Definidos em `app/App.tsx`: Ctrl/Cmd+K (palette), Alt+N (nova sessão), Alt+L (sidebar), Alt+↑↓ (trocar tab), Ctrl+J (terminal), `?` (ajuda), Esc (fechar modal). Lista completa e atualizável em `features/sessions/Shortcuts.tsx`.

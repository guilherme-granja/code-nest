# Terminal por subagente — design

Data: 2026-09-22. Status: aprovado pelo usuário, pronto para plano de implementação.

## Contexto

Hoje o painel de terminal (`CommandsPanel`) mostra só os comandos Bash/shell do
agente principal. Mensagens vindas de subagentes (Task tool) são descartadas
inteiramente em `server/src/runtime/events.ts:35` (`if ('parent_tool_use_id'
in m && m.parent_tool_use_id) return [];`) porque eram tratadas como ruído.

O usuário quer: (1) ver quando um subagente está executando, e (2) clicar e
trocar para o "terminal" daquele subagente — o log das ferramentas que ele
chamou, isolado do log do agente principal.

## Descoberta no SDK

`@anthropic-ai/claude-agent-sdk` (`sdk.d.ts`) já expõe tracking de subagente
de primeira classe, sem precisar inventar nada:

- `SDKTaskStartedMessage` (`system/task_started`): `task_id`, `tool_use_id`,
  `subagent_type`, `description`, `skip_transcript`, `ambient`.
- `SDKTaskUpdatedMessage` (`system/task_updated`): `task_id`, `patch.status`
  (`pending|running|completed|failed|killed|paused`). **Não traz
  `tool_use_id`.**
- `SDKTaskProgressMessage` (`system/task_progress`): `task_id`, `summary?`.
  Fora de escopo nesta versão (só cosmético).
- Mensagens de conteúdo do subagente (`SDKAssistantMessage`,
  `SDKUserMessage`) carregam `parent_tool_use_id` = o `tool_use_id` do
  `tool_use` "Task" que o agente principal chamou — o mesmo id que já aparece
  no `ToolCard` do card "Task" na conversa principal. Não precisa de mapa pra
  essas: o campo já É a chave de agrupamento.

Só `task_updated`/`task_progress` precisam de correlação (`task_id` →
`tool_use_id`), porque não carregam o `tool_use_id` diretamente.

## Decisões (confirmadas com o usuário)

1. **Layout:** abas dentro do `CommandsPanel` — "Principal" + uma por
   subagente ativo/recente.
2. **Sem duplicação:** comando rodado dentro de um subagente aparece só na
   aba dele, nunca replicado na aba Principal.
3. **Retenção:** aba de subagente concluído continua clicável até a sessão
   fechar ou a página recarregar — sem persistência nova no servidor (mesma
   vida útil do resto de `chat.items` hoje: só em memória do cliente).
4. **Aninhamento:** só 1º nível. Um subagente chamado de dentro de outro
   subagente não ganha aba própria — aparece como texto/ferramentas dentro
   da aba do subagente-pai (via reaproveitamento do `ToolCard`, sem card
   dedicado).
5. **Conteúdo da aba:** só as ferramentas que o subagente chamou (estilo
   "log de comandos"), reaproveitando o componente `ToolCard` já existente.
   Texto de raciocínio (`message.delta`/`message.completed`) do subagente
   **não** é repassado ao cliente — o card "Task" na conversa principal já
   mostra o resumo final quando o subagente termina.

## Protocolo (`shared/src/index.ts`)

Dois eventos novos em `EventBody`:

```ts
| { type: 'task.started'; taskId: string; subagentType?: string; description: string }
| { type: 'task.updated'; taskId: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused' }
```

`taskId` é sempre o `tool_use_id` do Task tool (não o `task_id` interno do
SDK) — é a chave que já vincula naturalmente ao `ToolCard` existente do
agente principal e ao `parent_tool_use_id` das mensagens de conteúdo.

`tool.started` e `tool.result` ganham um campo opcional `taskId?: string`,
presente só quando o evento vem de dentro de um subagente.

## Servidor

**`server/src/runtime/events.ts` (`mapMessage`)**
- Remove o descarte total de `parent_tool_use_id`. Em vez disso:
  - `assistant` com `parent_tool_use_id` set: mapeia só os blocos
    `tool_use` pra `tool.started` com `taskId` = `parent_tool_use_id`;
    ignora blocos de texto.
  - `user` (tool_result) com `parent_tool_use_id` set: mapeia
    `tool.result` normalmente, com `taskId` = `parent_tool_use_id`.
  - `stream_event` com `parent_tool_use_id` set: ignorado (sem streaming de
    texto de subagente).
- `system/task_started`: novo case, mapeia pra `task.started`; retorna `[]`
  se `skip_transcript` ou `ambient` for true (housekeeping do SDK).
- `system/task_updated`: precisa do `task_id → tool_use_id`, que não está
  disponível numa função pura sem estado — ver `sdk-runtime.ts` abaixo.

**`server/src/runtime/sdk-runtime.ts` (classe `Live`)**
- Novo campo de instância `private taskIds = new Map<string, string>()`.
- No loop `run()`, antes de chamar `mapMessage`: se
  `m.type === 'system' && m.subtype === 'task_started'`, registra
  `this.taskIds.set(m.task_id, m.tool_use_id)` (quando `tool_use_id`
  existe) além de mapear o evento normalmente.
- Se `m.subtype === 'task_updated'` (ou `task_progress`, se algum dia
  entrar em escopo): resolve `taskId = this.taskIds.get(m.task_id)`; sem
  correspondência, ignora o evento (não deveria acontecer, mas defensivo).
- Sem persistência entre reconexões — `taskIds` é só do processo `Live`
  atual, igual ao resto do estado de turno. ponytail: se a sessão reabrir
  no meio de um subagente ativo (queda de processo), a aba dele não é
  reconstituída; aceitável, é só uma vista de conveniência, o card "Task"
  principal continua correto via jsonl.

**`server/src/hub.ts`:** nenhuma mudança estrutural — `emit`/buffer/replay
já são genéricos por `EventBody`, funcionam sem alteração para os 2 tipos
novos.

## Frontend

**`web/src/features/chat/reduce.ts`**
- `Chat` ganha `tasks: TaskEntry[]` (ordem de chegada), onde
  `TaskEntry = { taskId: string; label: string; status: TaskStatus; items: Item[] }`.
- `applyEvent`:
  - `task.started`: `push` um `TaskEntry` novo (`label` = `subagentType ??
    description`, `status: 'running'`, `items: []`).
  - `task.updated`: encontra o `TaskEntry` por `taskId`, atualiza `status`.
  - `tool.started`/`tool.result` com `ev.taskId` presente: em vez de ir pro
    `items` principal, vai pro `items` do `TaskEntry` correspondente (cria
    um se por algum motivo o `task.started` não chegou antes — defensivo).

**`web/src/features/chat/CommandsPanel.tsx`**
- Recebe `tasks: TaskEntry[]` além das props atuais.
- Tira de abas acima da barra de status: botão "Principal" (estado atual,
  sempre presente) + um botão por `TaskEntry` (label + dot de status,
  reaproveitando as cores já usadas em `Sidebar`/`Tabs` para
  running/awaiting/done).
- Aba selecionada é estado local (`useState`) do painel — não vai pro
  store global, não precisa persistir entre toggles do terminal.
- Conteúdo: aba Principal renderiza a lista atual (Bash + resumo de custo
  por turno); aba de subagente renderiza `task.items` reaproveitando
  `ToolCard` (mesmo componente usado na conversa principal para
  ferramentas não-Bash), sem o cabeçalho de custo/status (esse é só do
  turno principal).

## Fora de escopo (explícito)

- `task_progress` (resumo textual intermediário) — não mapeado nesta
  versão.
- Persistência de abas de subagente entre reconexão/reload.
- Aninhamento além do 1º nível como abas próprias.
- Qualquer mudança em como o card "Task" aparece hoje na conversa
  principal (continua igual).

## Teste

`npm run typecheck` + `npm run build`. Validação end-to-end real precisa de
uma sessão que efetivamente dispare um subagente (prompt que use a
ferramenta Task) — o usuário testa manualmente após o build, sem ambiente
de browser automatizado disponível aqui.

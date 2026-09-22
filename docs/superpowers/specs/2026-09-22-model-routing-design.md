# Model Routing — design

Data: 2026-09-22. Status: aprovado pelo usuário, pronto para plano de implementação.

## Contexto

Hoje toda mensagem de uma sessão usa um único modelo fixo, resolvido uma vez
em `domain.ts` (`meta.model ?? project.model ?? config.defaults.model`,
tipicamente `sonnet`). O usuário quer que cada mensagem seja roteada pro
modelo mais barato que dá conta da tarefa (Haiku pra trivial, Sonnet pra
complexo), com possibilidade de o próprio Haiku pedir escalonamento no meio
do turno se perceber que precisa de mais raciocínio.

**Opus fica fora**: a allowlist do projeto (`forbiddenModel` em
`sdk-runtime.ts`) já bloqueia Opus/Fable — roteamento é só Haiku↔Sonnet.

## Descoberta no SDK

- `Query.setModel(model?: string): Promise<void>` — troca o modelo **no
  meio** de uma sessão já aberta, sem reabrir/perder contexto. É a peça
  central: classificação acontece por mensagem, sessão continua a mesma.
- `createSdkMcpServer`/`tool()` — ferramenta customizada em processo
  (nenhum servidor externo). Passa pelo **mesmo `canUseTool`** que já gate-
  ia Bash/Edit/etc — logo o fluxo de permissão (`permission.requested`/
  `resolved`, botões Permitir/Negar) já existe e não muda de protocolo.
- `systemPrompt: { type: 'preset', preset: 'claude_code', append: '...' }`
  — soma instrução ao prompt padrão sem substituí-lo.

## Decisões

1. **Onde classifica:** por mensagem, no servidor, no único ponto por onde
   toda mensagem já passa (`hub.ts` `send()`), antes de `live.send(text)`.
2. **Classificador híbrido** (gastar o mínimo possível):
   - Heurística instantânea e grátis primeiro (regex + tamanho do prompt).
   - Só quando a heurística não decide (zona cinzenta): 1 chamada Haiku
     descartável (mesmo padrão de `commands()`: `query()` sem persistir
     sessão), resposta de 1 palavra, timeout curto. Erro/ambíguo → `sonnet`
     (falha pro lado seguro, não pro lado barato).
3. **Escalonamento:** ferramenta MCP em processo `request_model_upgrade
   (reason)`, registrada só quando `project.routing` está ligado. Aprovada
   pelo usuário (fluxo de permissão existente, com texto especial no
   frontend), o handler chama `this.q.setModel('sonnet')` direto.
4. **Liga/desliga:** campo novo `Project.routing?: boolean`, opt-in por
   projeto, mesmo padrão visual do toggle `lean` já existente na sidebar.
   Desligado (padrão): comportamento idêntico a hoje, zero custo extra.
5. **Transparência:** evento novo `model.routed` (emitido logo antes de
   `user.message`) faz o cliente mostrar qual modelo foi escolhido para
   aquela mensagem, como uma tag pequena acima da bolha do usuário — sem
   virar um bloco separado (mesma lição da mudança anterior desta sessão).

## Protocolo (`shared/src/index.ts`)

```ts
export interface Project { …; routing?: boolean }
export const patchProjectBody = z.object({ …, routing: z.boolean().optional() });

// EventBody, novo membro:
| { type: 'model.routed'; model: Model }
```

## Servidor

**`server/src/runtime/routing.ts` (novo arquivo)**
- `classifyHeuristic(text: string): Model | null` — regex de palavras-chave
  PT/EN pra sonnet (`implementa`, `refatora`, `cria`, `corrige bug`,
  `migra`, `escreve função/componente/endpoint/teste`, …) e pra haiku
  (`o que é`, `explica`, `lista`, `mostra`, `confirma`, `qual`, …, só se o
  prompt for curto); prompt > 400 caracteres cai direto em `sonnet`; sem
  match nenhum → `null` (zona cinzenta).
- `CLASSIFY_SYSTEM_PROMPT` — prompt fixo do classificador Haiku
  descartável, pede resposta de 1 palavra (`haiku`/`sonnet`).

**`server/src/runtime/sdk-runtime.ts`**
- `SdkRuntime.classify(cwd, text)`: `classifyHeuristic(text) ??
  this.classifyViaHaiku(cwd, text)`.
- `classifyViaHaiku`: mesmo padrão de `commands()` — `query()` descartável
  (`persistSession: false`, `maxTurns: 1`, `settingSources: []`, modelo
  `haiku`), manda a mensagem, lê o primeiro texto de resposta via um
  helper `firstAssistantText(q)`, timeout curto (15s) cai em `sonnet`.
- `Live` (classe): construtor ganha, só quando `o.routing` é true, (a) um
  `mcpServers` com um `createSdkMcpServer` contendo a tool
  `request_model_upgrade(reason)`, cujo handler chama `this.q.setModel
  ('sonnet')` — só roda depois que `canUseTool` já aprovou, então não
  precisa checar permissão de novo dentro dela; (b) `systemPrompt.append`
  explicando quando chamar essa tool.
- `Live` ganha `async setModel(model: Model) { await this.q.setModel
  (model); }`, exposto em `LiveSession`.

**`server/src/domain.ts`**: `openSpecFor` inclui `routing: project.routing
?? false` no `OpenSpec` retornado.

**`server/src/hub.ts` (`send`)**: depois de garantir `e.live` (abrir se
necessário, como já faz), se `spec.routing`: `const model = await
this.runtimeFor(id).classify(spec.cwd, text).catch(() => 'sonnet')`;
`await e.live.setModel(model).catch(() => {})`; `this.emit(id, e, {
type: 'model.routed', model })` — **antes** do `emit` de `user.message`
existente (mesma chamada síncrona, ordem garantida).

## Frontend

**`web/src/features/chat/reduce.ts`**
- `Item` (`kind: 'user'`) ganha `routedModel?: Model`.
- `Chat` ganha campo transiente `pendingRoutedModel?: Model` (não é um
  `Item`, é só uma "prateleira" de um evento pro próximo).
- `applyEvent`: `case 'model.routed': next.pendingRoutedModel = ev.model;
  break;` — e no `case 'user.message'` existente, o item criado carrega
  `routedModel: c.pendingRoutedModel`, e `next.pendingRoutedModel` volta
  pra `undefined`.

**`web/src/features/chat/Chat.tsx`**
- Bolha do usuário mostra uma tag pequena (`roteado → Haiku`/`Sonnet 5`)
  quando `it.routedModel` está presente — sem bloco novo, só uma linha de
  10px acima do texto.
- Bloco de permissão pendente (`chat.pending`) ganha um caso especial
  quando `p.toolName === 'request_model_upgrade'`: mostra "Claude quer
  trocar pra Sonnet 5 — `<reason>`" em vez do genérico "Permitir
  `<toolName>`?", mesmos botões Permitir/Negar, mesmo `answer()`.

**`web/src/features/projects/Sidebar.tsx`**: pill "rota" ao lado do `lean`
existente, mesmo padrão visual/interação (`api.patchProject(p.id, {
routing: !p.routing })`).

## Fora de escopo (explícito)

- Rotear pra Opus/Fable (bloqueado pela allowlist do projeto).
- Configuração por sessão (só por projeto, como `lean`).
- Métricas de acerto/erro do classificador (quanto foi roteado certo vs.
  precisou escalar) — nice-to-have futuro, não nesta versão.
- Custo da própria chamada de classificação não entra nos totais da sessão
  (é uma query descartável, mesmo tratamento que `commands()` já tem hoje).

## Teste

`npm run typecheck` + `npm run build`. Validação real precisa de uma sessão
com `routing` ligado e prompts variados (trivial, complexo, e um caso que
force o Haiku a pedir escalonamento) — o usuário testa manualmente após o
build, sem ambiente de browser automatizado disponível aqui.

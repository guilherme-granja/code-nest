# Testing

## Estado real (decisão explícita, não pendência)

O projeto **não tem testes automatizados** e **não tem git init**. Ambos foram escolha deliberada do usuário nesta fase — não sugerir adicionar Vitest/Jest, `npm test`, `git init` ou CI a menos que o usuário peça explicitamente.

## Comandos reais disponíveis (`package.json`)

- `npm run typecheck` → `tsc -p shared && tsc -p server && tsc -p web` — checa os 3 workspaces, sem emitir output.
- `npm run build` → `npm run build -w web` — build de produção do frontend pra `web/dist`.
- `npm run dev:server` — backend em modo watch (`tsx watch`), token/origin de dev fixos.
- `npm run dev:web` — Vite dev server do frontend.
- `npm run start` — roda o backend direto com `tsx` (produção, serve `web/dist` estático).
- `./restart.sh` — para o backend rodando (via PID do lock), builda e sobe de novo em background.

Não existe script de `lint` no `package.json` — não documentar nem sugerir um até existir.

## Validação disponível hoje

- **Typecheck**: `npm run typecheck` é a única checagem automatizada de correção existente. Roda limpo como critério mínimo antes de considerar uma mudança pronta.
- **Build**: `npm run build` confirma que o frontend compila/empacota.
- **Validação manual da UI**: browser não é controlável pela IA neste ambiente (só há Firefox local, e seu `--screenshot` dispara antes da SPA carregar) — nenhuma tela foi verificada visualmente por uma IA. O usuário testa manualmente no browser e reporta o que precisa de ajuste.

## O que checar manualmente quando relevante

Ao mudar algo em `web/src/features/*` ou no protocolo de eventos (`shared/src/index.ts`), pedir ao usuário para confirmar manualmente (ou verificar você mesmo se conseguir rodar `npm run dev:server` + `npm run dev:web` e abrir o browser):

- Chat renderiza e streama corretamente (delta + completed).
- Tabs abrem/fecham e mantêm o estado da sessão em background.
- Indicador de fase do turno (routing/thinking) aparece e some no momento certo.
- Modal `AskUserQuestion` envia a resposta certa via `updatedInput`.
- Toggle de bypass/routing no Sidebar reflete no comportamento real da próxima mensagem.
- Terminal read-only (`CommandsPanel`) mostra `!cmd` e tabs de Task sem aceitar input.

## Limitação atual

Sem suíte automatizada, regressões em fluxo de UI só aparecem no teste manual do usuário — ao tocar em código compartilhado (`shared/src/index.ts`, `hub.ts`, `reduce.ts`), o cuidado extra em revisão de diff substitui a rede de segurança que testes dariam.

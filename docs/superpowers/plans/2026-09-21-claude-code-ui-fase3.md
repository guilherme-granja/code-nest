# Claude Code UI — Fase 3 Implementation Plan (compacto)

> Execução inline (decisão do usuário), modelos Sonnet/Haiku apenas. Plano compacto de propósito: o código completo vai direto para os arquivos (economia de tokens); este documento fixa escopo, interfaces e verificação.

**Goal:** Melhorar o uso diário da UI: markdown/highlight, cartões de ferramenta, painel de comandos, tema claro/escuro, busca, tags/favoritas/arquivar, várias sessões com abas e notificações, status do Git e atalhos.

**Spec:** `docs/superpowers/specs/2026-09-21-claude-code-ui-design.md` · Fases 1–2: planos anteriores.

## Global Constraints

- Modelos do produto e regras de segurança das Fases 1–2 inalterados. Sem testes e sem git (decisão do usuário); verificação = typecheck + build + scripts.
- Dependências novas permitidas **apenas no frontend**: `react-markdown`, `remark-gfm`, `rehype-highlight`. Nada de node-pty, xterm, SQLite, ícones, lib de tema.
- Markdown nunca renderiza HTML cru; links só http(s) (padrão do `react-markdown`) com `rel="noopener noreferrer"`.
- `git` (local e remoto) sempre com `-c core.fsmonitor=false` e `GIT_OPTIONAL_LOCKS=0`; caminho só de projeto registrado, entre aspas simples no remoto.
- **Painel de terminal = somente leitura** (decisão do usuário): mostra comandos Bash que o Claude executou. Nenhum shell interativo.
- Notificações e tema: preferências em `localStorage` sempre dentro de try/catch.

## Desvios/limites declarados

1. Busca só por **nome e tag** (conteúdo exigiria SQLite).
2. O histórico carregado do jsonl é só texto: o painel de comandos e os cartões de ferramenta mostram apenas o que chegou **ao vivo** nesta aba.
3. Markdown re-renderiza a cada delta durante o streaming (ponytail: throttle se pesar).
4. Sem sincronizar nome/tags com o jsonl do Claude.
5. Sem verificação visual (nenhum navegador controlável aqui); o usuário testa.

## Tasks

### Task 1 — Shared + servidor (meta de sessão e Git)
- `shared/src/index.ts`: `SessionMeta` ganha `tags?`, `favorite?`, `archived?`; `SessionRow` ganha `tags`, `favorite`, `archived`; `patchSessionBody` = `{projectId, name?, favorite?, archived?, tags?}` (≥1 campo; tag `^[\p{L}\p{N}_-]+$`, ≤30, máx. 10); `GitInfo { branch: string | null; ahead: number; behind: number; changed: number; untracked: number }`.
- `server/src/git.ts`: `parseGitStatus(out: string): GitInfo | null` (porcelain v2 `--branch`).
- `Transport.git(cwd): Promise<string | null>`; local: `execFile('git', ['-c','core.fsmonitor=false','-C',cwd,'status','--porcelain=v2','--branch'])`; ssh: `runSsh`.
- `domain.listProjectSessions`: preenche tags/favorite/archived. `routes.ts`: `PATCH /sessions/:id` aplica campos; `GET /projects/:id/git`.
- **Verificação:** typecheck; `server/scripts/smoke-git.ts` (repo temporário local e remoto, alterações, `parseGitStatus`) com limpeza dos temporários.

### Task 2 — Frontend base: tema, markdown, cartões, painel de comandos
- `web/src/index.css`: `@import "tailwindcss" theme(static);`, espelhos `--z*` no `:root`, tema claro em `body[data-theme=light]` invertendo `zinc` (e destaques amber/red), estilos `.md` e cores `hljs`.
- `web/src/theme.ts`; `chat/Markdown.tsx`; `chat/ToolCard.tsx`; `chat/CommandsPanel.tsx`; `Chat.tsx` usa os três.
- **Verificação:** typecheck + build.

### Task 3 — Sidebar: busca, favoritas, tags, arquivar, indicadores
- `web/src/lib/search.ts` (`norm`, `matchRow`) com `web/scripts/check-search.ts`; `api.patchSession`; Sidebar com filtro, grupo Favoritas, ações por linha, mostrar arquivadas, indicador de estado por sessão.
- **Verificação:** typecheck; script de checagem de `norm`/`matchRow`.

### Task 4 — Store/UI: abas, atenção, notificações, paleta, atalhos, Git
- `store.ts`: `tabs`, `attention`, `ui`, `closeTab`, `patchSession`; `notify.ts`; `Tabs.tsx`, `Palette.tsx`, `Shortcuts.tsx`, `GitBar.tsx`; `App.tsx` liga atalhos (`Ctrl+K`, `Alt+N`, `Alt+↑/↓`, `Ctrl+J`, `?`, `Esc`).
- **Verificação:** typecheck + build.

### Task 5 — Regressão e documentação
- Backend local + `smoke-ws` (regressão); segurança (401/403); build; atualizar spec/memória. Checklist manual para o usuário.

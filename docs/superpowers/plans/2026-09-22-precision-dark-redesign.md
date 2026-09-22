# Precision Dark Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing `web/src` frontend to match the "Precision Dark" design system, without changing any behavior, data flow, props, or component interfaces — a pure visual/CSS migration.

**Architecture:** The app already runs on Tailwind v4 with a CSS-variable-based zinc palette (`web/src/index.css`) that already matches Precision Dark's neutral-scale approach (dark by default, light mode inverts the same variables). The redesign is therefore **not** a palette rewrite — it's: (1) add the Geist/Geist Mono typeface, (2) tighten spacing/border/badge conventions to match the mockup's specific Tailwind class patterns, (3) restructure the top bar into the mockup's two-row layout (status pill row + breadcrumb/title row), (4) restyle each component's chrome (buttons, badges, cards) to the mockup's button/badge/card taxonomy, one component file at a time. No new dependencies, no new backend data.

**Tech Stack:** React 19, Tailwind v4 (CSS-first `@import "tailwindcss" theme(static)`, no `tailwind.config.js`), Zustand, TypeScript strict.

**Spec:** `new design/DESIGN.md` (Precision Dark design system) + `new design/_extracted/code.html` (Stitch mockup — the concrete Tailwind-class reference; this is the file every task's class values are taken from, since it renders in plain Tailwind zinc/emerald/rose/amber rather than DESIGN.md's abstract Material-You hex tokens) + `new design/Pasted image.png` / `new design/_extracted/screen.png` (rendered mockup screenshots).

## Global Constraints

- Font: `Geist` for UI text, `Geist Mono` for code/terminal/monospace content (DESIGN.md "Typography"). Always with a system-font fallback stack — never a bare custom font with no fallback.
- Border radius: `sm`=4px, default/DEFAULT=4px, `md`=6px, `lg`=8px, `xl`=12px — these are Tailwind v4's own defaults (`rounded-sm/rounded/rounded-md/rounded-lg/rounded-xl`), so **no radius token changes are needed**, only using the right utility per component per DESIGN.md's "Shapes" section.
- Depth via 1px borders, not shadows (DESIGN.md "Elevation & Depth") — don't add `shadow-lg`/`shadow-xl` for panels; use border color steps (`border-zinc-800` → `border-zinc-700` → `border-zinc-100`) instead. The one exception the mockup itself uses is a subtle `shadow-sm`/`shadow-md` on the primary button and the permission card — keep those, don't add more.
- Semantic colors (emerald/rose/amber) are reserved for status/telemetry only (DESIGN.md "Semantic Restraint") — never for a plain primary action button.
- No behavior change: every task only edits `className` strings (and, where the mockup merges two existing pieces of UI into one row, only JSX structure/layout, never the data/handlers). No prop, handler, type, or event change anywhere in this plan.
- All new/changed code comments are in English (project rule, see root `CLAUDE.md`). Existing Portuguese comments in files touched by a task may stay as-is unless the task already needs to touch that exact line.
- Preserve the existing dark/light theme mechanism (`body[data-theme]` attribute + CSS var mirrors in `web/src/index.css:4-22`) — don't hardcode a color that bypasses the zinc/amber/red CSS vars this mechanism remaps for light mode.
- No automated test suite exists in this project (explicit decision, see `docs/testing.md`) — this plan does not add one. Each task's validation is `npm run typecheck`, `npm run build`, and a manual visual check against the mockup screenshot, per the project's existing manual-QA convention.

## Review Focus

- **Light theme regression:** every new class must still look correct when `body[data-theme="light"]` flips the zinc/amber/red CSS variables (`index.css:15-22`) — a class like `border-zinc-800/60` resolves the opacity modifier against the variable's *current* value, so it should flip automatically; Task 8 explicitly re-checks this in the browser for every touched screen.
- **Semantic-color misuse:** the current permission-approve button is solid `bg-green-700` and the bypass toggle is solid `bg-red-800` — under the new system these become primary (`zinc-100/zinc-950`) and destructive-tint (`rose` at low opacity) respectively, per Global Constraints; Task 5 and Task 2 pin this down explicitly so a reviewer can catch a leftover raw `green-700`/`red-800`.
- **Dynamic class-name maps must stay valid Tailwind:** `Sidebar.tsx`'s `dot` map, `Tabs.tsx`'s inline color ternary, and `CommandsPanel.tsx`'s `taskDot` map all build class strings from data (`state`, `status`) — Tasks 2, 3, and 6 keep the same color *names* (`bg-blue-500`, `bg-amber-500`, etc.) so these maps never reference a class that no longer exists.
- **Font loading fallback:** Geist is loaded from Google Fonts (network); Task 1 must ship a full fallback stack (`Geist, -apple-system, ... sans-serif` / `"Geist Mono", ui-monospace, ... monospace`) with `font-display: swap`, so a slow/offline load never leaves text invisible or breaks monospace alignment in the terminal/diff views.
- **Monospace-dependent layout must survive the font swap:** `CommandsPanel.tsx`, `ToolCard.tsx`, `ShellCard.tsx`, and the diff/code blocks rely on monospace character alignment for `pre`/line-number columns; Task 6 explicitly re-checks that Geist Mono doesn't reflow those blocks unexpectedly (it's a monospace font, but line-height/letter-spacing differ from the current default `monospace` stack).

---

## File Map

| File | Change |
|---|---|
| `web/index.html` | add Geist/Geist Mono font links, `lang="en"` |
| `web/src/index.css` | `@theme` font-family tokens, base body font, heading tracking helpers |
| `web/src/features/projects/Sidebar.tsx` | restyle: search bar, section headers, session rows, project toggle chips, footer |
| `web/src/app/App.tsx` | restructure top-level layout to host the new two-row header |
| `web/src/features/sessions/Tabs.tsx` | restyle tab chrome |
| `web/src/features/chat/GitBar.tsx` | merge into the new breadcrumb/status row styling (still its own component, just restyled + repositioned) |
| `web/src/features/chat/Chat.tsx` | header row restyle, message bubbles, permission-request blocks, turn summary, textarea dock |
| `web/src/features/chat/SlashMenu.tsx` | restyle popover to match mockup's command palette card |
| `web/src/features/chat/AskUserQuestionModal.tsx` | restyle modal card + option buttons |
| `web/src/features/chat/ToolCard.tsx` | restyle collapsed/expanded tool card |
| `web/src/features/chat/ShellCard.tsx` | restyle shell result card |
| `web/src/features/chat/CommandsPanel.tsx` | restyle terminal drawer (header, tabs, output, read-only badge) |

**Explicitly out of scope** (present in the mockup as illustrative demo content, with no backing feature or data in the real app — building them would mean shipping fake, non-functional UI):
- The "Raciocínio Interno" / reasoning-chain drawer, the "AST: 0.94" score, the "Tarefas Pendentes" / "Próximo Passo" cards, and the terminal's "PID / Idle %" footer — the SDK doesn't expose this data.
- The top-bar "Visão Geral / Diff / Logs" nav tabs and the "Exportar sessão" / "Compartilhar" icon buttons — no such pages/actions exist yet.
- The "Ativa" session-status pill — the real app already shows live state via the tab/sidebar dot; don't add a second, differently-styled indicator with no new state behind it.

If the user wants any of those as *real* features later, that's a separate spec/plan — this plan is styling only.

---

### Task 1: Typography foundation (Geist font)

**Files:**
- Modify: `web/index.html`
- Modify: `web/src/index.css:1`

**Interfaces:** No props/types change. Produces: the `font-sans` and `font-mono` Tailwind utilities resolve to Geist/Geist Mono everywhere in the app (every later task relies on this being in place before it starts changing component classes).

- [ ] **Step 1: Add font links and `lang="en"` to `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <title>Claude Code UI</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Add font-family theme tokens at the top of `web/src/index.css`**

Change:
```css
@import "tailwindcss" theme(static);
```
to:
```css
@import "tailwindcss" theme(static);

@theme {
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
}

body { font-family: var(--font-sans); }
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed with no errors (this task only touches CSS/HTML, so a failure here means a typo in the CSS, not a type error).

- [ ] **Step 4: Manual check**

Run `npm run dev:server` + `npm run dev:web`, open the app, confirm body text now renders in Geist (headings/buttons look slightly tighter/more geometric than the previous system-font default) and code blocks (`Markdown.tsx`'s `<pre>`, `ToolCard.tsx`) still render monospace, now in Geist Mono, still fully readable and aligned.

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/src/index.css
git commit -m "feat: add Geist/Geist Mono typography foundation"
```

---

### Task 2: Sidebar restyle

**Files:**
- Modify: `web/src/features/projects/Sidebar.tsx`

**Interfaces:** No props/state changes — `SessionItem`, `Sidebar` keep the same signatures and store usage. Consumes: Task 1's font tokens.

- [ ] **Step 1: Restyle the search bar + top utility row (lines 104-114)**

Change:
```tsx
      <div className="space-y-1 border-b border-zinc-800 p-3">
        <div className="flex gap-1">
          <input className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1.5 text-sm outline-none" placeholder="Buscar sessões ou #tag…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="rounded px-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" title="Ocultar barra lateral (Alt+L)" onClick={toggleSidebar}>«</button>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <button className="hover:text-zinc-300" onClick={cycleTheme}>{themeLabel[theme]}</button>
          <button className="hover:text-zinc-300" title="Avisa quando uma sessão em segundo plano termina ou pede permissão" onClick={() => void toggleNotify()}>Notificações: {notifyOn ? 'on' : 'off'}</button>
          <button className="ml-auto hover:text-zinc-300" title="Atalhos (?)" onClick={() => setUi({ help: true })}>?</button>
        </div>
      </div>
```
to:
```tsx
      <div className="space-y-2.5 border-b border-zinc-800/60 p-3">
        <div className="flex items-center gap-2 rounded-md border border-zinc-800/80 bg-zinc-900/60 px-2.5 py-1.5 text-zinc-400 transition-colors focus-within:border-zinc-700">
          <input className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-500" placeholder="Buscar sessões ou #tag…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="shrink-0 text-zinc-500 hover:text-zinc-200" title="Ocultar barra lateral (Alt+L)" onClick={toggleSidebar}>«</button>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <button className="hover:text-zinc-300" onClick={cycleTheme}>{themeLabel[theme]}</button>
          <button className="hover:text-zinc-300" title="Avisa quando uma sessão em segundo plano termina ou pede permissão" onClick={() => void toggleNotify()}>Notificações: {notifyOn ? 'on' : 'off'}</button>
          <button className="ml-auto rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300" title="Atalhos (?)" onClick={() => setUi({ help: true })}>?</button>
        </div>
      </div>
```

- [ ] **Step 2: Restyle section headers (favorites + connection groups, lines 118-121 and 139-146)**

Change:
```tsx
            <button className="flex w-full items-center gap-1.5 text-left text-xs font-semibold tracking-wide text-zinc-500 hover:text-zinc-300" onClick={() => toggleCollapsed('f')}>
              <Chevron open={isOpen('f')} /> FAVORITAS <span className="font-normal text-zinc-600">{favorites.length}</span>
            </button>
```
to:
```tsx
            <button className="flex w-full items-center gap-1.5 px-2 py-1 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300" onClick={() => toggleCollapsed('f')}>
              <Chevron open={isOpen('f')} /> Favoritas <span className="font-normal text-zinc-600">{favorites.length}</span>
            </button>
```
and change:
```tsx
              <div className="group/c flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors duration-150 hover:text-zinc-300" onClick={() => toggleCollapsed(ck)} title={open ? 'Recolher' : 'Expandir'}>
```
to:
```tsx
              <div className="group/c flex items-center gap-1 px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors duration-150 hover:text-zinc-300" onClick={() => toggleCollapsed(ck)} title={open ? 'Recolher' : 'Expandir'}>
```

- [ ] **Step 3: Restyle the project row toggle chips — lean/rota/bypass (lines 170-184)**

The mockup's badge convention for a "warning" toggle is a low-opacity rose tint with a border, not a solid fill; apply that to `bypass` specifically since it's the destructive/dangerous one (Review Focus: semantic-color misuse). `lean` and `rota` (routing) are neutral feature toggles, not status — give them a neutral zinc-container style instead of solid `zinc-700`/`emerald-700` fills.

Change:
```tsx
                          <button
                            className={p.lean ? 'rounded bg-zinc-700 px-1.5 text-[10px] text-zinc-200' : 'hidden rounded border border-zinc-700 px-1.5 text-[10px] text-zinc-500 group-hover/p:block'}
                            title={`lean ${p.lean ? 'ligado' : 'desligado'}: ignora hooks/plugins/skills/MCP/CLAUDE.md do usuário (~80% mais barato ao iniciar). Clique para alternar.`}
                            onClick={async () => { await api.patchProject(p.id, { lean: !p.lean }); await reloadProjects(); }}
                          >lean</button>
                          <button
                            className={p.routing ? 'rounded bg-emerald-700 px-1.5 text-[10px] text-zinc-100' : 'hidden rounded border border-zinc-700 px-1.5 text-[10px] text-zinc-500 group-hover/p:block'}
                            title={`roteamento de modelo ${p.routing ? 'ligado' : 'desligado'}: escolhe Haiku ou Sonnet por mensagem pra economizar tokens. Clique para alternar.`}
                            onClick={async () => { await api.patchProject(p.id, { routing: !p.routing }); await reloadProjects(); }}
                          >rota</button>
                          <button
                            className={p.bypass ? 'rounded bg-red-800 px-1.5 text-[10px] text-zinc-100' : 'hidden rounded border border-zinc-700 px-1.5 text-[10px] text-zinc-500 group-hover/p:block'}
                            title={`bypass de permissões ${p.bypass ? 'ligado' : 'desligado'}: Claude Code roda Bash/edições sem pedir aprovação neste projeto. Use com cuidado. Clique para alternar.`}
                            onClick={async () => { if (p.bypass || confirm(`Ligar bypass de permissões em "${p.name}"? Claude Code vai poder rodar comandos e editar arquivos sem pedir aprovação.`)) { await api.patchProject(p.id, { bypass: !p.bypass }); await reloadProjects(); } }}
                          >bypass</button>
```
to:
```tsx
                          <button
                            className={p.lean ? 'rounded-sm border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-200' : 'hidden rounded-sm border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 group-hover/p:block'}
                            title={`lean ${p.lean ? 'ligado' : 'desligado'}: ignora hooks/plugins/skills/MCP/CLAUDE.md do usuário (~80% mais barato ao iniciar). Clique para alternar.`}
                            onClick={async () => { await api.patchProject(p.id, { lean: !p.lean }); await reloadProjects(); }}
                          >lean</button>
                          <button
                            className={p.routing ? 'rounded-sm border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-200' : 'hidden rounded-sm border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 group-hover/p:block'}
                            title={`roteamento de modelo ${p.routing ? 'ligado' : 'desligado'}: escolhe Haiku ou Sonnet por mensagem pra economizar tokens. Clique para alternar.`}
                            onClick={async () => { await api.patchProject(p.id, { routing: !p.routing }); await reloadProjects(); }}
                          >rota</button>
                          <button
                            className={p.bypass ? 'rounded-sm border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-rose-400/80' : 'hidden rounded-sm border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 group-hover/p:block'}
                            title={`bypass de permissões ${p.bypass ? 'ligado' : 'desligado'}: Claude Code roda Bash/edições sem pedir aprovação neste projeto. Use com cuidado. Clique para alternar.`}
                            onClick={async () => { if (p.bypass || confirm(`Ligar bypass de permissões em "${p.name}"? Claude Code vai poder rodar comandos e editar arquivos sem pedir aprovação.`)) { await api.patchProject(p.id, { bypass: !p.bypass }); await reloadProjects(); } }}
                          >BYPASS</button>
```

- [ ] **Step 4: Restyle the footer (new session button + workspace row, lines 235 and the JSX just above it)**

Change:
```tsx
      <button className="m-3 rounded bg-zinc-100 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40" disabled={!projects.length} onClick={() => setUi({ newSession: true, newFor: null })}>+ Nova sessão</button>
```
to:
```tsx
      <button className="m-3 flex items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900 disabled:opacity-40" disabled={!projects.length} onClick={() => setUi({ newSession: true, newFor: null })}>+ Nova sessão</button>
```

- [ ] **Step 4b: Restyle the "mostrar arquivadas" checkbox (DESIGN.md "Checkboxes & Radio Buttons")**

Change:
```tsx
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> mostrar arquivadas
        </label>
```
to:
```tsx
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <input type="checkbox" className="h-3.5 w-3.5 rounded-sm border border-zinc-700 bg-zinc-900 accent-zinc-100" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> mostrar arquivadas
        </label>
```
(`accent-color` is the one native-checkbox styling hook Tailwind's `accent-*` utility maps to — it keeps the native input, tinting the checked state to match the design system's white-fill convention, no custom SVG/component needed.)

- [ ] **Step 5: Restyle the outer `<aside>` (line 103) and section spacing (line 116)**

Change:
```tsx
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-zinc-800">
```
to:
```tsx
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-zinc-800/70 bg-zinc-950">
```
and change:
```tsx
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
```
to:
```tsx
      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-2">
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 7: Manual check**

Reload the app, confirm: search bar has a visible container border (not just a background), section labels are now small uppercase mono text, `lean`/`rota` toggles read as neutral outlined chips, `BYPASS` reads as a rose-tinted warning chip (never solid red), sidebar still fully functional (search, collapse, session actions, add project/server).

- [ ] **Step 8: Commit**

```bash
git add web/src/features/projects/Sidebar.tsx
git commit -m "style: restyle sidebar to precision-dark chrome"
```

---

### Task 3: Top bar — Tabs + Chat header + GitBar merged into the two-row header

**Files:**
- Modify: `web/src/features/sessions/Tabs.tsx`
- Modify: `web/src/features/chat/GitBar.tsx`
- Modify: `web/src/features/chat/Chat.tsx:122-142` (the `<header>` + `<GitBar>` + connection-status block)

**Interfaces:** No props/types change on `Tabs`, `GitBar`, or `Chat`. Consumes: Task 1's fonts, Task 2's sidebar width/border convention (`border-zinc-800/70`) for visual consistency.

- [ ] **Step 1: Restyle `Tabs.tsx`**

Change:
```tsx
    <div className="flex shrink-0 overflow-x-auto border-b border-zinc-800 text-sm">
      {tabs.map((t) => {
        const name = rows[t.projectId]?.find((r) => r.sessionId === t.sessionId)?.name ?? 'Sessão';
        const state = chats[t.sessionId]?.state;
        const color = state === 'awaiting_permission' ? 'bg-amber-500 animate-pulse' : state === 'running' ? 'bg-blue-500 animate-pulse' : attention[t.sessionId] ? 'bg-green-500' : 'bg-zinc-600';
        return (
          <div
            key={t.sessionId}
            role="tab"
            onClick={() => open(t.projectId, t.sessionId)}
            onAuxClick={(e) => { if (e.button === 1) closeTab(t.sessionId); }}
            className={`group flex max-w-56 shrink-0 cursor-pointer items-center gap-2 border-r border-zinc-800 px-3 py-1.5 transition-colors duration-150 ${
              active?.sessionId === t.sessionId ? 'border-b-2 border-b-zinc-100 bg-zinc-900 text-zinc-100' : 'border-b-2 border-b-transparent text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
            <span className="truncate">{name}</span>
            <button className="text-zinc-600 opacity-0 transition-opacity duration-150 hover:text-zinc-100 group-hover:opacity-100" title="Fechar aba (a sessão continua rodando)" onClick={(e) => { e.stopPropagation(); closeTab(t.sessionId); }}>×</button>
          </div>
        );
      })}
    </div>
```
to:
```tsx
    <div className="flex shrink-0 overflow-x-auto border-b border-zinc-800/70 bg-zinc-950 text-sm">
      {tabs.map((t) => {
        const name = rows[t.projectId]?.find((r) => r.sessionId === t.sessionId)?.name ?? 'Sessão';
        const state = chats[t.sessionId]?.state;
        const color = state === 'awaiting_permission' ? 'bg-amber-500 animate-pulse' : state === 'running' ? 'bg-blue-500 animate-pulse' : attention[t.sessionId] ? 'bg-green-500' : 'bg-zinc-600';
        return (
          <div
            key={t.sessionId}
            role="tab"
            onClick={() => open(t.projectId, t.sessionId)}
            onAuxClick={(e) => { if (e.button === 1) closeTab(t.sessionId); }}
            className={`group flex max-w-56 shrink-0 cursor-pointer items-center gap-2 border-r border-zinc-800/70 px-3 py-1.5 text-xs transition-colors duration-150 ${
              active?.sessionId === t.sessionId ? 'border-b-2 border-b-zinc-100 bg-zinc-900/70 text-zinc-100' : 'border-b-2 border-b-transparent text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200'
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
            <span className="truncate">{name}</span>
            <button className="text-zinc-600 opacity-0 transition-opacity duration-150 hover:text-zinc-100 group-hover:opacity-100" title="Fechar aba (a sessão continua rodando)" onClick={(e) => { e.stopPropagation(); closeTab(t.sessionId); }}>×</button>
          </div>
        );
      })}
    </div>
```

- [ ] **Step 2: Restyle `GitBar.tsx`**

Change:
```tsx
  if (!g) return null;
  return (
    <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-1 text-xs text-zinc-400">
      <span className="font-mono text-zinc-300">⎇ {g.branch ?? '(detached)'}</span>
      {g.ahead > 0 && <span title="commits à frente do upstream">↑{g.ahead}</span>}
      {g.behind > 0 && <span title="commits atrás do upstream">↓{g.behind}</span>}
      <span>{g.changed} alterados</span>
      <span>{g.untracked} novos</span>
    </div>
  );
```
to:
```tsx
  if (!g) return null;
  return (
    <div className="flex items-center gap-2.5 border-b border-zinc-800/60 bg-zinc-950/80 px-4 py-1.5 font-mono text-[11px] text-zinc-400">
      <span className="text-zinc-300">⎇ {g.branch ?? '(detached)'}</span>
      {g.ahead > 0 && <span className="text-emerald-400" title="commits à frente do upstream">+{g.ahead}</span>}
      {g.behind > 0 && <span className="text-rose-400" title="commits atrás do upstream">-{g.behind}</span>}
      <span className="text-zinc-600">·</span>
      <span>{g.changed} alterados</span>
      <span>{g.untracked} novos</span>
    </div>
  );
```

- [ ] **Step 3: Restyle the Chat header block, `Chat.tsx:124-141`**

Change:
```tsx
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
        <h1 className="truncate text-[15px] font-semibold text-zinc-100">{name}</h1>
        <div className="flex items-center gap-2 text-xs text-zinc-500" title={usageTitle}>
          <span className="font-mono">${chat.totals.costUsd.toFixed(4)}</span>
          <span className="text-zinc-700">·</span>
          <span>{fmtTokens(chat.totals.input + chat.totals.output)} tokens</span>
        </div>
        <div className="flex items-center justify-end gap-3">
          {!up && <span className="text-xs text-red-400">desconectado…</span>}
          {busy && <button className="rounded border border-zinc-600 px-2 py-0.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800" onClick={interrupt}>Pausar</button>}
          <button className={`rounded border px-2 py-0.5 text-xs transition-colors hover:bg-zinc-800 ${ui.term ? 'border-zinc-500 text-zinc-200' : 'border-zinc-700 text-zinc-400'}`} title="Subagentes e comandos ! (Ctrl+J)" onClick={() => setUi({ term: !ui.term })}>Terminal</button>
        </div>
      </header>
      <GitBar projectId={active.projectId} refreshKey={`${active.sessionId}:${busy ? 'busy' : 'rest'}`} />
      {connState !== 'up' && (
        <div className="border-b border-amber-900 bg-amber-950/40 px-4 py-1 text-xs text-amber-300">
          Servidor {connLabel}: {connState === 'down' ? 'sem conexão. O turno em andamento termina no servidor e o histórico completo aparece ao reconectar.' : 'reconectando…'}
        </div>
      )}
```
to:
```tsx
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800/60 bg-zinc-950/90 px-4 py-2.5 backdrop-blur-md">
        <h1 className="truncate text-sm font-medium tracking-tight text-zinc-100">{name}</h1>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1 font-mono text-xs text-zinc-400 sm:flex" title={usageTitle}>
            <span className="text-zinc-300">${chat.totals.costUsd.toFixed(4)}</span>
            <span className="text-zinc-600">·</span>
            <span>{fmtTokens(chat.totals.input + chat.totals.output)} tokens</span>
          </div>
          {!up && <span className="text-xs text-rose-400">desconectado…</span>}
          {busy && <button className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900" onClick={interrupt}>Pausar</button>}
          <button className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${ui.term ? 'border-zinc-700 bg-zinc-900 text-zinc-100' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'}`} title="Subagentes e comandos ! (Ctrl+J)" onClick={() => setUi({ term: !ui.term })}>Terminal</button>
        </div>
      </header>
      <GitBar projectId={active.projectId} refreshKey={`${active.sessionId}:${busy ? 'busy' : 'rest'}`} />
      {connState !== 'up' && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-1 text-xs text-amber-400">
          Servidor {connLabel}: {connState === 'down' ? 'sem conexão. O turno em andamento termina no servidor e o histórico completo aparece ao reconectar.' : 'reconectando…'}
        </div>
      )}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Manual check**

Confirm: tabs bar sits flush above the header with matching hairline borders, header cost/tokens pill only shows on `sm:` and up (mobile keeps it hidden, matching the mockup's `hidden md:flex` pattern), git bar reads `+N`/`-N` in emerald/rose instead of plain text, disconnected banner is now a subtle amber tint instead of a solid dark-amber block.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/sessions/Tabs.tsx web/src/features/chat/GitBar.tsx web/src/features/chat/Chat.tsx
git commit -m "style: restyle tabs, git bar and chat header to precision-dark chrome"
```

---

### Task 4: Chat message bubbles + turn phase indicator + turn summary

**Files:**
- Modify: `web/src/features/chat/Chat.tsx:19-59` (`ItemView`, `TurnLoading`, `TurnSummary`)

**Interfaces:** No props/types change. `TurnLoading`/`TurnSummary` keep the same signatures.

- [ ] **Step 1: Restyle the user message bubble, `Chat.tsx:19-30`**

Change:
```tsx
  if (it.kind === 'user') {
    const bubble = it.text.includes('```')
      ? <div className="ml-auto max-w-[80%] rounded-lg bg-zinc-800 px-3 py-2"><Markdown text={it.text} /></div>
      : <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-lg bg-zinc-800 px-3 py-2">{it.text}</div>;
    if (!it.routedModel) return bubble;
    return (
      <div className="ml-auto max-w-[80%]">
        <div className="mb-1 text-right text-[10px] text-zinc-600">roteado → {it.routedModel === 'haiku' ? 'Haiku' : 'Sonnet 5'}</div>
        {bubble}
      </div>
    );
  }
```
to:
```tsx
  if (it.kind === 'user') {
    const bubble = it.text.includes('```')
      ? <div className="ml-auto max-w-[80%] rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 shadow-sm"><Markdown text={it.text} /></div>
      : <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 shadow-sm">{it.text}</div>;
    if (!it.routedModel) return bubble;
    return (
      <div className="ml-auto max-w-[80%]">
        <div className="mb-1 flex items-center justify-end gap-1.5 font-mono text-[11px] text-zinc-500">
          <span className="material-symbols-outlined text-[12px]">alt_route</span>
          roteado → {it.routedModel === 'haiku' ? 'Haiku' : 'Sonnet 5'}
        </div>
        {bubble}
      </div>
    );
  }
```

- [ ] **Step 2: Restyle the error bubble, `Chat.tsx:32`**

Change:
```tsx
  if (it.kind === 'error') return <div className="whitespace-pre-wrap rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{it.text}</div>;
```
to:
```tsx
  if (it.kind === 'error') return <div className="whitespace-pre-wrap rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{it.text}</div>;
```

- [ ] **Step 3: Restyle `TurnLoading`, `Chat.tsx:38-47`**

Change:
```tsx
function TurnLoading({ phase, startedAt, now }: { phase: 'routing' | 'thinking'; startedAt: number; now: number }) {
  const secs = Math.max(0, Math.round((now - startedAt) / 1000));
  const dot = phase === 'routing' ? 'routing-dot' : 'thinking-dot';
  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
      <span className="flex items-center gap-0.5"><span className={dot} /><span className={dot} /><span className={dot} /></span>
      {phase === 'routing' ? 'Model Routing is helping you' : 'Claude Code is thinking'} … ({secs}s)
    </div>
  );
}
```
to:
```tsx
function TurnLoading({ phase, startedAt, now }: { phase: 'routing' | 'thinking'; startedAt: number; now: number }) {
  const secs = Math.max(0, Math.round((now - startedAt) / 1000));
  const dot = phase === 'routing' ? 'routing-dot' : 'thinking-dot';
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1 font-mono text-[11px] text-zinc-400">
      <span className="flex items-center gap-0.5"><span className={dot} /><span className={dot} /><span className={dot} /></span>
      {phase === 'routing' ? 'Model Routing is helping you' : 'Claude Code is thinking'} … ({secs}s)
    </div>
  );
}
```

- [ ] **Step 4: Restyle `TurnSummary`, `Chat.tsx:49-59`**

Change:
```tsx
function TurnSummary({ modelUsage, bypass }: { modelUsage: Record<string, ModelUsage>; bypass: boolean }) {
  const cost = Object.values(modelUsage).reduce((s, u) => s + u.costUsd, 0);
  const tok = Object.values(modelUsage).reduce((s, u) => s + u.input + u.output, 0);
  const models = Object.keys(modelUsage).map((id) => id.replace(/^claude-/, '').replace(/-\d{8}$/, '')).join(' + ');
  return (
    <div className="text-center text-xs text-zinc-600">
      turno concluído — ${cost.toFixed(4)} · {fmtTokens(tok)} tokens · {models}
      {bypass && <span className="ml-2 rounded bg-red-950/60 px-1.5 py-0.5 text-[10px] text-red-400">bypass</span>}
    </div>
  );
}
```
to:
```tsx
function TurnSummary({ modelUsage, bypass }: { modelUsage: Record<string, ModelUsage>; bypass: boolean }) {
  const cost = Object.values(modelUsage).reduce((s, u) => s + u.costUsd, 0);
  const tok = Object.values(modelUsage).reduce((s, u) => s + u.input + u.output, 0);
  const models = Object.keys(modelUsage).map((id) => id.replace(/^claude-/, '').replace(/-\d{8}$/, '')).join(' + ');
  return (
    <div className="flex items-center justify-center gap-2 text-center font-mono text-[11px] text-zinc-600">
      turno concluído — ${cost.toFixed(4)} · {fmtTokens(tok)} tokens · {models}
      {bypass && <span className="rounded-sm border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[10px] tracking-wider text-rose-400/80">bypass</span>}
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 6: Manual check**

Send a message, confirm the bubble now has a visible border and shadow instead of a flat fill; toggle Model Routing on and confirm the "roteado →" line now shows the route icon; check that a finished turn's summary line and the bypass badge (only visible on a bypass-enabled project) both read correctly.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/chat/Chat.tsx
git commit -m "style: restyle chat bubbles, turn indicator and turn summary"
```

---

### Task 5: Permission requests + ToolCard + AskUserQuestionModal

**Files:**
- Modify: `web/src/features/chat/Chat.tsx:147-160` (inline permission-request block)
- Modify: `web/src/features/chat/ToolCard.tsx`
- Modify: `web/src/features/chat/AskUserQuestionModal.tsx`

**Interfaces:** No props/types change anywhere in this task.

- [ ] **Step 1: Restyle the permission-request block, `Chat.tsx:147-160`**

Per Review Focus (semantic-color misuse): "Permitir" moves from solid green to the mockup's primary button (`zinc-100`/`zinc-950`), "Negar" moves from solid `zinc-700` to a ghost/destructive-tinted button.

Change:
```tsx
        {chat.pending.filter((p) => !isAskUserQuestion(p)).map((p) => (
          <div key={p.reqId} className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm">
            <div className="font-medium">
              {p.toolName === 'request_model_upgrade'
                ? <>Claude quer trocar pra <span className="text-zinc-100">Sonnet 5</span> — {String((p.input as { reason?: unknown } | null)?.reason ?? '')}</>
                : <>Permitir <code>{p.toolName}</code>?</>}
            </div>
            {p.toolName !== 'request_model_upgrade' && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-zinc-300">{json(p.input)}</pre>}
            <div className="mt-2 flex gap-2">
              <button className="rounded bg-green-700 px-3 py-1 text-white" onClick={() => answer(p.reqId, true)}>Permitir</button>
              <button className="rounded bg-zinc-700 px-3 py-1" onClick={() => answer(p.reqId, false)}>Negar</button>
            </div>
          </div>
        ))}
```
to:
```tsx
        {chat.pending.filter((p) => !isAskUserQuestion(p)).map((p) => (
          <div key={p.reqId} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 shadow-md">
            <div className="flex items-center gap-2.5 border-b border-zinc-800/80 bg-zinc-900/60 px-4 py-3">
              <span className="material-symbols-outlined text-[18px] text-amber-400">lock</span>
              <div className="text-xs font-semibold text-zinc-100">
                {p.toolName === 'request_model_upgrade'
                  ? <>Claude quer trocar pra <span className="text-zinc-100">Sonnet 5</span> — {String((p.input as { reason?: unknown } | null)?.reason ?? '')}</>
                  : <>Permitir <code className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[11px]">{p.toolName}</code>?</>}
              </div>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {p.toolName !== 'request_model_upgrade' && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800/90 bg-zinc-950 p-3 font-mono text-xs text-zinc-300">{json(p.input)}</pre>}
              <div className="flex items-center gap-1.5">
                <button className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-all hover:bg-zinc-200 active:scale-[0.98]" onClick={() => answer(p.reqId, true)}>Permitir</button>
                <button className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400" onClick={() => answer(p.reqId, false)}>Negar</button>
              </div>
            </div>
          </div>
        ))}
```

- [ ] **Step 2: Restyle `ToolCard.tsx`**

Change:
```tsx
const tones = {
  plain: 'bg-zinc-900 text-zinc-300',
  add: 'bg-green-950/40 text-green-300',
  del: 'bg-red-950/40 text-red-300',
  err: 'bg-red-950/40 text-red-300',
} as const;

function Block({ text, tone = 'plain' }: { text: string; tone?: keyof typeof tones }) {
  return <pre className={`max-h-64 overflow-auto whitespace-pre-wrap rounded px-2 py-1 font-mono text-xs ${tones[tone]}`}>{text}</pre>;
}
```
to:
```tsx
const tones = {
  plain: 'bg-zinc-900 text-zinc-300',
  add: 'bg-emerald-500/10 text-emerald-300',
  del: 'bg-rose-500/10 text-rose-300',
  err: 'bg-rose-500/10 text-rose-300',
} as const;

function Block({ text, tone = 'plain' }: { text: string; tone?: keyof typeof tones }) {
  return <pre className={`max-h-64 overflow-auto whitespace-pre-wrap rounded-md px-2 py-1 font-mono text-xs ${tones[tone]}`}>{text}</pre>;
}
```
and change:
```tsx
    <details className="rounded border border-zinc-800 px-3 py-1 text-sm text-zinc-400">
```
to:
```tsx
    <details className="rounded-md border border-zinc-800/80 bg-zinc-900/30 px-3 py-1.5 text-sm text-zinc-400">
```

- [ ] **Step 3: Restyle `AskUserQuestionModal.tsx`**

Change:
```tsx
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl">
```
to:
```tsx
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]">
```
and change the option button:
```tsx
                      className={`block w-full rounded border px-3 py-2 text-left text-sm transition-colors duration-150 ${on ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/50'}`}
```
to:
```tsx
                      className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition-colors duration-150 ${on ? 'border-zinc-100 bg-zinc-800' : 'border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/50'}`}
```
and change the submit button:
```tsx
          <button className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 disabled:opacity-40" disabled={!canSubmit} onClick={submit}>Responder</button>
```
to:
```tsx
          <button className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-40" disabled={!canSubmit} onClick={submit}>Responder</button>
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Manual check**

Trigger a real tool permission prompt (or the `request_model_upgrade` flow with routing on), confirm "Permitir" is now a solid light button and "Negar" is a ghost button that tints rose on hover — never a solid green/gray pair. Open the `AskUserQuestion` modal (ask Claude a question that triggers it) and confirm selected options highlight with a white border, not a gray one.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/chat/Chat.tsx web/src/features/chat/ToolCard.tsx web/src/features/chat/AskUserQuestionModal.tsx
git commit -m "style: restyle permission cards, tool card and ask-user-question modal"
```

---

### Task 6: Terminal panel (CommandsPanel) + ShellCard

**Files:**
- Modify: `web/src/features/chat/CommandsPanel.tsx`
- Modify: `web/src/features/chat/ShellCard.tsx`

**Interfaces:** No props/types change.

- [ ] **Step 1: Restyle `CommandsPanel.tsx`'s outer container and tab bar**

Change:
```tsx
    <div className="flex h-56 shrink-0 flex-col border-t border-zinc-800 bg-zinc-950 text-xs">
      {tasks.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-900 px-2 pt-1.5 font-sans">
          <button onClick={() => setTab('main')} className={`shrink-0 rounded-t px-2 py-1 transition-colors duration-150 ${tab === 'main' ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>Principal</button>
          {tasks.map((t) => (
            <button key={t.taskId} onClick={() => setTab(t.taskId)} title={t.label} className={`flex shrink-0 items-center gap-1.5 rounded-t px-2 py-1 transition-colors duration-150 ${tab === t.taskId ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${taskDot[t.status]}`} />
              <span className="max-w-32 truncate">{t.label}</span>
            </button>
          ))}
        </div>
      )}
```
to:
```tsx
    <div className="flex h-56 shrink-0 flex-col border-t border-zinc-800/80 bg-zinc-950 text-xs">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 px-3.5 py-2 font-sans">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px] text-zinc-400">terminal</span>
          <span className="text-xs font-medium text-zinc-200">Terminal</span>
          <span className="rounded-sm border border-zinc-800 bg-zinc-900 px-1.5 py-0.2 font-mono text-[9px] uppercase text-zinc-400">Read-only</span>
        </div>
      </div>
      {tasks.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-900 px-2 pt-1.5 font-sans">
          <button onClick={() => setTab('main')} className={`shrink-0 rounded-t px-2 py-1 transition-colors duration-150 ${tab === 'main' ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>Principal</button>
          {tasks.map((t) => (
            <button key={t.taskId} onClick={() => setTab(t.taskId)} title={t.label} className={`flex shrink-0 items-center gap-1.5 rounded-t px-2 py-1 transition-colors duration-150 ${tab === t.taskId ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${taskDot[t.status]}`} />
              <span className="max-w-32 truncate">{t.label}</span>
            </button>
          ))}
        </div>
      )}
```

Note: this adds a header row the current component doesn't have (the mockup's terminal drawer always shows a "Terminal Output / READ-ONLY" header) — it's purely presentational (a `<div>` with static text and the existing `terminal` icon glyph used elsewhere in the mockup), no new state, no new prop.

- [ ] **Step 2: Restyle the output body**

Change:
```tsx
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono">
        {tab === 'main' ? (
          <>
            {shellRows.length === 0 && <div className="text-zinc-600">Nenhum comando ainda. Use <code>!comando</code> no chat para rodar um.</div>}
            {shellRows.map((r) => (
              <div key={r.id} className="mb-3">
                <div className="text-green-400">$ {r.command} <span className="font-sans text-zinc-600">(você)</span>{r.output === undefined && <span className="text-zinc-500"> …executando</span>}</div>
                {r.output !== undefined && <pre className={`whitespace-pre-wrap ${r.exitCode ? 'text-red-400' : 'text-zinc-400'}`}>{r.output.slice(0, 6000)}</pre>}
              </div>
            ))}
          </>
```
to:
```tsx
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 font-mono text-[11px] leading-relaxed">
        {tab === 'main' ? (
          <>
            {shellRows.length === 0 && <div className="text-zinc-600">Nenhum comando ainda. Use <code>!comando</code> no chat para rodar um.</div>}
            {shellRows.map((r) => (
              <div key={r.id} className="mb-3">
                <div className="text-emerald-400/90">$ {r.command} <span className="font-sans text-zinc-600">(você)</span>{r.output === undefined && <span className="text-zinc-500"> …executando</span>}</div>
                {r.output !== undefined && <pre className={`whitespace-pre-wrap ${r.exitCode ? 'text-rose-400' : 'text-zinc-400'}`}>{r.output.slice(0, 6000)}</pre>}
              </div>
            ))}
          </>
```

- [ ] **Step 3: Restyle `ShellCard.tsx`**

Change:
```tsx
    <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-green-400">$ {it.command}</span>
        <span className={`shrink-0 font-sans ${running ? 'text-zinc-500' : failed ? 'text-red-400' : 'text-zinc-500'}`}>
          {running ? 'executando…' : it.exitCode === null ? 'interrompido' : `código ${it.exitCode}`}
        </span>
      </div>
      {!running && it.output && <pre className={`mt-1 max-h-64 overflow-auto whitespace-pre-wrap ${failed ? 'text-red-300' : 'text-zinc-300'}`}>{it.output}</pre>}
```
to:
```tsx
    <div className="rounded-md border border-zinc-800/90 bg-zinc-950 px-3 py-2 font-mono text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-emerald-400/90">$ {it.command}</span>
        <span className={`shrink-0 font-sans ${running ? 'text-zinc-500' : failed ? 'text-rose-400' : 'text-zinc-500'}`}>
          {running ? 'executando…' : it.exitCode === null ? 'interrompido' : `código ${it.exitCode}`}
        </span>
      </div>
      {!running && it.output && <pre className={`mt-1 max-h-64 overflow-auto whitespace-pre-wrap ${failed ? 'text-rose-300' : 'text-zinc-300'}`}>{it.output}</pre>}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Manual check (Review Focus: monospace layout survives font swap)**

Open the terminal panel (Ctrl+J), run a `!ls -la` (or any `!` command with columnar output), confirm columns still line up under Geist Mono and the new header row doesn't push content oddly; confirm task tabs still switch correctly.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/chat/CommandsPanel.tsx web/src/features/chat/ShellCard.tsx
git commit -m "style: restyle terminal panel and shell card"
```

---

### Task 7: Bottom input dock + SlashMenu

**Files:**
- Modify: `web/src/features/chat/Chat.tsx:172-183` (textarea dock)
- Modify: `web/src/features/chat/SlashMenu.tsx`

**Interfaces:** No props/types change.

- [ ] **Step 1: Restyle the input dock, `Chat.tsx:172-183`**

Change:
```tsx
      <div className="relative border-t border-zinc-800 p-3">
        {menuOpen && <SlashMenu items={matches} sel={Math.min(sel, matches.length - 1)} lean={!!project?.lean} onPick={pick} onHover={setSel} />}
        <textarea
          ref={input}
          className="h-20 w-full resize-none rounded-md border border-zinc-800 bg-zinc-900 p-2.5 text-sm outline-none transition-colors duration-150 focus:border-zinc-600 disabled:opacity-50"
          placeholder={busy ? 'Aguarde a resposta…' : 'Mensagem… ("/" comandos · "!" shell · Enter envia · Shift+Enter quebra linha)'}
          value={text}
          disabled={busy || !up}
          onChange={(e) => { setText(e.target.value); setSel(0); setDismissed(false); }}
          onKeyDown={onKeyDown}
        />
      </div>
```
to:
```tsx
      <div className="relative border-t border-zinc-800/70 bg-zinc-950 p-3">
        {menuOpen && <SlashMenu items={matches} sel={Math.min(sel, matches.length - 1)} lean={!!project?.lean} onPick={pick} onHover={setSel} />}
        <textarea
          ref={input}
          className="h-20 w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/90 p-3 text-sm text-zinc-100 outline-none transition-colors duration-150 placeholder:text-zinc-500 focus:border-zinc-700 disabled:opacity-50"
          placeholder={busy ? 'Aguarde a resposta…' : 'Mensagem… ("/" comandos · "!" shell · Enter envia · Shift+Enter quebra linha)'}
          value={text}
          disabled={busy || !up}
          onChange={(e) => { setText(e.target.value); setSel(0); setDismissed(false); }}
          onKeyDown={onKeyDown}
        />
      </div>
```

- [ ] **Step 2: Restyle `SlashMenu.tsx`**

Change:
```tsx
    <div className="absolute bottom-full left-0 right-0 mb-1 max-h-72 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl" role="listbox">
      {items.map((c, i) => (
        <button
          key={c.name}
          role="option"
          aria-selected={i === sel}
          // mouseDown (não click): escolhe antes de o textarea perder o foco
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${i === sel ? 'bg-zinc-800' : ''}`}
        >
          <span className="shrink-0 font-mono text-zinc-100">/{c.name}</span>
          {c.argumentHint && <span className="shrink-0 font-mono text-xs text-zinc-500">{c.argumentHint}</span>}
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{c.description}</span>
          <span className="shrink-0 rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{c.builtin ? 'nativo' : 'skill/plugin'}</span>
        </button>
      ))}
      <div className="border-t border-zinc-800 px-3 py-1 text-[10px] text-zinc-500">
        ↑↓ navega · Tab/Enter escolhe · Esc fecha{lean ? ' · modo lean: skills e plugins não estão carregados' : ''}
      </div>
    </div>
```
to:
```tsx
    <div className="absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/95 p-1.5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)] backdrop-blur-md" role="listbox">
      {items.map((c, i) => (
        <button
          key={c.name}
          role="option"
          aria-selected={i === sel}
          // mouseDown (não click): escolhe antes de o textarea perder o foco
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-100 ${i === sel ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
        >
          <span className="shrink-0 font-mono text-zinc-100">/{c.name}</span>
          {c.argumentHint && <span className="shrink-0 font-mono text-xs text-zinc-500">{c.argumentHint}</span>}
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{c.description}</span>
          <span className="shrink-0 rounded-sm bg-zinc-800/80 px-1.5 text-[10px] text-zinc-400">{c.builtin ? 'nativo' : 'skill/plugin'}</span>
        </button>
      ))}
      <div className="mt-0.5 border-t border-zinc-800 px-2.5 py-1.5 font-mono text-[10px] text-zinc-500">
        ↑↓ navega · Tab/Enter escolhe · Esc fecha{lean ? ' · modo lean: skills e plugins não estão carregados' : ''}
      </div>
    </div>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 4: Manual check**

Type `/` in the input, confirm the popover now has rounded corners, backdrop blur, and hover feedback on unselected rows (not just the keyboard-selected one); confirm keyboard navigation (arrows, Tab, Enter, Esc) still works exactly as before.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/chat/Chat.tsx web/src/features/chat/SlashMenu.tsx
git commit -m "style: restyle input dock and slash-command menu"
```

---

### Task 8: Whole-app visual QA pass (light + dark)

**Files:** none (no code changes expected; this task only fixes regressions found while checking)

**Interfaces:** N/A.

- [ ] **Step 1: Run the full build**

Run: `npm run typecheck && npm run build`
Expected: both succeed (final confirmation after all 7 prior tasks).

- [ ] **Step 2: Manual dark-mode pass**

Run `npm run dev:server` + `npm run dev:web`. Walk through every screen touched by Tasks 2-7 in dark mode (the default): sidebar, tabs, chat header, a normal turn, a permission request, the `AskUserQuestion` modal, the terminal panel, the input dock with the slash menu open. Compare side by side with `new design/Pasted image.png`. Note any visible mismatch.

- [ ] **Step 3: Manual light-mode pass (Review Focus: light theme regression)**

Cycle the theme to light (sidebar theme button, or `cycleTheme()`) and repeat Step 2's walkthrough. Every hairline border, badge, and text color must still read correctly — since `web/src/index.css:15-22` remaps the zinc/amber/red CSS variables for light mode, any class from Tasks 2-7 that used `zinc-*`/`amber-*`/`red-*` (or their `emerald-*`/`rose-*` counterparts that this plan introduced, which are **not** remapped by `index.css` — see Step 4) should already flip.

- [ ] **Step 4: Fix any `emerald`/`rose` literal that doesn't flip in light mode**

This plan introduces `emerald-*`/`rose-*` classes (replacing raw `green-*`/`red-*`) in Tasks 2-6, but `web/src/index.css`'s light-mode block only remaps `--color-amber-*`, `--color-red-*`, and `--color-green-*` (lines 19-21) — it does **not** remap `emerald`/`rose`, which are a different Tailwind color scale. If Step 3 shows any emerald/rose element unreadable in light mode, add the missing mirror/remap lines to `web/src/index.css` following the exact pattern already there:

```css
  --color-emerald-950: var(--green50); --color-emerald-400: var(--green700); --color-emerald-300: var(--green800);
  --color-rose-950: var(--red50); --color-rose-400: var(--red700); --color-rose-300: var(--red800);
```
(add these two lines inside the existing `body[data-theme='light'] { ... }` block, right after the `--color-green-*` line at `index.css:21`, and add matching `--emerald*`/`--rose*` mirrors next to the existing `--green*`/`--red*` ones in the `:root` block at `index.css:4-10` if the exact shade you used isn't already mirrored there).

- [ ] **Step 5: Commit (only if Step 4 required a fix; otherwise skip)**

```bash
git add web/src/index.css
git commit -m "fix: mirror emerald/rose color vars for light theme"
```

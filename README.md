# Code Nest

Web app to run and chat with [Claude Code](https://claude.com/claude-code) sessions straight from the browser — no terminal required. Supports local and remote (SSH) projects, multiple sessions in tabs, and automatic Haiku/Sonnet model routing per message.

## Why

The terminal is great for coding, not so great for tracking several Claude Code sessions at once, reviewing history, or operating a remote server without keeping an SSH tab open all day. This project fixes that: a thin web interface on top of the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), backend running locally (loopback only) with the browser as the client.

## Features

**Chat and sessions**
- **Chat with Claude**: streaming responses, rendered markdown (GFM + syntax highlight), a turn indicator that shows which tool is running, and cost/tokens per turn.
- **Multiple sessions/tabs**: each session keeps running in the background even with the tab closed.
- **File attachments**: attach files from the project's machine (local or SSH); images (up to 5 MB) go to Claude as real images, other files as a path reference.
- **Slash commands** with autocomplete. In the composer, a command is highlighted blue when it exists and red when it doesn't. Commands that would break the UI's rules (`/clear`, `/model`, `/fast`, `/effort`, `/config`…) are blocked, with an explanation.
- **`/mcp` panel**: the same view as the terminal's `/mcp`. It shows servers grouped by scope with their status, details and tools, and has Reconnect/Enable/Disable buttons. claude.ai connectors that need sign-in link straight to claude.ai.
- **Skills per turn**: when a skill runs in a turn (typed by you as `/skill`, or invoked by Claude), the turn summary gets a "skill invocada" badge. It opens a modal showing who invoked each skill, what it does, its arguments and its result.
- **Refresh**: reloads skills and plugins from disk into the open session (for example, after creating a skill or installing a plugin) and refreshes the `/` command list, without restarting the session.
- **Shell mode (`!cmd`)**: runs a command in the project directory without going through the model, with the `!` prefix highlighted in the composer. The output can be sent to Claude on demand.

**Projects**
- **Local and remote (SSH) projects**: opens `claude` sessions on a remote host as if it were local. It survives SSH drops: the remote process finishes the turn on its own, and the UI reconnects and re-syncs history.
- **Folder browser**: pick the project directory by browsing the local or remote filesystem, instead of typing the path.
- **Per-project settings**: Lean mode (skips user hooks/plugins/skills/MCP/CLAUDE.md, much cheaper session start), Model Routing, and permission bypass (with explicit confirmation).
- **Model Routing**: per message, picks Haiku (fast/cheap) or Sonnet (more capable). It uses a text heuristic, with a throwaway Haiku classifier as a fallback, and can escalate to Sonnet mid-turn when a task turns out harder than expected. It is opt-in per project (or per session). When off, the fixed configured model runs with zero overhead.

**Visibility and control**
- **Spend dashboard**: today's spend, broken down by model and by project, with a per-project drill-down into recent sessions.
- **Read-only terminal**: shows `!cmd` runs and subagent logs (Task tool). It never accepts direct input, so permission approval is never bypassed.
- **Global settings**: default model/effort and remote (SSH) servers, editable at runtime.
- **Search/tags/favorites/archiving** for sessions, a **Git status bar**, **themes** (light/dark/system), **browser notifications**, **keyboard shortcuts**, a resizable sidebar, and a **command palette** (`Ctrl/Cmd+K`).

Only `haiku` and `sonnet` are used — Opus and Fable are blocked by design (cost), enforced on the backend on every model response, not just at initial config.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite + Tailwind 4, state in Zustand |
| Backend | Node.js + Hono + WebSocket (`ws`) |
| Orchestration | `@anthropic-ai/claude-agent-sdk` |
| Shared types | `shared` workspace (`@ccui/shared`) — same protocol contract on both sides |
| Language | Strict TypeScript, no `any`, 3 workspaces via npm workspaces |

No state-machine framework, no ORM, no Controller/Service layers — each file has one direct responsibility.

## Structure

```
web/     -> React SPA (chat, tabs, sidebar, settings, spend dashboard, read-only terminal)
server/  -> Hono API + WebSocket + Agent SDK runtime (local and SSH)
shared/  -> types and WebSocket event protocol used by both sides
docs/    -> architecture/frontend/backend/testing documentation
```

Full technical documentation lives in [`docs/architecture.md`](docs/architecture.md), [`docs/frontend.md`](docs/frontend.md), [`docs/backend.md`](docs/backend.md), and [`docs/testing.md`](docs/testing.md). Project rules and conventions (for humans or AI) live in [`CLAUDE.md`](CLAUDE.md).

**All project documentation, code, comments, and commits are in English.**

## Running it

Requires Node.js and the `claude` binary installed (`npm install -g @anthropic-ai/claude-code` or equivalent).

```bash
npm install

# development (2 terminals)
npm run dev:server   # backend in watch mode, port 4317
npm run dev:web       # Vite dev server for the frontend

# production
npm run build         # builds the frontend into web/dist
npm run start         # runs the backend, serving the static frontend
```

The backend automatically opens the browser at `http://127.0.0.1:4317/#token=...`. The token is generated on every run, and the backend only listens on loopback.

| Variable | Default | Purpose |
|---|---|---|
| `CCUI_PORT` | `4317` | HTTP/WebSocket port |
| `CCUI_DATA_DIR` | `~/.code-nest` | where config, projects and session metadata live |
| `CCUI_NO_OPEN` | unset | `1` = don't open the browser on start |

> Upgrading from a version named "Claude Code UI": on the first start, `~/.claude-code-ui` is moved to `~/.code-nest` automatically (only when `CCUI_DATA_DIR` isn't set).

To restart the app in production after changing code:

```bash
./restart.sh
```

## Validation

```bash
npm run typecheck   # tsc across the 3 workspaces (shared, server, web)
npm run build       # confirms the frontend compiles
```

No automated test suite by project choice (see [`docs/testing.md`](docs/testing.md)) — UI validation is manual, in the browser.

## Security

- Backend only listens on `127.0.0.1`/`localhost` (rejects any other host).
- Per-run auth token, required on every WebSocket/API connection.
- Permission bypass is explicit opt-in per project, never default.
- `/mcp` never sends server env vars or headers to the browser (they may carry credentials).
- Model allowlist (`haiku`/`sonnet`) is checked both when opening a session and on every SDK response — defense in depth against a runtime model switch.

## Status

| Version | Highlights |
|---|---|
| v1.0.0 | Local and SSH projects, chat/tabs/search/themes/git/shortcuts, Model Routing, subagent terminal |
| v1.1.0 | "Precision dark" visual redesign (sidebar, tabs, chat, cards, terminal, composer) |
| v1.2.0 | Renamed to Code Nest, global/per-project settings, folder browser, file attachments, spend dashboard, composer polish (slash/`!` highlighting, resizable box, running-tool indicator), per-session spend limit removed, `/mcp` panel |
| v1.3.0 | Skills-invoked badge and modal on the turn summary, Refresh button (reload skills/plugins into the session), Code Nest data dir (`~/.code-nest`) with automatic migration, updated docs |

The design and decision history for each feature is in `docs/superpowers/{specs,plans}/`.

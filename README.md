# Code Nest

Web app to run and chat with [Claude Code](https://claude.com/claude-code) sessions straight from the browser — no terminal required. Supports local and remote (SSH) projects, multiple sessions in tabs, and automatic Haiku/Sonnet model routing per message.

## Why

The terminal is great for coding, not so great for tracking several Claude Code sessions at once, reviewing history, or operating a remote server without keeping an SSH tab open all day. This project fixes that: a thin web interface on top of the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), backend running locally (loopback only) with the browser as the client.

## Features

- **Chat with Claude** — streaming responses, rendered markdown (GFM + syntax highlight), cost/tokens per turn.
- **Multiple sessions/tabs** — each session keeps running in the background even with the tab closed.
- **Local and remote (SSH) projects** — opens `claude` sessions on a remote host as if it were local; survives SSH drops (the remote process finishes the turn on its own, and the UI reconnects and re-syncs history).
- **Model Routing** — per message, decides between Haiku (fast/cheap) and Sonnet (more capable) via a text heuristic plus a disposable Haiku classifier fallback, with automatic mid-turn escalation when a task turns out more complex than expected. Opt-in per project — when off, it runs on the fixed configured model with zero overhead.
- **Read-only terminal** — shows commands run (`!cmd`) and subagent logs (Task tool), but never accepts direct input: permission approval is never bypassed.
- **Slash commands with autocomplete**, **search/tags/favorites/archiving** for sessions, **Git status bar**, **themes** (light/dark/system), **browser notifications**, **keyboard shortcuts**, and a **command palette** (`Ctrl/Cmd+K`).
- **Permission bypass** per project, with explicit confirmation — for anyone who wants to run without manual approval in trusted environments.

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
web/     -> React SPA (chat, tabs, sidebar, read-only terminal, themes)
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

The backend automatically opens the browser at `http://127.0.0.1:4317/#token=...` — the token is generated per run and it only listens on loopback.

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
- Model allowlist (`haiku`/`sonnet`) is checked both when opening a session and on every SDK response — defense in depth against a runtime model switch.

## Status

Phases 1 (local), 2 (SSH), 3 (markdown/tabs/search/theme/git/shortcuts), and 5 (subagent terminal) are implemented with typecheck passing. Design/decision history for each feature lives in `docs/superpowers/{specs,plans}/`.

# Testing

## Actual state (deliberate decision, not pending work)

The project **has no automated tests**. This was a deliberate user choice for this phase — don't suggest adding Vitest/Jest, `npm test`, or CI unless the user explicitly asks.

## Real commands available (`package.json`)

- `npm run typecheck` -> `tsc -p shared && tsc -p server && tsc -p web` — checks all 3 workspaces, no emitted output.
- `npm run build` -> `npm run build -w web` — production build of the frontend into `web/dist`.
- `npm run dev:server` — backend in watch mode (`tsx watch`), fixed dev token/origin.
- `npm run dev:web` — Vite dev server for the frontend.
- `npm run start` — runs the backend directly with `tsx` (production, serves static `web/dist`).
- `./restart.sh` — stops the running backend (via the lock's PID), builds, and starts it again in the background.

There is no `lint` script in `package.json` — don't document or suggest one until it exists.

## Validation available today

- **Typecheck**: `npm run typecheck` is the only automated correctness check that exists. Run it clean as the minimum bar before considering a change done.
- **Build**: `npm run build` confirms the frontend compiles/bundles.
- **Manual UI validation**: the browser isn't controllable by AI in this environment (only local Firefox is available, and its `--screenshot` fires before the SPA loads) — no screen has been visually verified by an AI. The user tests manually in the browser and reports what needs adjusting.

## What to check manually when relevant

When changing anything in `web/src/features/*` or the event protocol (`shared/src/index.ts`), ask the user to confirm manually (or verify it yourself if you can run `npm run dev:server` + `npm run dev:web` and open the browser):

- Chat renders and streams correctly (delta + completed).
- Tabs open/close and keep the session state running in the background.
- The turn-phase indicator (routing/thinking) appears and disappears at the right moment.
- The `AskUserQuestion` modal sends the right answer via `updatedInput`.
- The routing/bypass toggle in the Sidebar reflects in the actual behavior of the next message.
- The read-only terminal (`CommandsPanel`) shows `!cmd` and Task tabs without accepting input.
- Attachments: images arrive as images, other files as a path reference, local and SSH; interrupting while an attachment is still being read doesn't send it.
- Folder browser: navigating/selecting works on local and SSH connections, in both folder and file mode.
- Spend dashboard: today's totals match the turn summaries; the drill-down lists the right sessions.
- `/mcp`: the list matches the terminal's `/mcp` (with and without an open session); Reconnect/Enable/Disable refresh the same card; Lean projects show no user MCPs.
- Composer: `/command` coloring (blue/red), `!` highlight, resize, and blocked commands (`/clear`, `/model`…) show the explanation instead of being sent.

## Current limitation

Without an automated suite, UI flow regressions only surface during the user's manual testing — when touching shared code (`shared/src/index.ts`, `hub.ts`, `reduce.ts`), extra care in diff review replaces the safety net that tests would otherwise give.

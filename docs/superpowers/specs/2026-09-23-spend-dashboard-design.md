# Spend Dashboard — Design Spec

## Context

Sub-project 2 of 3 from the user's original request (filesystem browser — done; file attachments — done; this one). Independent of the other two — no shared code, can ship on its own.

**Autonomy note:** written under the user's standing session authorization (2026-09-22, "não vou estar na minha máquina") to proceed through spec → plan → implementation without waiting for approval at each stage. Real open decisions are marked **Ruling:** below.

## Goal

A new "Gastos" (spend) view, reached from a sidebar button: an overview of **today's** spend (total, most-used model, most-used project), and a per-project drill-down showing that project's all-time total plus its last 5 sessions with their individual costs. From the drill-down, a "Validar gastos" button opens a fresh session in that project and asks Claude (Haiku, self-escalating to Sonnet if needed — reusing the existing Model Routing escalation) to review the spend pattern and suggest optimizations.

## The hard part: where "today's spend" comes from

Today, `Transport.usage()` reads the tail of a session's `.jsonl` and returns only the **latest** `cost-state` line — a lifetime-cumulative total for that session (see `server/src/runtime/jsonl.ts`'s `lastCostState`). There is no existing per-day breakdown anywhere in the codebase; building one is the actual new work in this sub-project. The per-project drill-down and the "last 5 sessions" list need **no new aggregation at all** — they're already served by the existing cumulative `usage()` totals.

Each `cost-state` line in the jsonl carries no timestamp of its own, but it's a periodic checkpoint written after a turn — and every preceding `user`/`assistant` line **does** carry a `timestamp` field (confirmed against a real session file: `2026-09-22T21:18:47.635Z`). So: walk the file in order, remember the timestamp of the most recent message seen, and every time a `cost-state` line appears, record `{ ts: <that timestamp>, totals }` — a checkpoint. Today's spend for that session = (latest checkpoint's cumulative cost) − (the last checkpoint whose `ts` is before today's start), clamped to ≥0, same clamping `hub.ts`'s existing `diffModelUsage` already uses for per-turn deltas — this is the exact same idea, just applied by walking a file instead of watching live events.

**Ruling 1 (bounded read, not exact):** reading a whole multi-week session's full jsonl for every dashboard load doesn't scale. This aggregation reads a fixed, generous tail (8 MB) of each session file — enough to hold many days of typical activity, but not an unlimited guarantee. If a session has been open continuously for a long stretch without a checkpoint falling inside that 8 MB tail, today's number for that one session could quietly include a sliver of an earlier day. **Cost if wrong:** the daily total is very slightly overstated in a rare, long-lived-session edge case — not a billing figure (the whole app already flags cost as "an API-price estimate," see `Chat.tsx`'s existing `usageTitle`), so this rides the same disclaimer, not a new risk.

**Ruling 2 (scope of "most used"):** the request says "gasto total daquele dia somente" (today's total, specifically) but doesn't explicitly scope "most-used model"/"most-used project" to today too. Scoping the whole Overview to today is the only reading that makes it one coherent screen instead of mixing time windows silently — so "most-used model" and "most-used project" are today's numbers, derived from the same aggregation, not all-time. **Cost if wrong:** if the user actually wanted all-time "most used," that's a one-line change (drop the today-filter for those two, keep it for the total) — cheap to redo.

**Ruling 3 (what "Validar gastos" analyzes):** the request's wording ("abrirá uma sessão... enviar um prompt, contendo informações sobre a sessão, sobre os gastos") is ambiguous between "the one session I'm looking at" and "this project's recent spend." The button lives on the **project** drill-down (not on an individual session row), so it analyzes the *project's* recent pattern — its all-time total plus the last-5-sessions breakdown already on screen — not a single arbitrary session. **Cost if wrong:** if the user meant a per-session button instead, that's a different (smaller) button placement, not a different backend.

**Ruling 4 (how the escalation actually gets reused, zero new mechanism):** the app's existing Model Routing escalation (`request_model_upgrade` MCP tool) is wired only when a session opens with `routing: true` — but `routing` today lives only on `Project`, not on an individual `SessionMeta`, while `model`/`effort` already support a session-level override (`meta.model ?? project.model ?? default`, see `domain.ts`'s `openSpecFor`). This sub-project extends `SessionMeta` with an optional `routing` field, filling that one gap in an already-established hierarchy — not inventing a new concept. "Validar gastos" then just creates a normal new session with `model: 'haiku', routing: true` and sends the analysis prompt through the exact same `send()` path every other message uses. No new backend endpoint for the analysis itself.

## Non-goals

- No historical (multi-day) chart/trend — "today" only, per the request.
- No editing/deleting spend data — read-only view.
- No changes to the filesystem-browser or file-attachments sub-projects.
- No caching layer for the aggregation (see Ruling 5 in the plan's Review Focus if this turns out slow in practice with many projects — YAGNI for a first version, the dashboard is opened on demand, not polled).

## Backend

### `SessionMeta.routing` (small, reused hierarchy)

- `shared/src/index.ts`: `SessionMeta` gains `routing?: boolean`; `createSessionBody` gains `routing: z.boolean().optional()`.
- `server/src/domain.ts`: `openSpecFor`'s `routing: project.routing ?? false` becomes `routing: meta.routing ?? project.routing ?? false`.
- `server/src/routes.ts`: `POST /projects/:id/sessions` passes `routing: b.routing` into the created `SessionMeta`.

### Checkpoint parsing (`server/src/runtime/jsonl.ts`)

Two new pure functions, next to the existing `lastCostState`:

```ts
export interface CostCheckpoint { ts: number; totals: UsageTotals; modelUsage: Record<string, ModelUsage> }

// todas as linhas cost-state do trecho, associadas ao timestamp da mensagem mais recente já vista até ali
export function costCheckpoints(jsonlTail: string): CostCheckpoint[] { ... }

// delta entre o checkpoint mais recente e o último anterior a `todayStartMs` (clamp >=0, mesmo padrão de hub.ts diffModelUsage)
export function todayDelta(checkpoints: CostCheckpoint[], todayStartMs: number): { totals: UsageTotals; modelUsage: Record<string, ModelUsage> } { ... }
```

### `Transport.costCheckpoints` (new method, local + SSH)

```ts
/** todos os checkpoints de custo num trecho generoso (8 MB) do fim do jsonl; null se a sessão não existe/sem leitura */
costCheckpoints(sessionId: string, cwd: string): Promise<CostCheckpoint[] | null>;
```

- **`local-transport.ts`**: read up to the last 8 MB of the file (same open/seek pattern `usage()` already uses, just one fixed larger size instead of the retry ladder), run `costCheckpoints()` on it.
- **`ssh-transport.ts`**: `tail -c 8388608 <file>` via the existing `sh()` helper, same idea as `usage()`'s `tail -c 4194304` at double the window (today's aggregation needs more history than "just the latest line").

### `GET /api/usage/today`

Loops every project, every session in it (via the existing `runtime.listSessions`, same 50-session cap already in place elsewhere), calls `costCheckpoints` + `todayDelta` per session, accumulates:

```ts
{ totalCostUsd: number; byModel: Record<string, number>; byProject: Record<string, number> } // byProject keyed by project id
```

### `GET /api/projects/:id/usage`

Reuses the *existing* `Transport.usage()` (no new I/O logic) across every session of the project (same list, no new cap): sums all sessions' cumulative totals for the project grand total, and returns the 5 most-recently-modified with their individual totals:

```ts
{ totalCostUsd: number; sessions: Array<{ sessionId: string; name: string; lastModified: number; costUsd: number }> }
```

## Frontend

- `shared/src/index.ts`: response types `TodayUsage`, `ProjectUsageView` mirroring the two route shapes above.
- `api.ts`: `usageToday()`, `projectUsage(id)`.
- `store.ts`: `Ui` gains `spend: boolean`.
- `Sidebar.tsx`: a new footer button "Gastos" next to the existing "Configurações" one, `onClick={() => setUi({ spend: true })}`.
- `App.tsx`: when `ui.spend` is true, render `<SpendDashboard onClose={() => setUi({ spend: false })} />` in place of the `<Tabs/><Chat/>` pair (same conditional-swap pattern `ConnectScreen` already uses for the whole main area).
- `web/src/features/spend/SpendDashboard.tsx` (new): fetches `usageToday()` on mount; shows total, the model/project with the highest value in `byModel`/`byProject` (computed client-side, no extra request), and a clickable list of every project in `byProject` (name resolved from the existing `projects` store state) that opens `ProjectSpendView`.
- `web/src/features/spend/ProjectSpendView.tsx` (new): fetches `projectUsage(id)` on mount; shows the project's total and its last-5-sessions list (name, relative date via the existing `ago()`-style formatter already used in `Sidebar.tsx`, cost). "Validar gastos" button: composes a prompt from the fetched data (project name, total, the 5 sessions' names+costs), calls `api.newSession(projectId, { name: 'Validação de gastos', model: 'haiku', routing: true })`, then the store's existing `open(projectId, sessionId)`, then `send(prompt)` — all three already-existing calls, no new store action needed.

## Error handling

| Case | Behavior |
|---|---|
| A session's jsonl unreadable/vanished mid-aggregation | That session contributes 0 to the total (skip, don't fail the whole `/usage/today` response) |
| A project with zero sessions | Simply contributes nothing to `byProject`; drill-down shows "nenhuma sessão" the same way `Sidebar.tsx` already does for an empty project |
| No spend at all today | Overview shows $0 and "—" for most-used model/project instead of crashing on an empty `byModel`/`byProject` max-lookup |
| "Validar gastos" clicked with a stale/removed project | `api.newSession` fails the same way any other project-not-found call already does elsewhere; surfaced as the existing generic error path (no new error UI) |

## Testing

No automated test suite (`docs/testing.md`). Validation: `npm run typecheck && npm run build` per task, plus manual checks — open the dashboard and confirm today's total roughly matches what you'd expect from today's actual usage, drill into a project and confirm the last-5-sessions costs match what each session's own header already shows, click "Validar gastos" and confirm a new session opens with the analysis prompt and (if the task is simple) responds on Haiku, escalating only if it judges it necessary.

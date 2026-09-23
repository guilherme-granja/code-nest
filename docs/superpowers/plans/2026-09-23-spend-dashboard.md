# Spend Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Gastos" sidebar button opens a dashboard: today's total spend + most-used model/project (new aggregation), a per-project drill-down with its all-time total and last 5 sessions (reusing existing per-session totals), and a "Validar gastos" button that opens a fresh Haiku session (self-escalating via the existing Model Routing tool) with an analysis prompt.

**Architecture:** Two new pure jsonl-parsing functions (`costCheckpoints`, `todayDelta`) turn a session's cost-state history into a same-day delta, mirroring the clamped-subtraction `hub.ts`'s `diffModelUsage` already does for live turns — just applied to a file instead of a live event stream. A new `Transport.costCheckpoints` method (local + SSH) feeds them. Two new routes aggregate: `/usage/today` across every project/session, `/projects/:id/usage` reusing the *existing* `Transport.usage()` (no new I/O there). `SessionMeta` gains an optional `routing` field — filling the one gap in a hierarchy (`model`/`effort` are already session-overridable, `routing` wasn't) — so "Validar gastos" can force routing on for just the one analysis session it creates, with zero new escalation code.

**Tech Stack:** TypeScript strict, Node.js/Hono backend, React 19 frontend, no test framework.

**Spec:** `docs/superpowers/specs/2026-09-23-spend-dashboard-design.md`

## Global Constraints

- "Today" aggregation reads a fixed 8 MB tail per session file (spec Ruling 1) — not the whole file, not unbounded. Never make this read the entire multi-week history of a session.
- Both "most-used model" and "most-used project" in the Overview are **today-scoped**, derived from the same `/usage/today` response — never all-time (spec Ruling 2).
- "Validar gastos" analyzes the **project's** recent pattern (its total + last-5-sessions, already on screen), not one arbitrary session (spec Ruling 3).
- The escalation path for the analysis session is the *existing* `request_model_upgrade` MCP tool, activated by opening that one session with `routing: true` — do not build a second escalation mechanism.
- No caching layer for the aggregation in this plan (YAGNI) — if it's slow in practice with many projects, that's a follow-up, not blocking this ship.
- No automated test suite — verification is `npm run typecheck && npm run build` plus manual checks per task.

## Review Focus

- **A session with zero cost-state lines yet** (brand new, no turn completed): `costCheckpoints` must return an empty array, not throw or produce a bogus checkpoint — `todayDelta` on an empty array must yield zero, not crash on an undefined "latest".
- **A session whose entire activity is from a previous day** (nothing today): `todayDelta` must yield exactly 0 for that session, not the whole lifetime total (the classic "forgot to subtract the baseline" bug).
- **`byModel`/`byProject` completely empty** (zero spend anywhere today): the Overview's "pick the max key" logic must show a placeholder ("—"), not throw on `Math.max()`/`.reduce()` over an empty structure.
- **A project with zero sessions** in the drill-down: must render "nenhuma sessão" (matching `Sidebar.tsx`'s existing empty-list wording), not an empty flash or a crash on `.slice(0, 5)` of an empty array (which is actually fine — but the *total* must show $0, not `NaN` from summing nothing).
- **`SessionMeta.routing` on an *existing* session created before this field existed**: must read as `undefined` and fall through the `meta.routing ?? project.routing ?? false` hierarchy exactly like a missing `model`/`effort` already does — no migration needed, but confirm the hierarchy line actually short-circuits correctly (`undefined ?? x` reads as `x`, not `false`).

---

## File Map

| File | Change |
|---|---|
| `shared/src/index.ts` | `SessionMeta.routing`, `createSessionBody.routing`, new `TodayUsage`/`ProjectUsageView` types |
| `server/src/domain.ts` | `openSpecFor`'s routing hierarchy |
| `server/src/routes.ts` | session-creation passes `routing`; two new routes |
| `server/src/runtime/jsonl.ts` | `costCheckpoints`, `todayDelta` |
| `server/src/runtime/types.ts` | `Transport.costCheckpoints` |
| `server/src/runtime/local-transport.ts` | implement it |
| `server/src/runtime/ssh-transport.ts` | implement it |
| `web/src/api.ts` | `usageToday()`, `projectUsage()` |
| `web/src/store.ts` | `Ui.spend` |
| `web/src/features/projects/Sidebar.tsx` | "Gastos" button |
| `web/src/app/App.tsx` | conditional render of the dashboard |
| `web/src/features/spend/SpendDashboard.tsx` | new |
| `web/src/features/spend/ProjectSpendView.tsx` | new |

---

### Task 1: `SessionMeta.routing` hierarchy

**Files:**
- Modify: `shared/src/index.ts`
- Modify: `server/src/domain.ts`
- Modify: `server/src/routes.ts` (the `POST /projects/:id/sessions` handler)

**Interfaces:**
- Produces: `SessionMeta.routing?: boolean`; `createSessionBody` accepts an optional `routing: boolean`. Task 8 (frontend "Validar gastos") consumes this by passing `routing: true` to `api.newSession`.

- [ ] **Step 1: Add the field to `SessionMeta` and `createSessionBody`**

In `shared/src/index.ts`, change:
```ts
export interface SessionMeta {
  sessionId: string; projectId: string; name?: string; model?: Model; effort?: Effort;
  tags?: string[]; favorite?: boolean; archived?: boolean; createdAt: number; lastUsedAt: number;
}
```
to:
```ts
export interface SessionMeta {
  sessionId: string; projectId: string; name?: string; model?: Model; effort?: Effort; routing?: boolean;
  tags?: string[]; favorite?: boolean; archived?: boolean; createdAt: number; lastUsedAt: number;
}
```
and change:
```ts
export const createSessionBody = z.object({ name: name(120), model: modelSchema.optional(), effort: effortSchema.optional() });
```
to:
```ts
export const createSessionBody = z.object({ name: name(120), model: modelSchema.optional(), effort: effortSchema.optional(), routing: z.boolean().optional() });
```

- [ ] **Step 2: Extend the hierarchy in `domain.ts`**

In `openSpecFor`, change:
```ts
    routing: project.routing ?? false,
```
to:
```ts
    routing: meta.routing ?? project.routing ?? false,
```

- [ ] **Step 3: Pass it through session creation**

In `routes.ts`'s `POST /projects/:id/sessions` handler, change:
```ts
    const meta: SessionMeta = { sessionId: randomUUID(), projectId: p.id, name: b.name, model: b.model, effort: b.effort, createdAt: now, lastUsedAt: now };
```
to:
```ts
    const meta: SessionMeta = { sessionId: randomUUID(), projectId: p.id, name: b.name, model: b.model, effort: b.effort, routing: b.routing, createdAt: now, lastUsedAt: now };
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add shared/src/index.ts server/src/domain.ts server/src/routes.ts
git commit -m "feat: add session-level routing override"
```

---

### Task 2: Checkpoint parsing (`jsonl.ts`)

**Files:**
- Modify: `server/src/runtime/jsonl.ts`

**Interfaces:**
- Produces: `CostCheckpoint { ts: number; totals: UsageTotals; modelUsage: Record<string, ModelUsage> }`; `costCheckpoints(jsonlTail: string): CostCheckpoint[]`; `todayDelta(checkpoints: CostCheckpoint[], todayStartMs: number): { totals: UsageTotals; modelUsage: Record<string, ModelUsage> }`. Task 3's `Transport.costCheckpoints` consumes `costCheckpoints`; Task 4's route consumes `todayDelta`.

- [ ] **Step 1: Add `costCheckpoints`**

Add to `jsonl.ts`, after `lastCostState`:
```ts
export interface CostCheckpoint { ts: number; totals: UsageTotals; modelUsage: Record<string, ModelUsage> }

// cada cost-state associado ao timestamp da última mensagem (user/assistant) vista antes dele no arquivo
export function costCheckpoints(jsonlTail: string): CostCheckpoint[] {
  const out: CostCheckpoint[] = [];
  let lastTs = 0;
  for (const line of jsonlTail.split('\n')) {
    if (!line) continue;
    let e: { type?: string; timestamp?: string; totalCostUSD?: number; modelUsage?: Parameters<typeof sumUsage>[0] };
    try { e = JSON.parse(line); } catch { continue; } // linha cortada pela leitura em janela
    if ((e.type === 'user' || e.type === 'assistant') && e.timestamp) {
      const t = Date.parse(e.timestamp);
      if (Number.isFinite(t)) lastTs = t;
    } else if (e.type === 'cost-state') {
      out.push({ ts: lastTs, totals: sumUsage(e.modelUsage, e.totalCostUSD ?? 0), modelUsage: rawModelUsage(e.modelUsage) });
    }
  }
  return out;
}
```

- [ ] **Step 2: Add `todayDelta`**

```ts
// delta entre o checkpoint mais recente e o último anterior a todayStartMs; clamp >=0 (mesmo padrão de hub.ts diffModelUsage)
export function todayDelta(checkpoints: CostCheckpoint[], todayStartMs: number): { totals: UsageTotals; modelUsage: Record<string, ModelUsage> } {
  const zero = { totals: ZERO_TOTALS_LIKE, modelUsage: {} as Record<string, ModelUsage> };
  if (checkpoints.length === 0) return zero;
  const latest = checkpoints[checkpoints.length - 1];
  const baseline = [...checkpoints].reverse().find((c) => c.ts < todayStartMs);
  if (!baseline) return { totals: latest.totals, modelUsage: latest.modelUsage }; // sessão inteira é de hoje: tudo conta
  const totals: UsageTotals = {
    costUsd: Math.max(0, latest.totals.costUsd - baseline.totals.costUsd),
    input: Math.max(0, latest.totals.input - baseline.totals.input),
    output: Math.max(0, latest.totals.output - baseline.totals.output),
    cacheCreation: Math.max(0, latest.totals.cacheCreation - baseline.totals.cacheCreation),
    cacheRead: Math.max(0, latest.totals.cacheRead - baseline.totals.cacheRead),
  };
  const modelUsage: Record<string, ModelUsage> = {};
  for (const [model, cur] of Object.entries(latest.modelUsage)) {
    const prev = baseline.modelUsage[model];
    modelUsage[model] = {
      input: Math.max(0, cur.input - (prev?.input ?? 0)),
      output: Math.max(0, cur.output - (prev?.output ?? 0)),
      cacheCreation: Math.max(0, cur.cacheCreation - (prev?.cacheCreation ?? 0)),
      cacheRead: Math.max(0, cur.cacheRead - (prev?.cacheRead ?? 0)),
      costUsd: Math.max(0, cur.costUsd - (prev?.costUsd ?? 0)),
    };
  }
  return { totals, modelUsage };
}
```

This needs `ZERO_TOTALS` imported from `@ccui/shared` (it already exists there — `export const ZERO_TOTALS: UsageTotals = { costUsd: 0, input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };`). Change the top import line in `jsonl.ts` from:
```ts
import type { HistoryItem, ModelUsage, UsageTotals } from '@ccui/shared';
```
to:
```ts
import { ZERO_TOTALS, type HistoryItem, type ModelUsage, type UsageTotals } from '@ccui/shared';
```
and replace `ZERO_TOTALS_LIKE` in the snippet above with `ZERO_TOTALS`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: succeeds.

- [ ] **Step 4: Manual check (Review Focus: empty/no-today cases)**

```bash
node --experimental-strip-types -e "
const { costCheckpoints, todayDelta } = require('./server/src/runtime/jsonl.ts');
console.log(todayDelta(costCheckpoints(''), Date.now())); // expect all-zero, no throw
"
```
If that exact invocation doesn't run directly (ESM/TS loader specifics), it's fine to instead eyeball-trace: `costCheckpoints('')` → the loop body never executes → `[]`; `todayDelta([], anything)` → `checkpoints.length === 0` → returns the zero shape. Confirms Review Focus item 1 and 3's "empty" half without needing a live session.

- [ ] **Step 5: Commit**

```bash
git add server/src/runtime/jsonl.ts
git commit -m "feat: add cost-checkpoint parsing and today's-delta calculation"
```

---

### Task 3: `Transport.costCheckpoints` (local + SSH)

**Files:**
- Modify: `server/src/runtime/types.ts`
- Modify: `server/src/runtime/local-transport.ts`
- Modify: `server/src/runtime/ssh-transport.ts`

**Interfaces:**
- Consumes: `costCheckpoints` from Task 2.
- Produces: `Transport.costCheckpoints(sessionId: string, cwd: string): Promise<CostCheckpoint[] | null>` — `null` if the session doesn't exist / can't be read (same convention as every other `Transport` method). Task 4 consumes this by exact name.

- [ ] **Step 1: Add to the `Transport` interface**

In `types.ts`, right after the `usage` method, add (and add `CostCheckpoint` to the existing `@ccui/shared`-sourced type import — actually it's defined in `jsonl.ts`, a sibling module, so import it from there instead):
```ts
  /** todos os checkpoints de custo num trecho generoso (8 MB) do fim do jsonl; null se a sessão não existe/sem leitura */
  costCheckpoints(sessionId: string, cwd: string): Promise<CostCheckpoint[] | null>;
```
Add the import at the top of `types.ts`:
```ts
import type { CostCheckpoint } from './jsonl';
```

- [ ] **Step 2: Implement in `local-transport.ts`**

Add right after the existing `usage` method, reusing the same tail-window-reading shape but with one fixed larger size (8 MB) since this needs more history than "just the latest line":
```ts
  async costCheckpoints(sessionId, cwd) {
    if (!SESSION_ID_RE.test(sessionId)) return null;
    const file = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'), 'projects', encodeCwd(cwd), `${sessionId}.jsonl`);
    let fh;
    try {
      fh = await fs.open(file, 'r');
      const { size } = await fh.stat();
      const len = Math.min(8 * 1024 * 1024, size);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      return costCheckpoints(buf.toString('utf8'));
    } catch { return null; } finally { await fh?.close(); }
  },
```
Add `costCheckpoints` (renamed on import to avoid colliding with the method name — the method and the imported function share a name, which is fine in JS/TS since one is a property key and the other a bare identifier, but for clarity import it explicitly) to the existing `jsonl.ts` import line:
```ts
import { costCheckpoints, firstPrompt, lastCostState, parseHistory } from './jsonl';
```
(`SESSION_ID_RE`, `encodeCwd`, `homedir`, `path`, `fs` are already imported in this file for the existing `usage` method — no other new imports needed.)

- [ ] **Step 3: Implement in `ssh-transport.ts`**

Add right after the existing `usage` method:
```ts
    async costCheckpoints(id, cwd) {
      if (!SESSION_ID_RE.test(id)) return null;
      const r = await sh(`tail -c 8388608 ${dir(cwd)}/${id}.jsonl 2>/dev/null`, 30_000);
      return r.code === 0 ? costCheckpoints(r.stdout) : null;
    },
```
Add `costCheckpoints` to the existing `jsonl.ts` import line:
```ts
import { costCheckpoints, firstPrompt, lastCostState, parseHistory } from './jsonl';
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Manual check**

```bash
node -e "
const { execSync } = require('child_process');
console.log('sanity: build succeeded, method exists on both transports (verified by typecheck already)');
"
```
Real verification for this task is the type system (both transports must structurally implement the widened `Transport` interface or `tsc` fails) — no separate runtime check needed until Task 4 actually calls it end-to-end.

- [ ] **Step 6: Commit**

```bash
git add server/src/runtime/types.ts server/src/runtime/local-transport.ts server/src/runtime/ssh-transport.ts
git commit -m "feat: add Transport.costCheckpoints for local and SSH filesystems"
```

---

### Task 4: `GET /api/usage/today`

**Files:**
- Modify: `server/src/routes.ts`

**Interfaces:**
- Consumes: `Transport.costCheckpoints` (Task 3), `todayDelta` (Task 2).
- Produces: route `GET /api/usage/today` → `{ totalCostUsd: number; byModel: Record<string, number>; byProject: Record<string, number> }`. Task 6's frontend client consumes this shape by exact field names.

- [ ] **Step 1: Add the route**

In `routes.ts`, add near the other cross-cutting routes (e.g. right after `api.get('/state', ...)`), importing `todayDelta` from `./runtime/jsonl` at the top of the file:
```ts
import { todayDelta } from './runtime/jsonl';
```
```ts
  api.get('/usage/today', async (c) => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    let totalCostUsd = 0;
    const byModel: Record<string, number> = {};
    const byProject: Record<string, number> = {};
    for (const p of projects()) {
      const rt = conns.get(p.connectionId);
      const sessions = await rt.runtime.listSessions(p.path).catch(() => []);
      for (const s of sessions) {
        const checkpoints = await rt.transport.costCheckpoints(s.sessionId, p.path).catch(() => null);
        if (!checkpoints) continue;
        const delta = todayDelta(checkpoints, todayStart.getTime());
        if (delta.totals.costUsd <= 0) continue;
        totalCostUsd += delta.totals.costUsd;
        byProject[p.id] = (byProject[p.id] ?? 0) + delta.totals.costUsd;
        for (const [model, u] of Object.entries(delta.modelUsage)) byModel[model] = (byModel[model] ?? 0) + u.costUsd;
      }
    }
    return c.json({ totalCostUsd, byModel, byProject });
  });
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 3: Manual check**

Restart the backend, then:
```bash
TOKEN=$(grep -o 'token=[^ ]*' /tmp/ccui.log | tail -1 | cut -d= -f2)
curl -s "http://127.0.0.1:4317/api/usage/today" -H "Authorization: Bearer $TOKEN"
```
Expected: a JSON object with `totalCostUsd`, `byModel`, `byProject` — confirms the aggregation runs end-to-end across whatever real projects/sessions exist without erroring (Review Focus items 1-3, exercised against real data this time, not just the empty-input trace from Task 2).

- [ ] **Step 4: Commit**

```bash
git add server/src/routes.ts
git commit -m "feat: add GET /usage/today aggregation route"
```

---

### Task 5: `GET /api/projects/:id/usage`

**Files:**
- Modify: `server/src/routes.ts`

**Interfaces:**
- Consumes: the existing `Transport.usage()` (no change) and `listProjectSessions`/`runtime.listSessions` (already used elsewhere in this file).
- Produces: route `GET /api/projects/:id/usage` → `{ totalCostUsd: number; sessions: Array<{ sessionId: string; name: string; lastModified: number; costUsd: number }> }`. Task 6 consumes this shape.

- [ ] **Step 1: Add the route**

Right after the existing `api.get('/projects/:id/sessions', ...)` route:
```ts
  api.get('/projects/:id/usage', async (c) => {
    const p = project(c.req.param('id'));
    if (!p) return c.json({ error: 'projeto desconhecido' }, 404);
    const rt = conns.get(p.connectionId);
    const disk = await rt.runtime.listSessions(p.path).catch(() => []);
    const metas = new Map(store.sessions.data.sessions.filter((s) => s.projectId === p.id).map((m) => [m.sessionId, m]));
    let totalCostUsd = 0;
    const rows = await Promise.all(disk.map(async (d) => {
      const u = await rt.transport.usage(d.sessionId, p.path).catch(() => null);
      const costUsd = u?.totals.costUsd ?? 0;
      totalCostUsd += costUsd;
      const meta = metas.get(d.sessionId);
      return { sessionId: d.sessionId, name: meta?.name ?? d.customTitle ?? d.summary ?? '(sem título)', lastModified: d.lastModified, costUsd };
    }));
    rows.sort((a, b) => b.lastModified - a.lastModified);
    return c.json({ totalCostUsd, sessions: rows.slice(0, 5) });
  });
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 3: Manual check**

```bash
TOKEN=$(grep -o 'token=[^ ]*' /tmp/ccui.log | tail -1 | cut -d= -f2)
curl -s "http://127.0.0.1:4317/api/projects/local/usage" -H "Authorization: Bearer $TOKEN" 2>&1 | head -c 500
```
(Use a real project id from `GET /api/state` if `local` isn't one — the point is confirming the shape and that a project with sessions returns a non-empty `sessions` array with real `costUsd` numbers matching what those sessions' own headers already show in the chat UI.)

- [ ] **Step 4: Commit**

```bash
git add server/src/routes.ts
git commit -m "feat: add GET /projects/:id/usage route"
```

---

### Task 6: Frontend types + API client

**Files:**
- Modify: `shared/src/index.ts`
- Modify: `web/src/api.ts`

**Interfaces:**
- Produces: `TodayUsage { totalCostUsd: number; byModel: Record<string, number>; byProject: Record<string, number> }`; `ProjectUsageView { totalCostUsd: number; sessions: Array<{ sessionId: string; name: string; lastModified: number; costUsd: number }> }`; `api.usageToday(): Promise<TodayUsage>`; `api.projectUsage(id: string): Promise<ProjectUsageView>`. Task 8 consumes both by exact name.

- [ ] **Step 1: Add the shared types**

In `shared/src/index.ts`, near `GitInfo`/`DirEntry`:
```ts
export interface TodayUsage { totalCostUsd: number; byModel: Record<string, number>; byProject: Record<string, number> }
export interface ProjectUsageView { totalCostUsd: number; sessions: Array<{ sessionId: string; name: string; lastModified: number; costUsd: number }> }
```

- [ ] **Step 2: Add the API client methods**

In `web/src/api.ts`, add `ProjectUsageView`/`TodayUsage` to the existing type import line, then add near the other methods:
```ts
  usageToday: () => req<TodayUsage>('GET', '/api/usage/today'),
  projectUsage: (id: string) => req<ProjectUsageView>('GET', `/api/projects/${id}/usage`),
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add shared/src/index.ts web/src/api.ts
git commit -m "feat: add usage-today and project-usage API client methods"
```

---

### Task 7: Sidebar button, store flag, and App.tsx wiring

**Files:**
- Modify: `web/src/store.ts`
- Modify: `web/src/features/projects/Sidebar.tsx`
- Modify: `web/src/app/App.tsx`

**Interfaces:**
- Produces: `Ui.spend: boolean`. Task 8's `SpendDashboard` is mounted by `App.tsx` reading this flag — no other new store action needed (`setUi({ spend: true/false })` is enough, same pattern as `appSettings`).

- [ ] **Step 1: Add the flag**

In `store.ts`, change:
```ts
export interface Ui { palette: boolean; help: boolean; newSession: boolean; newFor: string | null; term: boolean; settingsFor: string | null; appSettings: boolean }
```
to:
```ts
export interface Ui { palette: boolean; help: boolean; newSession: boolean; newFor: string | null; term: boolean; settingsFor: string | null; appSettings: boolean; spend: boolean }
```
and change the initial state:
```ts
    attention: {}, notifyOn: notifyEnabled(), ui: { palette: false, help: false, newSession: false, newFor: null, term: false, settingsFor: null, appSettings: false },
```
to:
```ts
    attention: {}, notifyOn: notifyEnabled(), ui: { palette: false, help: false, newSession: false, newFor: null, term: false, settingsFor: null, appSettings: false, spend: false },
```

- [ ] **Step 2: Add the Sidebar button**

In `Sidebar.tsx`, right next to the existing "Configurações" button (same footer), add a sibling button. Change:
```tsx
      <button className="m-3 flex items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900" onClick={() => setUi({ appSettings: true })}>
        <IconSettings className="h-3.5 w-3.5" /> Configurações
      </button>
```
to:
```tsx
      <div className="m-3 flex gap-1.5">
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900" onClick={() => setUi({ spend: true })}>
          Gastos
        </button>
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900" onClick={() => setUi({ appSettings: true })}>
          <IconSettings className="h-3.5 w-3.5" /> Configurações
        </button>
      </div>
```

- [ ] **Step 3: Wire `App.tsx`**

Add the import:
```ts
import { SpendDashboard } from '../features/spend/SpendDashboard';
```
Change:
```tsx
      <div className="flex min-w-0 flex-1 flex-col">
        <Tabs />
        <Chat />
      </div>
```
to:
```tsx
      <div className="flex min-w-0 flex-1 flex-col">
        {ui.spend ? <SpendDashboard onClose={() => setUi({ spend: false })} /> : (<><Tabs /><Chat /></>)}
      </div>
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: fails right now with "Cannot find module '../features/spend/SpendDashboard'" — that's correct, Task 8 creates it. Do not consider this task done until Task 8 also lands; commit Task 7's changes together with Task 8 in one commit instead of separately (the plan's own File Map already groups them this way — this is the one task in this plan where splitting the commit would leave the tree in a non-typechecking state, which none of the earlier plans in this project ever did).

- [ ] **Step 5: No separate commit** — proceed directly to Task 8, then commit both together.

---

### Task 8: `SpendDashboard` and `ProjectSpendView`

**Files:**
- Create: `web/src/features/spend/SpendDashboard.tsx`
- Create: `web/src/features/spend/ProjectSpendView.tsx`

**Interfaces:**
- Consumes: `api.usageToday()`/`api.projectUsage()` (Task 6), `Ui.spend` (Task 7), the existing store actions `open()`/`send()` and `api.newSession()`.

- [ ] **Step 1: Create `SpendDashboard.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { TodayUsage } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';
import { ProjectSpendView } from './ProjectSpendView';

const maxKey = (m: Record<string, number>): string | null => {
  const entries = Object.entries(m);
  if (entries.length === 0) return null;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
};

export function SpendDashboard({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects);
  const [data, setData] = useState<TodayUsage | null>(null);
  const [err, setErr] = useState('');
  const [openProject, setOpenProject] = useState<string | null>(null);

  useEffect(() => { api.usageToday().then(setData).catch((e) => setErr((e as Error).message)); }, []);

  if (openProject) return <ProjectSpendView projectId={openProject} onBack={() => setOpenProject(null)} onClose={onClose} />;

  const topModel = data ? maxKey(data.byModel) : null;
  const topProjectId = data ? maxKey(data.byProject) : null;
  const topProjectName = topProjectId ? (projects.find((p) => p.id === topProjectId)?.name ?? topProjectId) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Gastos de hoje</h1>
        <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onClose}>Fechar</button>
      </div>
      {err && <div className="text-sm text-rose-400">{err}</div>}
      {data && (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs text-zinc-500">Total hoje</div>
              <div className="mt-1 text-xl font-semibold text-zinc-100">${data.totalCostUsd.toFixed(4)}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs text-zinc-500">Modelo mais usado</div>
              <div className="mt-1 text-xl font-semibold text-zinc-100">{topModel ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs text-zinc-500">Projeto mais usado</div>
              <div className="mt-1 text-xl font-semibold text-zinc-100">{topProjectName ?? '—'}</div>
            </div>
          </div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Por projeto</div>
          <ul className="space-y-1">
            {Object.entries(data.byProject).sort((a, b) => b[1] - a[1]).map(([pid, cost]) => (
              <li key={pid}>
                <button className="flex w-full items-center justify-between rounded-md border border-zinc-800/60 bg-zinc-900/30 px-3 py-2 text-left text-sm text-zinc-200 hover:border-zinc-700" onClick={() => setOpenProject(pid)}>
                  <span>{projects.find((p) => p.id === pid)?.name ?? pid}</span>
                  <span className="font-mono text-xs text-zinc-400">${cost.toFixed(4)}</span>
                </button>
              </li>
            ))}
            {Object.keys(data.byProject).length === 0 && <li className="text-sm text-zinc-600">Nenhum gasto hoje.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `ProjectSpendView.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { ProjectUsageView } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';

const ago = (t: number) => {
  const s = (t - Date.now()) / 1000, a = Math.abs(s);
  const f = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  return a < 3600 ? f.format(Math.round(s / 60), 'minute') : a < 86400 ? f.format(Math.round(s / 3600), 'hour') : f.format(Math.round(s / 86400), 'day');
};

export function ProjectSpendView({ projectId, onBack, onClose }: { projectId: string; onBack: () => void; onClose: () => void }) {
  const project = useApp((s) => s.projects.find((p) => p.id === projectId));
  const { open, send } = useApp();
  const [data, setData] = useState<ProjectUsageView | null>(null);
  const [err, setErr] = useState('');
  const [validating, setValidating] = useState(false);

  useEffect(() => { api.projectUsage(projectId).then(setData).catch((e) => setErr((e as Error).message)); }, [projectId]);

  const validateSpend = async () => {
    if (!data) return;
    setValidating(true);
    try {
      const summary = data.sessions.map((s) => `- ${s.name}: $${s.costUsd.toFixed(4)} (${new Date(s.lastModified).toLocaleDateString('pt-BR')})`).join('\n');
      const prompt = `Analise o padrão de gastos do projeto "${project?.name ?? projectId}".\n\nGasto total acumulado: $${data.totalCostUsd.toFixed(4)}\n\nÚltimas ${data.sessions.length} sessões:\n${summary}\n\nO que pode ser melhorado ou otimizado nesse uso do Claude Code, considerando os recursos já disponíveis neste app (Model Routing, modo lean)?`;
      const s = await api.newSession(projectId, { name: 'Validação de gastos', model: 'haiku', routing: true });
      open(projectId, s.sessionId);
      send(prompt);
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setValidating(false); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onBack}>← Gastos</button>
          <h1 className="text-lg font-semibold text-zinc-100">{project?.name ?? projectId}</h1>
        </div>
        <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onClose}>Fechar</button>
      </div>
      {err && <div className="mb-3 text-sm text-rose-400">{err}</div>}
      {data && (
        <>
          <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="text-xs text-zinc-500">Total acumulado</div>
            <div className="mt-1 text-xl font-semibold text-zinc-100">${data.totalCostUsd.toFixed(4)}</div>
          </div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Últimas sessões</span>
            <button className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-900 disabled:opacity-40" disabled={validating || data.sessions.length === 0} onClick={validateSpend}>
              {validating ? 'Abrindo…' : 'Validar gastos'}
            </button>
          </div>
          <ul className="space-y-1">
            {data.sessions.map((s) => (
              <li key={s.sessionId} className="flex items-center justify-between rounded-md border border-zinc-800/60 bg-zinc-900/30 px-3 py-2 text-sm text-zinc-200">
                <span className="truncate">{s.name}</span>
                <span className="flex shrink-0 items-center gap-2 font-mono text-xs text-zinc-400"><span>{ago(s.lastModified)}</span><span>${s.costUsd.toFixed(4)}</span></span>
              </li>
            ))}
            {data.sessions.length === 0 && <li className="text-sm text-zinc-600">nenhuma sessão</li>}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify (this also satisfies Task 7's Step 4 gate)**

Run: `npm run typecheck && npm run build`
Expected: both succeed — including `App.tsx`'s import from Task 7, which only resolves once this file exists.

- [ ] **Step 4: Manual check**

Restart the backend, open the app, click "Gastos" in the sidebar: confirm the overview loads without error (Review Focus: empty `byModel`/`byProject` shows "—", not a crash, if there's genuinely no spend today). Click into a project: confirm its total and last-5-sessions list render, matching the numbers from Task 5's curl check. Click "Validar gastos": confirm a new session opens in that project and the composed prompt is visible as the first message once sent.

- [ ] **Step 5: Commit (Task 7 + Task 8 together)**

```bash
git add web/src/store.ts web/src/features/projects/Sidebar.tsx web/src/app/App.tsx web/src/features/spend/SpendDashboard.tsx web/src/features/spend/ProjectSpendView.tsx
git commit -m "feat: add spend dashboard UI (overview, per-project drill-down, validate-spend action)"
```

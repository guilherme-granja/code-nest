# Filesystem Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Procurar" button next to the path input in Sidebar's "+ Novo projeto" form that opens a folder browser (local or SSH filesystem) and fills the path field with the chosen absolute directory.

**Architecture:** A new `Transport.listDir(path)` method (implemented for both local and SSH transports, same "null on any failure" convention `usage()`/`git()` already use) backs a new `GET /api/connections/:id/browse` route. The frontend gets a thin `api.browse()` client and a new `FolderBrowserModal` component that calls it on navigation; `Sidebar.tsx` wires a button to open it and writes the result into the existing form state. No new permission model, no new process-spawning pattern — everything reuses helpers already in the codebase.

**Tech Stack:** TypeScript strict, Node.js/Hono backend, React 19 frontend, no test framework (project has none by explicit decision).

**Spec:** `docs/superpowers/specs/2026-09-22-filesystem-browser-design.md`

## Global Constraints

- The existing free-text `path` input in "+ Novo projeto" stays editable — the browser is an added convenience, never a replacement (explicit user decision during brainstorming).
- `listDir` returns `null` on any failure (not found, not a directory, permission denied, SSH unreachable) — matches the existing convention in `Transport.usage()` and `Transport.git()`; never throw from a transport implementation.
- The `GET /browse` route's `kind` query param defaults to `dir` (folders only, what this plan's UI needs) and also accepts `all` (files+folders) — `all` is unused by any UI built in this plan; it exists so the future file-attachment sub-project can reuse this exact route unchanged. Do not build any file-picking UI in this plan.
- No new authorization/ACL model: browsing a connection's filesystem is the same trust boundary the app already grants that connection (it can already run Bash/edit files there via Claude Code sessions).
- No automated test suite exists in this project (see `docs/testing.md`) — every task's verification is `npm run typecheck && npm run build`, plus a manual-check step. Do not add a test framework.

## Review Focus

- **Browsing from the filesystem root (`/`):** the `..`/up action must not be offered (or must no-op) at `/` — an unguarded "go up from root" is the first thing a curious user tries.
- **An empty directory:** must render "pasta vazia", not an indistinguishable blank/loading-forever list.
- **SSH connection unreachable while browsing:** `listDir` → `null` → route returns 404 → modal shows the error inline without closing or crashing the form behind it.
- **Directory names with spaces or non-ASCII characters:** must survive SSH's `ls -1p` parsing and the frontend's URL query encoding without breaking navigation into that folder.
- **Reopening the browser after changing the connection dropdown:** must browse the *currently selected* connection, not a stale one — handled by construction (Task 4 renders `FolderBrowserModal` conditionally, so it unmounts on close and remounts fresh with the current `form.connectionId` every time it's reopened; Task 4's manual check confirms this explicitly).

---

## File Map

| File | Change |
|---|---|
| `shared/src/index.ts` | add `DirEntry` type |
| `server/src/runtime/types.ts` | add `Transport.listDir` |
| `server/src/runtime/local-transport.ts` | implement `listDir` |
| `server/src/runtime/ssh-transport.ts` | implement `listDir` |
| `server/src/routes.ts` | add `GET /connections/:id/browse` |
| `web/src/api.ts` | add `browse()` client |
| `web/src/features/projects/FolderBrowserModal.tsx` | new component |
| `web/src/features/projects/Sidebar.tsx` | "Procurar" button + modal wiring |

---

### Task 1: `Transport.listDir` (local + SSH)

**Files:**
- Modify: `server/src/runtime/types.ts:7-21` (the `Transport` interface)
- Modify: `server/src/runtime/local-transport.ts:21-23` (right after `isDirectory`)
- Modify: `server/src/runtime/ssh-transport.ts:26-28` (right after `isDirectory`)

**Interfaces:**
- Produces: `Transport.listDir(path: string | null): Promise<{ path: string; entries: { name: string; isDir: boolean }[] } | null>` — `path === null` means "resolve and list the connection's home directory"; the returned `path` is always the resolved absolute path. `null` return means the path doesn't exist, isn't a directory, or listing failed for any reason (permission, SSH down, etc).

- [ ] **Step 1: Add the method to the `Transport` interface**

In `server/src/runtime/types.ts`, right after the `isDirectory` line:

```ts
  isDirectory(path: string): Promise<boolean>;
  /** lista o conteúdo de um diretório; path null = resolve e lista o $HOME da conexão. null de volta = não existe/sem permissão/falha */
  listDir(path: string | null): Promise<{ path: string; entries: { name: string; isDir: boolean }[] } | null>;
```

- [ ] **Step 2: Implement it in `local-transport.ts`**

Right after the existing `isDirectory` method:

```ts
  async isDirectory(p) {
    try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
  },

  async listDir(p) {
    const dir = p ?? homedir();
    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      return { path: dir, entries: items.map((d) => ({ name: d.name, isDir: d.isDirectory() })) };
    } catch { return null; }
  },
```

(`homedir` is already imported at the top of this file from `node:os`; no new import needed.)

- [ ] **Step 3: Implement it in `ssh-transport.ts`**

Right after the existing `isDirectory` method inside the returned object:

```ts
    async isDirectory(p) {
      return (await sh(`test -d ${shq(p)}`)).code === 0;
    },

    async listDir(p) {
      const cmd = p ? `cd ${shq(p)} 2>/dev/null && pwd && ls -1p .` : `cd "$HOME" && pwd && ls -1p .`;
      const r = await sh(cmd);
      if (r.code !== 0) return null;
      const lines = r.stdout.split('\n');
      const resolved = lines[0];
      if (!resolved) return null;
      const entries = lines.slice(1).filter(Boolean).map((l) => (l.endsWith('/') ? { name: l.slice(0, -1), isDir: true } : { name: l, isDir: false }));
      return { path: resolved, entries };
    },
```

(`sh` and `shq` are already defined/imported at the top of this file; no new import needed. `ls -1p` appends `/` to directory names — that's how `isDir` is derived without a second round-trip.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: succeeds (both transports now satisfy the extended `Transport` interface).

- [ ] **Step 5: Commit**

```bash
git add server/src/runtime/types.ts server/src/runtime/local-transport.ts server/src/runtime/ssh-transport.ts
git commit -m "feat: add Transport.listDir for local and SSH filesystems"
```

---

### Task 2: `DirEntry` shared type + `GET /connections/:id/browse` route

**Files:**
- Modify: `shared/src/index.ts` (near `GitInfo`, around line 26)
- Modify: `server/src/runtime/types.ts:1-2` (import) and the `listDir` signature from Task 1
- Modify: `server/src/routes.ts` (new route, placed after the existing `DELETE /connections/:id` route)

**Interfaces:**
- Consumes: `Transport.listDir` from Task 1.
- Produces: `DirEntry { name: string; isDir: boolean }` (shared type, importable from `@ccui/shared`); route `GET /api/connections/:id/browse?path=<abs, optional>&kind=dir|all` → `200 { path: string; entries: DirEntry[] }` or `404 { error: string }`.

- [ ] **Step 1: Add the shared type**

In `shared/src/index.ts`, right after `export interface GitInfo { ... }`:

```ts
export interface DirEntry { name: string; isDir: boolean }
```

- [ ] **Step 2: Switch `Transport.listDir` to the named type**

In `server/src/runtime/types.ts`, change the import line:

```ts
import type { Effort, EventBody, HistoryItem, Model, ModelUsage, ShellResult, SlashCommandInfo, UsageTotals } from '@ccui/shared';
```
to:
```ts
import type { DirEntry, Effort, EventBody, HistoryItem, Model, ModelUsage, ShellResult, SlashCommandInfo, UsageTotals } from '@ccui/shared';
```

Then change the `listDir` line from Task 1 to use it:

```ts
  listDir(path: string | null): Promise<{ path: string; entries: DirEntry[] } | null>;
```

(No change needed in `local-transport.ts`/`ssh-transport.ts` — their return shape already matches `DirEntry`'s structure exactly, TypeScript infers it.)

- [ ] **Step 3: Add the route**

In `server/src/routes.ts`, right after the existing `api.delete('/connections/:id', ...)` block (before `api.post('/projects', ...)`):

```ts
  // navega o filesystem da conexão (pastas locais/SSH) pra escolher caminho de projeto sem digitar
  api.get('/connections/:id/browse', async (c) => {
    let conn: ReturnType<Connections['get']>;
    try { conn = conns.get(c.req.param('id')); } catch { return c.json({ error: 'conexão desconhecida' }, 404); }
    const raw = c.req.query('path');
    let p: string | null = null;
    if (raw !== undefined) {
      p = path.posix.normalize(raw);
      if (!p.startsWith('/') || /[\u0000-\u001f]/.test(p)) return bad(c, 'caminho inválido');
    }
    const r = await conn.transport.listDir(p);
    if (!r) return c.json({ error: 'não foi possível listar este caminho' }, 404);
    const kind = c.req.query('kind') === 'all' ? 'all' : 'dir';
    return c.json({ path: r.path, entries: kind === 'dir' ? r.entries.filter((e) => e.isDir) : r.entries });
  });
```

`path` (the Node module) and `bad`/`conns` are already available in this file's scope — no new imports.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Manual check**

Start the backend (`npm run dev:server` or `./restart.sh`) and hit the route directly to confirm the shape before wiring any UI to it:

```bash
curl -s "http://127.0.0.1:4317/api/connections/local/browse" -H "Authorization: Bearer $TOKEN" | head -c 500
```
Expected: JSON `{ "path": "/home/...", "entries": [...] }` listing your home directory's subfolders only (files filtered out by the `kind=dir` default). Then try a path with a space in its name (`?path=/tmp/some%20dir`) if one exists, or `mkdir -p "/tmp/space test"` first — confirm it lists correctly (Review Focus: names with spaces).

- [ ] **Step 6: Commit**

```bash
git add shared/src/index.ts server/src/runtime/types.ts server/src/routes.ts
git commit -m "feat: add DirEntry type and GET /connections/:id/browse route"
```

---

### Task 3: `api.browse()` client + `FolderBrowserModal`

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/features/projects/FolderBrowserModal.tsx`

**Interfaces:**
- Consumes: `GET /connections/:id/browse` from Task 2; `DirEntry` from `@ccui/shared`.
- Produces: `api.browse(connectionId: string, path: string | null, kind?: 'dir' | 'all'): Promise<{ path: string; entries: DirEntry[] }>`; component `FolderBrowserModal({ connectionId, onPick, onClose }: { connectionId: string; onPick: (path: string) => void; onClose: () => void })` — Task 4 consumes both by these exact names.

- [ ] **Step 1: Add the API client method**

In `web/src/api.ts`, add `DirEntry` to the existing type import:

```ts
import type { Config, ConnStatus, Connection, DirEntry, Effort, GitInfo, Model, Project, SessionRow, SlashCommandInfo } from '@ccui/shared';
```

Then add, next to the other `api` methods:

```ts
  browse: (connectionId: string, path: string | null, kind: 'dir' | 'all' = 'dir') =>
    req<{ path: string; entries: DirEntry[] }>('GET', `/api/connections/${connectionId}/browse?${path ? `path=${encodeURIComponent(path)}&` : ''}kind=${kind}`),
```

- [ ] **Step 2: Create `FolderBrowserModal.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { DirEntry } from '@ccui/shared';
import { api } from '../../api';

// Navega o filesystem da conexão (local ou SSH) pra escolher uma pasta sem digitar o caminho.
// path === null enquanto não carregou a 1ª vez (home da conexão); depois disso é sempre o caminho absoluto atual.
export function FolderBrowserModal({ connectionId, onPick, onClose }: { connectionId: string; onPick: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [jump, setJump] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = (p: string | null) => {
    setLoading(true);
    api.browse(connectionId, p, 'dir')
      .then((r) => { setPath(r.path); setEntries(r.entries); setErr(''); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(null); }, [connectionId]);

  const visible = entries.filter((e) => showHidden || !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
  const up = () => { if (path && path !== '/') load(path.slice(0, path.lastIndexOf('/')) || '/'); };
  const crumbs = (path ?? '/').split('/').filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-zinc-800/80 p-4">
          <h2 className="mb-2 text-sm font-semibold text-zinc-100">Escolher pasta</h2>
          <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-400">
            <button className="hover:text-zinc-200" onClick={() => load('/')}>/</button>
            {crumbs.map((seg, i) => {
              const target = '/' + crumbs.slice(0, i + 1).join('/');
              return (
                <span key={target} className="flex items-center gap-1">
                  <span className="text-zinc-700">/</span>
                  <button className="hover:text-zinc-200" onClick={() => load(target)}>{seg}</button>
                </span>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && <div className="p-3 text-xs text-zinc-600">Carregando…</div>}
          {err && <div className="p-3 text-xs text-rose-400">{err}</div>}
          {!loading && !err && (
            <ul className="space-y-0.5">
              {path !== '/' && (
                <li><button className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/60" onClick={up}>..</button></li>
              )}
              {visible.length === 0 && <li className="px-2.5 py-1.5 text-xs text-zinc-600">Pasta vazia</li>}
              {visible.map((e) => (
                <li key={e.name}>
                  <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800/60" onClick={() => load(`${path === '/' ? '' : path}/${e.name}`)}>
                    <span className="text-zinc-500">▸</span>{e.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t border-zinc-800/80 p-3">
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700"
              placeholder="ir para um caminho…"
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && jump.trim()) load(jump.trim()); }}
            />
            <button className="rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800" onClick={() => jump.trim() && load(jump.trim())}>Ir</button>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            <input type="checkbox" className="h-3.5 w-3.5 rounded-sm border border-zinc-700 bg-zinc-900 accent-zinc-100" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> mostrar ocultos
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200" onClick={onClose}>Cancelar</button>
            <button className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-40" disabled={!path} onClick={() => path && onPick(path)}>Selecionar esta pasta</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed. (The component isn't rendered from anywhere yet — this only proves it type-checks and bundles standalone; Task 4 wires it in and is where it's actually exercised.)

- [ ] **Step 4: Commit**

```bash
git add web/src/api.ts web/src/features/projects/FolderBrowserModal.tsx
git commit -m "feat: add browse API client and FolderBrowserModal component"
```

---

### Task 4: Wire "Procurar" into Sidebar's "+ Novo projeto"

**Files:**
- Modify: `web/src/features/projects/Sidebar.tsx`

**Interfaces:**
- Consumes: `FolderBrowserModal` from Task 3, exactly as `{ connectionId, onPick, onClose }`.

- [ ] **Step 1: Import the modal**

Add near the other local imports in `Sidebar.tsx`:

```ts
import { FolderBrowserModal } from './FolderBrowserModal';
```

- [ ] **Step 2: Add the `browsing` state**

Next to the other `useState` calls in `Sidebar()` (near `adding`/`form`):

```ts
  const [browsing, setBrowsing] = useState(false);
```

- [ ] **Step 3: Add the "Procurar" button next to the path input**

Change:
```tsx
            <input className="w-full rounded bg-zinc-900 px-2 py-1" placeholder="/caminho/absoluto (no servidor escolhido)" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
```
to:
```tsx
            <div className="flex gap-1">
              <input className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1" placeholder="/caminho/absoluto (no servidor escolhido)" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
              <button className="shrink-0 rounded border border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-800" onClick={() => setBrowsing(true)}>Procurar</button>
            </div>
```

- [ ] **Step 4: Render the modal**

Near the other conditionally-rendered modals at the bottom of the `<aside>` (next to `{ui.settingsFor && ...}`/`{ui.appSettings && ...}`):

```tsx
      {browsing && (
        <FolderBrowserModal
          connectionId={form.connectionId}
          onPick={(p) => { setForm({ ...form, path: p }); setBrowsing(false); }}
          onClose={() => setBrowsing(false)}
        />
      )}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 6: Manual check**

Restart the backend so the new route is live (`./restart.sh`), open the app, click "+ Novo projeto", click "Procurar":
- Confirm it opens showing your home directory's subfolders (files excluded).
- Click into a folder, confirm the breadcrumb updates and you can click a breadcrumb segment to jump back up.
- At `/`, confirm there's no `..` row (Review Focus: root has no parent to go up to).
- Navigate into an empty folder (or `mkdir /tmp/empty-test` first), confirm it shows "Pasta vazia", not a stuck spinner (Review Focus: empty directory).
- Click "Selecionar esta pasta", confirm the path input in the form now holds that exact path.
- If you have an SSH connection configured: switch the connection dropdown to it, reopen "Procurar", confirm it browses the *remote* filesystem, not local (Review Focus: stale connection) — then disconnect/stop that host and try "Procurar" again, confirm you get an inline error in the modal instead of a crash (Review Focus: SSH unreachable).
- Finish creating a project via a browsed path end-to-end (click "Adicionar") and confirm it appears in the sidebar normally.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/projects/Sidebar.tsx
git commit -m "feat: wire folder browser into new-project form"
```

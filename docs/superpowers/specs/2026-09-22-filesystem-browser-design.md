# Filesystem Browser — Design Spec

## Context

`code-nest` lets a user create a "project" (a working directory the Claude Code SDK opens sessions in), local or over SSH. Today, `Sidebar.tsx`'s "+ Novo projeto" form only has a free-text `path` input — the user has to already know and type the absolute path.

This is sub-project 1 of 3 the user requested in one message (folder picker, cost/usage dashboard, file attachments in chat). The three were decomposed because they're independent subsystems; this spec covers only the filesystem browser, which the folder picker (#1) uses directly and the future file-attachment feature (#3) will reuse without backend rework (see "Future reuse" below). The dashboard (#2) is unrelated and out of scope here.

## Goal

Add a "Procurar" (browse) button next to the existing path input in "+ Novo projeto". It opens a modal that lists the server's filesystem (local or the selected SSH connection), lets the user navigate into folders, and on "Selecionar esta pasta" fills the existing path input with the chosen absolute path. The manual text input stays — this is an added convenience, not a replacement, per explicit user decision.

## Non-goals

- No dashboard, no usage aggregation (sub-project 2).
- No file (as opposed to folder) picking or session attachments (sub-project 3) — though the backend endpoint is shaped so #3 can reuse it unchanged (see below).
- No new permission model: browsing a connection's filesystem is the same trust boundary the app already has for that connection (it already lets Claude Code run Bash/edit files there) — no extra ACL.

## Backend

### `Transport.listDir` (new method on the existing interface, `server/src/runtime/types.ts`)

```ts
export interface DirEntry { name: string; isDir: boolean }
// path === null => resolve and list the connection's home directory. Returns null if the path doesn't exist,
// isn't a directory, or listing failed (permission denied, SSH unreachable, etc — same "null on failure" shape usage()/git() already use).
listDir(path: string | null): Promise<{ path: string; entries: DirEntry[] } | null>;
```

- **`local-transport.ts`**: `path ?? homedir()`, then `fs.readdir(resolved, { withFileTypes: true })`, map to `{ name, isDir: d.isDirectory() }`; catch → `null`.
- **`ssh-transport.ts`**: `path ?? '$HOME'` expanded server-side; run `cd <shq(dir)> && pwd && ls -1p .` over the existing `sh()`/`runSsh()` helper (same one `git`/`shell` already use); first output line is the resolved absolute path, remaining lines are entries, POSIX `ls -p` suffixes directories with `/` (strip it to get `isDir`); non-zero exit → `null`.

Both implementations reuse existing helpers (`shq`, `runSsh`/`spawnManaged`-adjacent `sh()`) — no new process-spawning pattern.

### Route: `GET /api/connections/:id/browse?path=<abs|omitted>&kind=dir|all`

In `routes.ts`, next to the other connection/project routes:

- `kind` defaults to `dir` (folders only — what this sub-project needs); `all` includes files too (unused today, exists for #3's reuse).
- If `path` is given: validate the same way `POST /projects` already validates its `path` field (`path.posix.normalize`, must start with `/`, no control characters) before calling `listDir`.
- If `path` is omitted: pass `null` straight through — `listDir` resolves the connection's home.
- Unknown connection id → 404. `listDir` returning `null` → 404 with a friendly error (reuses `explainSshError` semantics already used elsewhere for SSH failures, just surfaced as the JSON `error` field).
- Response: `{ path: string; entries: DirEntry[] }` — `path` is the *resolved* absolute path (so the client always has a canonical current location, even after following `null`/home resolution or a symlink).

## Frontend

### `shared/src/index.ts`

Add `export interface DirEntry { name: string; isDir: boolean }` — used by both the API client and the modal.

### `api.ts`

```ts
browse: (connectionId: string, path: string | null, kind: 'dir' | 'all' = 'dir') =>
  req<{ path: string; entries: DirEntry[] }>('GET', `/api/connections/${connectionId}/browse?${path ? `path=${encodeURIComponent(path)}&` : ''}kind=${kind}`),
```

### `FolderBrowserModal.tsx` (new, `web/src/features/projects/`)

Props: `{ connectionId: string; onPick: (path: string) => void; onClose: () => void }`.

- On mount and on every navigation, calls `api.browse(connectionId, currentPath, 'dir')` (`currentPath` starts `null` → home).
- Renders: breadcrumb (current path split on `/`, each segment clickable to jump up to it), a `..` row when not at `/`, the folder list (dotfile-named folders hidden by default behind a "mostrar ocultos" toggle — same convention as the existing "mostrar arquivadas" checkbox in `Sidebar.tsx`), a manual "ir para…" text input for typing a jump-to path directly, and a "Selecionar esta pasta" button that calls `onPick(currentPath)` then `onClose()`.
- Error state (permission denied, SSH down, path vanished mid-navigation): shown inline in the modal without closing it, so the user can back out via breadcrumb/`..` instead of losing the dialog.
- Same visual language as `ProjectSettingsModal`/`AppSettingsModal` (centered overlay, `rounded-lg border border-zinc-800 bg-zinc-900`).

### `Sidebar.tsx`

In the existing "+ Novo projeto" form: add a "Procurar" button next to the `path` input (same row), opening `FolderBrowserModal` with `connectionId={form.connectionId}`; `onPick` sets `form.path` to the chosen value. The rest of the "Adicionar" flow (`addProject()`) is untouched.

## Future reuse (#3, not built now)

The file-attachment sub-project will reuse this exact endpoint with `kind=all` and a different modal (or the same one with a `kind` prop and a file-vs-folder selection mode) instead of a new backend surface. Noted here only so the next spec doesn't reinvent it — no code for #3 in this plan.

## Error handling summary

| Case | Behavior |
|---|---|
| Unknown/removed connection id | 404 from route, modal shows "conexão desconhecida" and stays open on `onClose` only |
| Path doesn't exist / not a directory | `listDir` → `null` → 404, modal shows inline error, keeps prior breadcrumb navigable |
| SSH connection unreachable | Same 404 path, error text reuses `explainSshError`'s message |
| Permission denied on a directory | Same 404 path (both transports return `null` on any read failure, not distinguished — consistent with existing `usage()`/`git()` behavior) |

## Testing

No automated test suite in this project (explicit decision, `docs/testing.md`). Validation: `npm run typecheck` + `npm run build` after each task, plus manual checks — browse local filesystem, browse a configured SSH connection, trigger a permission-denied directory, create a project via a browsed path end-to-end.

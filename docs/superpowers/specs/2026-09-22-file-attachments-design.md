# File Attachments — Design Spec

## Context

Sub-project 3 of 3 from the user's original request (filesystem browser, cost dashboard, file attachments). Depends on sub-project 1 (filesystem browser, `docs/superpowers/specs/2026-09-22-filesystem-browser-design.md` / already implemented on `develop`) — this feature reuses its `GET /api/connections/:id/browse` route and its `FolderBrowserModal` component instead of building a second file-picker.

**Autonomy note:** this spec was written under the user's standing session authorization (2026-09-22, "não vou estar na minha máquina") to proceed through spec → plan → implementation without waiting for approval at each stage. Every place below where the original request left a real decision open is marked **Ruling:** with the choice made and why — the user reviews these after the fact instead of before.

## Goal

A "+" button next to the chat composer opens a small menu (today: just "Selecionar arquivo"). Picking it opens the existing folder browser in file-picking mode; picking a file adds its absolute path to a per-session "staged attachments" list — visible in the session header next to the cost/token pill as "N arquivos" (clickable to see the list and add more), not shown inside the composer text. On the next message sent, every staged attachment travels with it (images embedded so the model actually sees them; anything else referenced by path so Claude's own tools can open it), then the staged list clears.

## Rulings (decisions made without a synchronous approval round)

1. **Attachments are per-message, not persistent.** They attach to the *next* send and are cleared after — mirrors how Slack/ChatGPT-style composers behave, and avoids a second concept of "permanently attached session context" the user never asked for. **Cost if wrong:** user has to re-attach the same file for a follow-up question; cheap to change later (just don't clear on send) if they'd rather it stick.
2. **No file upload/copy — attachments are picked from the filesystem the connection already runs on**, using the exact same browse endpoint sub-project 1 built. A local project attaches local files; an SSH project attaches files already on that remote host. There is no "upload from your laptop to a remote session" path in this spec. **Cost if wrong:** if the user actually wanted to push a file from their own machine into a remote SSH project, that's a materially different (and bigger) feature — upload transport, not a picker — worth its own spec if they ask.
3. **Only images are embedded as real multimodal content** (`image/png`, `image/jpeg`, `image/gif`, `image/webp` — the four media types the Anthropic Messages API's image block accepts), capped at 5 MB (`MAX_ATTACH_BYTES`) to avoid a giant base64 payload blowing up the request; over the cap, it falls back to a path reference like every other file type. Zips and everything else are never embedded — Claude Code already has Bash/Read tools to open them itself once it knows the path. **Cost if wrong:** a large "important" image over 5MB silently degrades to a path reference instead of erroring — acceptable since Claude can still `Read`/inspect it via tools; revisit the cap if it bites in practice.
4. **"Selecionar arquivo" is the only menu item now** (per the request's own "por enquanto") — the menu is still built as a real (if currently one-item) menu component, not hardcoded to a single button, so adding a second source later (e.g. "colar da área de transferência") doesn't require restructuring.

## Non-goals

- No dashboard (#2), no changes to the folder-picker's directory-only mode from #1.
- No drag-and-drop, no clipboard paste, no upload-from-browser (browser file inputs can't give an absolute server path anyway — this is why sub-project 1 exists).
- No persistence of attachments across a page reload — staged attachments live in frontend memory only (`store.ts`), same lifetime as the composer's draft text.

## Backend

### `Transport.readFile` (new method, `server/src/runtime/types.ts`)

```ts
/** lê um arquivo inteiro em base64; null se não existe/não é arquivo/sem permissão/maior que o limite do caller */
readFile(path: string, maxBytes: number): Promise<string | null>;
```

- **`local-transport.ts`**: `fs.stat` to check size ≤ `maxBytes` and that it's a regular file, then `fs.readFile(path).toString('base64')`; any failure → `null`.
- **`ssh-transport.ts`**: `stat -c %s <path>` first (reuse `sh()`); if size > `maxBytes` or `stat` fails → `null`; else `base64 -w0 <path>` over the same `sh()` helper (mirrors how `usage()` already pipes remote file content through a shell command), non-zero exit → `null`.

### Attachment resolution (`server/src/runtime/sdk-runtime.ts`)

A small module-level helper, not a new file (this logic is ~15 lines and only `sdk-runtime.ts`'s `Live.send` calls it):

```ts
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_ATTACH_BYTES = 5 * 1024 * 1024;

async function attachmentBlocks(transport: Transport, paths: string[]): Promise<ContentBlockParam[]> {
  const blocks: ContentBlockParam[] = [];
  for (const p of paths) {
    const mime = IMAGE_MIME[path.extname(p).toLowerCase()];
    const b64 = mime ? await transport.readFile(p, MAX_ATTACH_BYTES) : null;
    blocks.push(b64
      ? { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }
      : { type: 'text', text: `[Arquivo anexado: ${p}]` });
  }
  return blocks;
}
```

`Live.send(text, attachments?)` becomes:

```ts
send(text: string, attachments: string[] = []) {
  if (attachments.length === 0) {
    this.input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
    return;
  }
  void attachmentBlocks(this.transport, attachments).then((blocks) => {
    this.input.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }, ...blocks] }, parent_tool_use_id: null });
  });
}
```

(`Live` doesn't currently hold a reference to `transport` — it's passed into `open()`/the constructor already, per the existing `constructor(o: OpenOptions, resume: boolean, transport: Transport)`; the plan stores it as `this.transport` alongside the existing constructor-injected fields.)

### Protocol / hub plumbing

- `shared/src/index.ts`: `ClientMsg`'s `send` variant gains `attachments: z.array(z.string()).max(10).optional()` (cap of 10 files per message — a sane ceiling, not a real requirement, to keep one message from embedding an unbounded number of images).
- `LiveSession.send` (`server/src/runtime/types.ts`) gains the same optional second parameter.
- `SessionHub.send` (`server/src/hub.ts`) — its existing `text: string` parameter becomes `text: string, attachments: string[] = []`, forwarded straight to `e.live.send(text, attachments)`.
- `server/src/ws.ts` — the `send` message handler passes `m.attachments` through to `hub.send(...)`.

No new event type: the model sees the attachment as part of the same `user.message` turn: the frontend keeps showing the plain `text` for that message (attachments aren't re-echoed into the transcript as their own bubble) — see Frontend below for how the *user* still sees confirmation that they were included.

## Frontend

### `store.ts`

- `Chat` (in `reduce.ts`) doesn't need a new field — attachments are pre-send state, not part of the turn history.
- New store field: `attachments: Record<string, string[]>` (keyed by `sessionId`) — the staged list for a not-yet-sent message.
- `send(text)` becomes `send(text)` internally reading `get().attachments[sessionId]`, sending both, then clearing that session's entry:

```ts
send(text) {
  const a = get().active;
  if (!a) return;
  const files = get().attachments[a.sessionId] ?? [];
  sock?.send({ type: 'send', sessionId: a.sessionId, text, attachments: files.length ? files : undefined });
  if (files.length) set((s) => ({ attachments: { ...s.attachments, [a.sessionId]: [] } }));
},
addAttachment(sessionId, path) {
  set((s) => ({ attachments: { ...s.attachments, [sessionId]: [...(s.attachments[sessionId] ?? []), path] } }));
},
removeAttachment(sessionId, path) {
  set((s) => ({ attachments: { ...s.attachments, [sessionId]: (s.attachments[sessionId] ?? []).filter((p) => p !== path) } }));
},
```

### `FolderBrowserModal.tsx` — extend, don't duplicate

Add a `mode: 'dir' | 'file'` prop (default `'dir'`, so sub-project 1's existing call site in `Sidebar.tsx` needs zero changes):
- `mode='file'` passes `kind='all'` to `api.browse` (files now show up, not just directories) and makes clicking a **file** entry call `onPick(fullPath)` immediately (folders still just navigate deeper, same as today).
- The bottom "Selecionar esta pasta" button only renders in `mode='dir'` — in `mode='file'` there's nothing to "confirm", picking *is* clicking a file.

### `AttachMenu` (new, tiny — `web/src/features/chat/AttachMenu.tsx`)

A "+" button in the composer row that opens a small popover with one item today ("Selecionar arquivo"). Clicking it opens `FolderBrowserModal` with `mode="file"`; `onPick` calls `addAttachment(sessionId, path)` and closes both the popover and the modal. Built as a real (list-of-one) menu so a second entry later is a one-line addition, not a restructure (Ruling 4).

### Composer wiring (`Chat.tsx`)

- Renders `<AttachMenu sessionId={active.sessionId} />` next to the existing textarea (same row, left of it or as a leading icon button — visual placement is a styling detail, not a design decision).
- Session header (the same row that already shows the `$cost · tokens` pill, `Chat.tsx`'s header) gains a sibling pill: `N arquivos` (only rendered when `N > 0`), clickable to open a small popover listing the staged paths with a remove (✕) button per entry and the same "+" affordance to add more — reuses `AttachMenu`'s picker, doesn't duplicate it.

## Error handling

| Case | Behavior |
|---|---|
| Picked file vanishes/becomes unreadable before send | `Transport.readFile`/the image path returns `null` → falls back to the plain `[Arquivo anexado: <path>]` text block (same fallback as a non-image), never blocks sending the message |
| Image over `MAX_ATTACH_BYTES` | Same fallback — text reference instead of embedded image (Ruling 3) |
| SSH connection down when the message is sent | Existing send-time error handling (session already surfaces "desconectado…"/reconnect banners) — attachments don't introduce a new failure path, they ride the same `send` |
| More than 10 attachments staged | Frontend caps `addAttachment` at 10 (mirrors the schema's `.max(10)`) with a no-op + console warning past the cap — no user-facing message needed since 10 is generous headroom, not a real constraint anyone should hit by accident |

## Testing

No automated test suite (`docs/testing.md`). Validation: `npm run typecheck && npm run build` per task, plus manual checks — attach a small PNG and confirm the model's response shows it actually looked at the image (asks about its content, not just the filename); attach a non-image file and confirm Claude uses Bash/Read on the referenced path; attach then remove before sending; attach on an SSH-connected project and confirm the file is read from the remote host, not the local machine.

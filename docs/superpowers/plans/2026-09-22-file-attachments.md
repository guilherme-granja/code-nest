# File Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "+" button in the chat composer lets the user pick a file (via the existing filesystem browser, extended to a file-picking mode) and stage it as an attachment for the next message; images are embedded as real multimodal content, everything else is referenced by path. A header pill shows how many files are staged, cleared once sent.

**Architecture:** Backend gets one new `Transport.readFile` method (same local/SSH pattern as `listDir`), threaded through `LiveSession.send`/`SessionHub.send`/the WebSocket protocol as an optional `attachments: string[]`. `sdk-runtime.ts`'s `Live.send` turns attachment paths into Anthropic content blocks (image blocks for recognized image extensions under a size cap, plain text references for everything else) before pushing the user message. Frontend gets a per-session staged-attachments list in `store.ts`, a small reusable `AttachMenu` component, and a `mode` prop on the existing `FolderBrowserModal` (built in the filesystem-browser plan) so file-picking reuses it instead of duplicating a picker.

**Tech Stack:** TypeScript strict, Node.js/Hono backend, `@anthropic-ai/claude-agent-sdk` (`SDKUserMessage.message.content` accepts an Anthropic Messages API content-block array — `text`/`image` blocks, confirmed against `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`), React 19 frontend, no test framework.

**Spec:** `docs/superpowers/specs/2026-09-22-file-attachments-design.md`

## Global Constraints

- Attachments are per-message, not persistent: staged in frontend memory, sent with the next message, cleared after (spec Ruling 1).
- No upload — only files already on the filesystem the session's connection runs on, picked via the same `GET /connections/:id/browse` route the filesystem-browser plan built (spec Ruling 2). Do not add any new file-transfer mechanism.
- Only `image/png`, `image/jpeg`, `image/gif`, `image/webp` (by extension) are embedded as real image content blocks, capped at 5 MB (`MAX_ATTACH_BYTES`); anything else (including an oversized image) falls back to a `[Arquivo anexado: <path>]` text block (spec Ruling 3).
- `Transport.readFile` follows the same "null on any failure, never throw" convention as every other `Transport` method.
- Max 10 staged attachments per message (schema-enforced server-side, mirrored client-side).
- No automated test suite — verification is `npm run typecheck && npm run build` plus manual checks per task.

## Review Focus

- **A picked file is deleted/unreadable by the time the message is actually sent:** `readFile` returning `null` must fall back to the text-reference block, never throw or block sending (this is the same shape as the filesystem-browser plan's "vanished path" risk, now on the read side instead of the list side).
- **An image over the 5 MB cap:** must silently fall back to the text reference, not error out or truncate a partial base64 payload into a broken image block.
- **A non-image, non-trivial file (a `.zip`) attached:** must never attempt to read/base64 it — only the path reference — so attaching a large archive doesn't spend memory/time reading bytes nobody asked to embed.
- **Removing an attachment before sending, then sending with zero attachments left:** must behave exactly like a message with no attachments ever existed (no empty `attachments: []` sent, no stray content-block array with just a text block wrapping the message unnecessarily).
- **Picking a *folder* while `FolderBrowserModal` is in `mode="file"`:** must still navigate into it (not attempt to attach a directory) — folders keep behaving as navigation targets in every mode; only a file entry ends the picking flow.

---

## File Map

| File | Change |
|---|---|
| `server/src/runtime/types.ts` | add `Transport.readFile`, widen `LiveSession.send` |
| `server/src/runtime/local-transport.ts` | implement `readFile` |
| `server/src/runtime/ssh-transport.ts` | implement `readFile` |
| `server/src/runtime/sdk-runtime.ts` | `Live` stores `transport`; `send()` builds content blocks from attachments |
| `shared/src/index.ts` | `ClientMsg`'s `send` variant gains `attachments` |
| `server/src/hub.ts` | `SessionHub.send` forwards `attachments` |
| `server/src/ws.ts` | passes `m.attachments` through |
| `web/src/store.ts` | staged-attachments state, `addAttachment`/`removeAttachment`, `send()` reads+clears them |
| `web/src/features/projects/FolderBrowserModal.tsx` | add `mode: 'dir' \| 'file'` prop |
| `web/src/features/chat/AttachMenu.tsx` | new — the "+" menu |
| `web/src/features/chat/Chat.tsx` | composer wiring + header "N arquivos" pill |

---

### Task 1: `Transport.readFile`

**Files:**
- Modify: `server/src/runtime/types.ts` (right after `listDir`)
- Modify: `server/src/runtime/local-transport.ts` (right after `listDir`)
- Modify: `server/src/runtime/ssh-transport.ts` (right after `listDir`)

**Interfaces:**
- Produces: `Transport.readFile(path: string, maxBytes: number): Promise<string | null>` — base64-encoded file content, or `null` on any failure (not found, not a regular file, over `maxBytes`, permission denied, SSH unreachable).

- [ ] **Step 1: Add to the `Transport` interface**

```ts
  /** lê um arquivo inteiro em base64; null se não existe/não é arquivo/sem permissão/maior que maxBytes */
  readFile(path: string, maxBytes: number): Promise<string | null>;
```

- [ ] **Step 2: Implement in `local-transport.ts`**

```ts
  async readFile(p, maxBytes) {
    try {
      const st = await fs.stat(p);
      if (!st.isFile() || st.size > maxBytes) return null;
      return (await fs.readFile(p)).toString('base64');
    } catch { return null; }
  },
```

- [ ] **Step 3: Implement in `ssh-transport.ts`**

```ts
    async readFile(p, maxBytes) {
      const sizeR = await sh(`stat -c %s ${shq(p)} 2>/dev/null`);
      const size = Number(sizeR.stdout.trim());
      if (sizeR.code !== 0 || !Number.isFinite(size) || size > maxBytes) return null;
      const r = await sh(`base64 -w0 ${shq(p)}`, 30_000);
      return r.code === 0 ? r.stdout.trim() : null;
    },
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: succeeds.

- [ ] **Step 5: Manual check**

```bash
node -e "require('fs').promises.readFile('/etc/hostname').then(b => console.log(b.toString('base64')))"
```
Compare that output by hand against what `local-transport.ts`'s new method would produce for the same file (same base64 alphabet, no newlines) — confirms the encoding approach before it's wired into anything.

- [ ] **Step 6: Commit**

```bash
git add server/src/runtime/types.ts server/src/runtime/local-transport.ts server/src/runtime/ssh-transport.ts
git commit -m "feat: add Transport.readFile for local and SSH filesystems"
```

---

### Task 2: Thread attachments through the send path (protocol → hub → ws → SDK)

**Files:**
- Modify: `shared/src/index.ts` (`ClientMsg`'s `send` variant)
- Modify: `server/src/runtime/types.ts` (`LiveSession.send`)
- Modify: `server/src/hub.ts` (`SessionHub.send`)
- Modify: `server/src/ws.ts` (the `send` case)
- Modify: `server/src/runtime/sdk-runtime.ts` (`Live`'s constructor and `send`)

**Interfaces:**
- Consumes: `Transport.readFile` from Task 1.
- Produces: `LiveSession.send(text: string, attachments?: string[]): void`; `SessionHub.send(id: string, text: string, attachments?: string[]): Promise<'ok' | 'busy'>` — Task 3's frontend store calls the client protocol this enables, not these server functions directly.

- [ ] **Step 1: Widen the WebSocket schema**

In `shared/src/index.ts`, change:
```ts
  z.object({ type: z.literal('send'), sessionId: uuidSchema, text: z.string().min(1).max(200_000) }),
```
to:
```ts
  z.object({ type: z.literal('send'), sessionId: uuidSchema, text: z.string().min(1).max(200_000), attachments: z.array(z.string()).max(10).optional() }),
```

- [ ] **Step 2: Widen `LiveSession.send`**

In `server/src/runtime/types.ts`, change:
```ts
  send(text: string): void;
```
to:
```ts
  send(text: string, attachments?: string[]): void;
```

- [ ] **Step 3: Forward through `SessionHub.send`**

In `server/src/hub.ts`, change:
```ts
  async send(id: string, text: string): Promise<'ok' | 'busy'> {
```
to:
```ts
  async send(id: string, text: string, attachments: string[] = []): Promise<'ok' | 'busy'> {
```
and change the line near the end of that method:
```ts
    e.live.send(text);
```
to:
```ts
    e.live.send(text, attachments);
```

- [ ] **Step 4: Pass it through `ws.ts`**

Change:
```ts
            if ((await o.hub.send(m.sessionId, m.text)) === 'busy') client.send({ type: 'error', code: 'busy', message: 'sessão ocupada' });
```
to:
```ts
            if ((await o.hub.send(m.sessionId, m.text, m.attachments)) === 'busy') client.send({ type: 'error', code: 'busy', message: 'sessão ocupada' });
```

- [ ] **Step 5: Store `transport` on `Live` and build attachment content blocks**

In `server/src/runtime/sdk-runtime.ts`, add near the top (after the existing `import type { ClaudeRuntime, LiveSession, OpenOptions, SessionInfo, Transport } from './types';` line), a `node:path` import:
```ts
import path from 'node:path';
```

Add these module-level constants and helper right after `const CLASSIFY_TIMEOUT_MS = 15_000;`:
```ts
type AttachBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } };
const IMAGE_MIME: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_ATTACH_BYTES = 5 * 1024 * 1024;

// imagem reconhecida e dentro do limite -> bloco de imagem real; qualquer outro caso -> só a referência do caminho (Claude já lê/abre com as próprias ferramentas)
async function attachmentBlocks(transport: Transport, paths: string[]): Promise<AttachBlock[]> {
  const blocks: AttachBlock[] = [];
  for (const p of paths) {
    const mime = IMAGE_MIME[path.extname(p).toLowerCase()];
    const b64 = mime ? await transport.readFile(p, MAX_ATTACH_BYTES) : null;
    blocks.push(b64 ? { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } } : { type: 'text', text: `[Arquivo anexado: ${p}]` });
  }
  return blocks;
}
```

Change the `Live` constructor signature from:
```ts
  constructor(o: OpenOptions, resume: boolean, transport: Transport) {
```
to:
```ts
  constructor(o: OpenOptions, resume: boolean, private transport: Transport) {
```
(TypeScript parameter properties: this both keeps `transport` usable by its bare name inside the constructor body exactly as before — the existing `spawnClaudeCodeProcess: (so) => transport.spawn(...)` line needs no change — and assigns it to `this.transport` for `send()` to use.)

Change `send`:
```ts
  send(text: string) {
    this.input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
  }
```
to:
```ts
  send(text: string, attachments: string[] = []) {
    if (attachments.length === 0) {
      this.input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
      return;
    }
    void attachmentBlocks(this.transport, attachments).then((blocks) => {
      const content: AttachBlock[] = [{ type: 'text', text }, ...blocks];
      this.input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
    });
  }
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed. If `content: AttachBlock[]` doesn't structurally satisfy `MessageParam['content']` (the Anthropic SDK's content-block union has more optional fields than `AttachBlock` declares), TypeScript will say so at this exact assignment — that's a real, fixable type mismatch, not a plan error; the fix is adding the missing optional fields as `undefined` or loosening `AttachBlock` to match the SDK's own exported block types more closely. Note it as a ruling if it happens; don't skip the check.

- [ ] **Step 7: Commit**

```bash
git add shared/src/index.ts server/src/runtime/types.ts server/src/hub.ts server/src/ws.ts server/src/runtime/sdk-runtime.ts
git commit -m "feat: thread attachments through send (protocol, hub, ws, SDK content blocks)"
```

---

### Task 3: Frontend staged-attachments state

**Files:**
- Modify: `web/src/store.ts`

**Interfaces:**
- Consumes: the widened `ClientMsg` `send` shape from Task 2.
- Produces: `attachments: Record<string, string[]>` (store field, keyed by `sessionId`); `addAttachment(sessionId: string, path: string): void`; `removeAttachment(sessionId: string, path: string): void` — Task 5's `AttachMenu`/header pill call these two by exact name.

- [ ] **Step 1: Add the field to the `App` interface and initial state**

In the `App` interface, add near `commands`:
```ts
  attachments: Record<string, string[]>; // sessionId -> caminhos absolutos ainda não enviados
```
And in the returned initial state object (next to `commands: {},`):
```ts
    attachments: {},
```

- [ ] **Step 2: Add the two actions to the `App` interface**

Near `ensureCommands`:
```ts
  addAttachment(sessionId: string, path: string): void;
  removeAttachment(sessionId: string, path: string): void;
```

- [ ] **Step 3: Implement them and rewrite `send`**

Change:
```ts
    send(text) {
      const a = get().active;
      if (a) sock?.send({ type: 'send', sessionId: a.sessionId, text });
    },
```
to:
```ts
    send(text) {
      const a = get().active;
      if (!a) return;
      const files = get().attachments[a.sessionId] ?? [];
      sock?.send({ type: 'send', sessionId: a.sessionId, text, attachments: files.length ? files : undefined });
      if (files.length) set((s) => ({ attachments: { ...s.attachments, [a.sessionId]: [] } }));
    },
    addAttachment(sessionId, p) {
      set((s) => {
        const cur = s.attachments[sessionId] ?? [];
        if (cur.length >= 10 || cur.includes(p)) return s;
        return { attachments: { ...s.attachments, [sessionId]: [...cur, p] } };
      });
    },
    removeAttachment(sessionId, p) {
      set((s) => ({ attachments: { ...s.attachments, [sessionId]: (s.attachments[sessionId] ?? []).filter((x) => x !== p) } }));
    },
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add web/src/store.ts
git commit -m "feat: add staged-attachments state to the store"
```

---

### Task 4: `FolderBrowserModal` file-picking mode

**Files:**
- Modify: `web/src/features/projects/FolderBrowserModal.tsx`

**Interfaces:**
- Produces: `FolderBrowserModal`'s prop signature becomes `{ connectionId: string; mode?: 'dir' | 'file'; onPick: (path: string) => void; onClose: () => void }` (`mode` optional, defaults `'dir'` — the existing call site in `Sidebar.tsx` needs zero changes). Task 5 consumes it with `mode="file"`.

- [ ] **Step 1: Add the `mode` prop and switch the browse `kind`**

Change:
```tsx
export function FolderBrowserModal({ connectionId, onPick, onClose }: { connectionId: string; onPick: (path: string) => void; onClose: () => void }) {
```
to:
```tsx
export function FolderBrowserModal({ connectionId, mode = 'dir', onPick, onClose }: { connectionId: string; mode?: 'dir' | 'file'; onPick: (path: string) => void; onClose: () => void }) {
```
and change:
```tsx
    api.browse(connectionId, p, 'dir')
```
to:
```tsx
    api.browse(connectionId, p, mode === 'file' ? 'all' : 'dir')
```

- [ ] **Step 2: Make a file entry pick immediately; a folder entry still navigates**

Change:
```tsx
              {visible.map((e) => (
                <li key={e.name}>
                  <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800/60" onClick={() => load(`${path === '/' ? '' : path}/${e.name}`)}>
                    <span className="text-zinc-500">▸</span>{e.name}
                  </button>
                </li>
              ))}
```
to:
```tsx
              {visible.map((e) => {
                const full = `${path === '/' ? '' : path}/${e.name}`;
                return (
                  <li key={e.name}>
                    <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800/60" onClick={() => (e.isDir ? load(full) : onPick(full))}>
                      <span className="text-zinc-500">{e.isDir ? '▸' : '▪'}</span>{e.name}
                    </button>
                  </li>
                );
              })}
```

- [ ] **Step 3: Hide "Selecionar esta pasta" in file mode, adjust the title**

Change:
```tsx
          <h2 className="mb-2 text-sm font-semibold text-zinc-100">Escolher pasta</h2>
```
to:
```tsx
          <h2 className="mb-2 text-sm font-semibold text-zinc-100">{mode === 'file' ? 'Escolher arquivo' : 'Escolher pasta'}</h2>
```
and change:
```tsx
          <div className="flex justify-end gap-2 pt-1">
            <button className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200" onClick={onClose}>Cancelar</button>
            <button className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-40" disabled={!path} onClick={() => path && onPick(path)}>Selecionar esta pasta</button>
          </div>
```
to:
```tsx
          <div className="flex justify-end gap-2 pt-1">
            <button className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200" onClick={onClose}>Cancelar</button>
            {mode === 'dir' && (
              <button className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-40" disabled={!path} onClick={() => path && onPick(path)}>Selecionar esta pasta</button>
            )}
          </div>
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Manual check**

Restart the backend, open "+ Novo projeto" → "Procurar" (still `mode="dir"` by default, unchanged call site) and confirm folder-picking still works exactly as before (Review Focus item 5 from the *filesystem-browser* plan, re-checked here since this task edits that same component).

- [ ] **Step 6: Commit**

```bash
git add web/src/features/projects/FolderBrowserModal.tsx
git commit -m "feat: add file-picking mode to FolderBrowserModal"
```

---

### Task 5: Composer "+" menu, header pill, and wiring

**Files:**
- Create: `web/src/features/chat/AttachMenu.tsx`
- Modify: `web/src/features/chat/Chat.tsx`

**Interfaces:**
- Consumes: `FolderBrowserModal` (`mode="file"`) from Task 4; `addAttachment`/`removeAttachment`/`attachments` from Task 3.

- [ ] **Step 1: Create `AttachMenu.tsx`**

```tsx
import { useState } from 'react';
import { useApp } from '../../store';
import { FolderBrowserModal } from '../projects/FolderBrowserModal';

// "+" da composer: menu com uma opção por enquanto ("Selecionar arquivo"), abre o folder browser em modo arquivo.
export function AttachMenu({ sessionId, connectionId }: { sessionId: string; connectionId: string }) {
  const addAttachment = useApp((s) => s.addAttachment);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  return (
    <div className="relative">
      <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" title="Anexar" onClick={() => setOpen((o) => !o)}>+</button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-48 rounded-md border border-zinc-800 bg-zinc-900 p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <button className="block w-full rounded-sm px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800" onClick={() => { setOpen(false); setPicking(true); }}>Selecionar arquivo</button>
        </div>
      )}
      {picking && (
        <FolderBrowserModal
          connectionId={connectionId}
          mode="file"
          onPick={(p) => { addAttachment(sessionId, p); setPicking(false); }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the composer row**

In `Chat.tsx`, add the import:
```ts
import { AttachMenu } from './AttachMenu';
```
Change:
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
to:
```tsx
      <div className="relative border-t border-zinc-800/70 bg-zinc-950 p-3">
        {menuOpen && <SlashMenu items={matches} sel={Math.min(sel, matches.length - 1)} lean={!!project?.lean} onPick={pick} onHover={setSel} />}
        <div className="flex items-end gap-2">
          <AttachMenu sessionId={active.sessionId} connectionId={connId} />
          <textarea
            ref={input}
            className="h-20 min-w-0 flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-900/90 p-3 text-sm text-zinc-100 outline-none transition-colors duration-150 placeholder:text-zinc-500 focus:border-zinc-700 disabled:opacity-50"
            placeholder={busy ? 'Aguarde a resposta…' : 'Mensagem… ("/" comandos · "!" shell · Enter envia · Shift+Enter quebra linha)'}
            value={text}
            disabled={busy || !up}
            onChange={(e) => { setText(e.target.value); setSel(0); setDismissed(false); }}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
```

(`connId` already exists in this component — computed earlier as `const connId = project?.connectionId ?? 'local';`.)

- [ ] **Step 3: Add the header pill component**

Add this function above `export function Chat()`:
```tsx
function AttachedFilesPill({ sessionId, connectionId }: { sessionId: string; connectionId: string }) {
  const files = useApp((s) => s.attachments[sessionId] ?? []);
  const removeAttachment = useApp((s) => s.removeAttachment);
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;
  return (
    <div className="relative">
      <button className="rounded-md border border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1 font-mono text-xs text-zinc-400 hover:border-zinc-700" onClick={() => setOpen((o) => !o)}>
        {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 rounded-md border border-zinc-800 bg-zinc-900 p-2 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <ul className="mb-2 space-y-1">
            {files.map((f) => (
              <li key={f} className="flex items-center justify-between gap-2 rounded-sm bg-zinc-950/40 px-2 py-1 text-[11px] text-zinc-300">
                <span className="min-w-0 flex-1 truncate font-mono">{f}</span>
                <button className="shrink-0 text-zinc-500 hover:text-rose-400" onClick={() => removeAttachment(sessionId, f)}>✕</button>
              </li>
            ))}
          </ul>
          <AttachMenu sessionId={sessionId} connectionId={connectionId} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Render it in the header, next to the cost/tokens pill**

Change:
```tsx
          <div className="hidden items-center gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1 font-mono text-xs text-zinc-400 sm:flex" title={usageTitle}>
            <span className="text-zinc-300">${chat.totals.costUsd.toFixed(4)}</span>
            <span className="text-zinc-600">·</span>
            <span>{fmtTokens(chat.totals.input + chat.totals.output)} tokens</span>
          </div>
          {!up && <span className="text-xs text-rose-400">desconectado…</span>}
```
to:
```tsx
          <div className="hidden items-center gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1 font-mono text-xs text-zinc-400 sm:flex" title={usageTitle}>
            <span className="text-zinc-300">${chat.totals.costUsd.toFixed(4)}</span>
            <span className="text-zinc-600">·</span>
            <span>{fmtTokens(chat.totals.input + chat.totals.output)} tokens</span>
          </div>
          <AttachedFilesPill sessionId={active.sessionId} connectionId={connId} />
          {!up && <span className="text-xs text-rose-400">desconectado…</span>}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 6: Manual check**

Restart the backend. In a session: click "+", "Selecionar arquivo", pick a small PNG — confirm the header now shows "1 arquivo"; click it, confirm the path is listed with a working ✕ to remove it; add it back, send a message, confirm the pill disappears (cleared) and the model's reply demonstrates it actually saw the image (describes its content, not just echoes the filename). Attach a non-image file (any text file) and confirm Claude reads/uses it via its own tools once told the path. Try attaching while the connection is SSH-backed and confirm the file is read from the remote host.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/chat/AttachMenu.tsx web/src/features/chat/Chat.tsx
git commit -m "feat: wire attach-file menu and staged-files pill into chat composer"
```

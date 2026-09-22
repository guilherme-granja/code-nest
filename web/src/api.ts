import type { Config, ConnStatus, Connection, Effort, GitInfo, Model, Project, SessionRow, SlashCommandInfo } from '@ccui/shared';

const KEY = 'ccui-token';
let token: string | null = null;
export const getToken = () => token;

// o token chega em #token=… (fragmento não vai em logs nem Referer); guarda em memória + sessionStorage e limpa a URL
export function initToken(): string | null {
  const m = /token=([^&]+)/.exec(location.hash);
  if (m) {
    token = decodeURIComponent(m[1]);
    try { sessionStorage.setItem(KEY, token); } catch {}
    history.replaceState(null, '', location.pathname);
  } else if (!token) {
    try { token = sessionStorage.getItem(KEY); } catch {}
  }
  return token;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.status === 204 ? (undefined as T) : r.json();
}

export const api = {
  state: () => req<{ config: Config; projects: Project[]; status: Record<string, ConnStatus> }>('GET', '/api/state'),
  setConnection: (connectionId: string) => req<void>('POST', '/api/last-connection', { connectionId }),
  patchConfig: (b: Partial<{ model: Model; effort: Effort; maxBudgetUsd: number }>) => req<Config>('PATCH', '/api/config', b),
  addProject: (b: { name: string; path: string; lean: boolean; connectionId: string }) => req<Project>('POST', '/api/projects', b),
  testConnection: (b: { target: string; claudePath?: string }) => req<{ ok: boolean; version?: string; warning?: string; error?: string }>('POST', '/api/connections/test', b),
  addConnection: (b: { target: string; label?: string; claudePath?: string }) => req<{ connection: Connection; warning?: string }>('POST', '/api/connections', b),
  delConnection: (id: string) => req<void>('DELETE', `/api/connections/${id}`),
  patchProject: (id: string, b: Partial<Pick<Project, 'name' | 'lean' | 'routing' | 'bypass' | 'model' | 'effort'>>) => req<Project>('PATCH', `/api/projects/${id}`, b),
  delProject: (id: string) => req<void>('DELETE', `/api/projects/${id}`),
  sessions: (pid: string) => req<SessionRow[]>('GET', `/api/projects/${pid}/sessions`),
  newSession: (pid: string, b: { name: string; model?: Model; effort?: Effort }) => req<{ sessionId: string }>('POST', `/api/projects/${pid}/sessions`, b),
  patchSession: (sid: string, projectId: string, b: { name?: string; favorite?: boolean; archived?: boolean; tags?: string[] }) => req<void>('PATCH', `/api/sessions/${sid}`, { projectId, ...b }),
  commands: (pid: string) => req<SlashCommandInfo[]>('GET', `/api/projects/${pid}/commands`),
  git: (pid: string) => req<GitInfo | null>('GET', `/api/projects/${pid}/git`),
};

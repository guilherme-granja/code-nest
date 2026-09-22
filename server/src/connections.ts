import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ConnStatus } from '@ccui/shared';
import { localTransport } from './runtime/local-transport';
import { SdkRuntime } from './runtime/sdk-runtime';
import { sshTransport } from './runtime/ssh-transport';
import type { ClaudeRuntime, Transport } from './runtime/types';
import { ping } from './ssh-util';
import type { Store } from './store';

const MONITOR_MS = 15_000;

// versão do CLI que este SDK espera (declarada no package.json do próprio SDK)
export const expectedCliVersion: string = JSON.parse(
  readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')), 'package.json'), 'utf8'),
).claudeCodeVersion;

// H5: CLI remoto com major.minor diferente do esperado pelo SDK => aviso (não bloqueia)
export function versionWarning(remote: string): string | undefined {
  const mm = (v: string) => v.split('.').slice(0, 2).join('.');
  return mm(remote) === mm(expectedCliVersion)
    ? undefined
    : `o claude remoto é ${remote} e este backend espera ${expectedCliVersion}: alguns recursos podem se comportar de forma diferente`;
}

export class Connections {
  private cache = new Map<string, { runtime: ClaudeRuntime; transport: Transport }>();
  private statuses = new Map<string, ConnStatus>();

  constructor(private store: Store, private onStatus: (id: string, status: ConnStatus, message?: string) => void) {
    this.cache.set('local', { transport: localTransport, runtime: new SdkRuntime(localTransport) });
  }

  get(id: string) {
    let c = this.cache.get(id);
    if (!c) {
      const conn = this.store.config.data.connections.find((x) => x.id === id && x.kind === 'ssh' && x.target);
      if (!conn) throw new Error('conexão desconhecida');
      const transport = sshTransport({ target: conn.target!, claudePath: conn.claudePath });
      c = { transport, runtime: new SdkRuntime(transport) };
      this.cache.set(id, c);
    }
    return c;
  }

  drop(id: string) { this.cache.delete(id); this.statuses.delete(id); }

  markUp(id: string) { this.set(id, 'up'); } // o teste de conexão acabou de passar

  status(id: string): ConnStatus { return id === 'local' ? 'up' : this.statuses.get(id) ?? 'reconnecting'; }

  all(): Record<string, ConnStatus> {
    return Object.fromEntries(this.store.config.data.connections.map((c) => [c.id, this.status(c.id)]));
  }

  // ponytail: polling de 15 s (ssh true via ControlMaster é barato); trocar por `ssh -O check` se pesar
  start() {
    const tick = async () => {
      for (const c of this.store.config.data.connections) {
        if (c.kind !== 'ssh' || !c.target) continue;
        if (this.statuses.get(c.id) === 'down') this.set(c.id, 'reconnecting');
        const r = await ping(c.target);
        this.set(c.id, r.ok ? 'up' : 'down', r.ok ? undefined : r.error);
      }
    };
    void tick();
    setInterval(() => void tick(), MONITOR_MS).unref();
  }

  private set(id: string, status: ConnStatus, message?: string) {
    if (this.statuses.get(id) === status) return;
    this.statuses.set(id, status);
    this.onStatus(id, status, message);
  }
}

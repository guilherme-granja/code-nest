import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { DATA_DIR } from '../store';

const RUN_FILE = path.join(DATA_DIR, 'run.json');
const pids = new Set<number>();
const persist = () => { try { writeFileSync(RUN_FILE, JSON.stringify([...pids])); } catch {} };

// No startup: avisa (não mata) sobre `claude`/`ssh` deixado por um backend que morreu sem limpar.
// ponytail: só Linux (/proc). Outros SOs apenas não avisam.
export function reportOrphans(): void {
  let old: number[] = [];
  try { old = JSON.parse(readFileSync(RUN_FILE, 'utf8')); } catch { return; }
  for (const pid of old) {
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('claude')) console.warn(`[runtime] possível processo órfão do run anterior: pid ${pid} (não encerrado)`);
    } catch { /* já morreu */ }
  }
  persist();
}

// detached => grupo de processos próprio; kill(-pid) derruba o processo e filhos
export function spawnManaged(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env: NodeJS.ProcessEnv; signal: AbortSignal },
  onStderr: (chunk: string) => void,
): SpawnedProcess {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', onStderr);
  if (child.pid) { pids.add(child.pid); persist(); }
  child.on('exit', () => { if (child.pid) { pids.delete(child.pid); persist(); } });
  const kill = (sig: NodeJS.Signals) => { try { process.kill(-child.pid!, sig); return true; } catch { return false; } };
  opts.signal.addEventListener('abort', () => kill('SIGKILL'), { once: true });
  return {
    stdin: child.stdin!,
    stdout: child.stdout!,
    get killed() { return child.killed; },
    get exitCode() { return child.exitCode; },
    get signalCode() { return child.signalCode; },
    kill,
    on: child.on.bind(child),
    once: child.once.bind(child),
    off: child.off.bind(child),
  } as unknown as SpawnedProcess;
}

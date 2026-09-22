import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store';

export const TARGET_RE = /^(?!-)[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$/;
export const validTarget = (s: string) => s.length <= 255 && TARGET_RE.test(s);

export const DEFAULT_CLAUDE_PATH = '$HOME/.local/bin/claude';
const CLAUDE_PATH_RE = /^(\$HOME|~)?\/[A-Za-z0-9._@+/-]+$/;
export const validClaudePath = (s: string) => s.length <= 255 && CLAUDE_PATH_RE.test(s) && !s.includes('..');

// caminho já validado (sem `"`, `$` fora do prefixo, crase ou barra invertida) => seguro entre aspas duplas
export function claudeExpr(p: string): string {
  return p.startsWith('$HOME') || p.startsWith('~') ? `"$HOME${p.replace(/^(\$HOME|~)/, '')}"` : `"${p}"`;
}

// aspas simples POSIX: só `'` precisa de escape
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// mesma regra do Claude Code para nomear o diretório de projeto (confirmada em host real)
export const encodeCwd = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-');

export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CTL_DIR = path.join(DATA_DIR, 'ctl');
export function sshArgv(target: string, remoteCmd: string): string[] {
  mkdirSync(CTL_DIR, { recursive: true, mode: 0o700 });
  return [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPersist=60',
    '-o', `ControlPath=${CTL_DIR}/%C`,
    '--', target, remoteCmd,
  ];
}

const MAX_OUT = 32 * 1024 * 1024;

export function runSsh(target: string, remoteCmd: string, o: { timeoutMs?: number } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('ssh', sshArgv(target, remoteCmd), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => { if (stdout.length < MAX_OUT) stdout += d; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => { if (stderr.length < 4000) stderr += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 15_000);
    child.on('error', (e) => { clearTimeout(t); resolve({ code: 255, stdout, stderr: e.message }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
  });
}

export function explainSshError(stderr: string, target: string, code: number | null): string {
  const last = stderr.trim().split('\n').pop() ?? '';
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION/i.test(stderr)) return `host desconhecido ou chave alterada: rode "ssh ${target}" uma vez no terminal para conferir e aceitar a chave`;
  if (/Permission denied/i.test(stderr)) return 'autenticação falhou (sem senha: configure chave SSH ou agente para este host)';
  if (/timed out|No route|refused|Could not resolve|Network is unreachable/i.test(stderr)) return `servidor inacessível: ${last}`;
  return last || `ssh falhou (código ${code})`;
}

export async function ping(target: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await runSsh(target, 'true');
  return r.code === 0 ? { ok: true } : { ok: false, error: explainSshError(r.stderr, target, r.code) };
}

export async function checkConnection(target: string, claudePath = DEFAULT_CLAUDE_PATH): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const c = claudeExpr(claudePath);
  const r = await runSsh(target, `test -x ${c} || { echo NOCLAUDE; exit 3; }; ${c} --version`, { timeoutMs: 20_000 });
  if (r.code === 0) return { ok: true, version: /(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1] ?? r.stdout.trim() };
  if (r.code === 3) return { ok: false, error: `claude não encontrado em ${claudePath} no servidor (ajuste o caminho do claude)` };
  return { ok: false, error: explainSshError(r.stderr, target, r.code) };
}

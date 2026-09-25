import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ProfileView } from '@ccui/shared';
import { planUsage } from './runtime/sdk-runtime';
import { DATA_DIR, type Store } from './store';

// Claude accounts for local sessions. Each extra profile is its own CLAUDE_CONFIG_DIR holding only its login
// (.credentials.json + .claude.json); everything else is symlinked to the default config dir, so skills, plugins,
// settings and session history stay one shared set. Switching = pointing new spawns at another dir; the CLI
// refreshes the access token by itself, so no re-login until the refresh token expires or is revoked.

export const DEFAULT_PROFILE = 'default';
const DEFAULT_DIR = process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude');
const PRIVATE = new Set(['.credentials.json', '.claude.json', '.claude.json.backup']);
const LOGIN_TIMEOUT_MS = 10 * 60_000;
// ponytail: `claude` from PATH (the one the terminal uses), not the SDK-bundled binary
const CLAUDE = 'claude';

export const profileDir = (id: string) => (id === DEFAULT_PROFILE ? DEFAULT_DIR : path.join(DATA_DIR, 'profiles', id));
// the CLI keeps its global config inside CLAUDE_CONFIG_DIR when set, in $HOME otherwise
const globalConfigFile = (id: string) =>
  id === DEFAULT_PROFILE && !process.env.CLAUDE_CONFIG_DIR ? path.join(homedir(), '.claude.json') : path.join(profileDir(id), '.claude.json');
// default profile inherits the backend env untouched: forcing CLAUDE_CONFIG_DIR=~/.claude would move the CLI's global config
const envFor = (id: string): NodeJS.ProcessEnv => (id === DEFAULT_PROFILE ? process.env : { ...process.env, CLAUDE_CONFIG_DIR: profileDir(id) });

let activeDir: string | null = null;
/** CLAUDE_CONFIG_DIR for new local spawns; null = inherit (default profile) */
export const activeConfigDir = () => activeDir;

const readJson = async (file: string): Promise<Record<string, unknown> | null> => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
};

// ponytail: links are refreshed on create/activate only; an entry the CLI later replaces with a real file stops being shared
async function linkShared(id: string) {
  const dir = profileDir(id);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(DEFAULT_DIR, 'projects'), { recursive: true });
  for (const name of await fs.readdir(DEFAULT_DIR)) {
    if (PRIVATE.has(name)) continue;
    await fs.symlink(path.join(DEFAULT_DIR, name), path.join(dir, name)).catch(() => {}); // EEXIST: already linked
  }
  // seed the global config (MCP servers, trusted folders) without the other account's identity
  const cfg = path.join(dir, '.claude.json');
  if (!(await fs.stat(cfg).catch(() => null))) {
    const base = (await readJson(globalConfigFile(DEFAULT_PROFILE))) ?? {};
    delete base.oauthAccount;
    await fs.writeFile(cfg, JSON.stringify(base, null, 2), { mode: 0o600 });
  }
}

export async function activate(store: Store, id: string) {
  if (id !== DEFAULT_PROFILE) await linkShared(id);
  activeDir = id === DEFAULT_PROFILE ? null : profileDir(id);
  if (store.config.data.activeProfile !== id) {
    store.config.data.activeProfile = id;
    await store.config.save();
  }
}

export const knownProfile = (store: Store, id: string) => id === DEFAULT_PROFILE || !!store.config.data.profiles?.some((p) => p.id === id);

/** boot: restore the saved active profile (falls back to default when it no longer exists) */
export function initProfiles(store: Store) {
  const id = store.config.data.activeProfile;
  return activate(store, id && knownProfile(store, id) ? id : DEFAULT_PROFILE);
}

const cli = (id: string, args: string[]) =>
  new Promise<string>((resolve) => execFile(CLAUDE, args, { env: envFor(id), timeout: 15_000 }, (_err, out) => resolve(out ?? '')));

async function authStatus(id: string) {
  try { return JSON.parse(await cli(id, ['auth', 'status', '--json'])) as Record<string, unknown>; } catch { return null; }
}

export const logout = (id: string) => cli(id, ['auth', 'logout']);
export const usageFor = (id: string) => planUsage(envFor(id));

// login runs the CLI's own OAuth flow: it opens the browser and waits for the localhost callback; the URL is also
// surfaced to the UI, and `sendCode` covers the paste-the-code fallback when the callback can't reach this machine
const logins = new Map<string, { child: ChildProcessWithoutNullStreams; running: boolean; output: string; url?: string }>();
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

export async function startLogin(id: string) {
  if (id !== DEFAULT_PROFILE) await linkShared(id);
  logins.get(id)?.child.kill();
  const child = spawn(CLAUDE, ['auth', 'login'], { env: envFor(id), stdio: ['pipe', 'pipe', 'pipe'] });
  const s: { child: typeof child; running: boolean; output: string; url?: string } = { child, running: true, output: '' };
  const add = (d: Buffer) => {
    s.output = (s.output + d.toString('utf8')).slice(-4000);
    s.url ??= /https:\/\/[^\s\x07\x1b]+/.exec(s.output)?.[0];
  };
  child.stdout.on('data', add);
  child.stderr.on('data', add);
  const t = setTimeout(() => child.kill(), LOGIN_TIMEOUT_MS);
  child.on('error', (e) => { s.output += `\n${e.message}`; s.running = false; clearTimeout(t); });
  child.on('close', () => { s.running = false; clearTimeout(t); });
  logins.set(id, s);
}

export function sendCode(id: string, code: string) {
  const s = logins.get(id);
  if (!s?.running) return false;
  s.child.stdin.write(code + '\n');
  return true;
}

export async function removeProfile(store: Store, id: string) {
  logins.get(id)?.child.kill();
  logins.delete(id);
  await logout(id);
  if (store.config.data.activeProfile === id) await activate(store, DEFAULT_PROFILE);
  store.config.data.profiles = (store.config.data.profiles ?? []).filter((p) => p.id !== id);
  await store.config.save();
  await fs.rm(profileDir(id), { recursive: true, force: true }); // rm unlinks the symlinks, never follows them
}

export async function listProfiles(store: Store): Promise<ProfileView[]> {
  const active = store.config.data.activeProfile ?? DEFAULT_PROFILE;
  const all = [{ id: DEFAULT_PROFILE, name: 'Padrão' }, ...(store.config.data.profiles ?? [])];
  return Promise.all(all.map(async (p) => {
    const [status, global, creds] = await Promise.all([authStatus(p.id), readJson(globalConfigFile(p.id)), readJson(path.join(profileDir(p.id), '.credentials.json'))]);
    const o = creds?.claudeAiOauth as Record<string, unknown> | undefined;
    const login = logins.get(p.id);
    return {
      id: p.id, name: p.name, active: p.id === active, status,
      account: (global?.oauthAccount as Record<string, unknown> | undefined) ?? null,
      // metadata only: access/refresh tokens never leave the backend
      credentials: o ? {
        expiresAt: o.expiresAt as number | undefined, refreshTokenExpiresAt: o.refreshTokenExpiresAt as number | undefined,
        scopes: o.scopes as string[] | undefined, subscriptionType: o.subscriptionType as string | undefined, rateLimitTier: o.rateLimitTier as string | undefined,
      } : null,
      login: login ? { running: login.running, url: login.url, output: login.output.replace(ANSI, '') } : null,
    };
  }));
}

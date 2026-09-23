import { promises as fs, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { LOCAL, type Config, type Project, type SessionMeta } from '@ccui/shared';

export const DATA_DIR = process.env.CCUI_DATA_DIR ?? path.join(homedir(), '.claude-code-ui');

export class JsonFile<T> {
  private queue: Promise<void> = Promise.resolve();
  private constructor(private file: string, public data: T) {}

  static async open<T>(file: string, defaults: T): Promise<JsonFile<T>> {
    for (const f of [file, file + '.bak']) {
      try {
        const data = JSON.parse(await fs.readFile(f, 'utf8')) as T;
        if (f !== file) console.error(`[store] ${path.basename(file)} ausente/corrompido, restaurado de .bak`);
        return new JsonFile(file, data);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[store] falha ao ler ${path.basename(f)}`);
      }
    }
    return new JsonFile(file, defaults);
  }

  // escrita atômica (tmp + rename), serializada, com .bak do último estado bom
  save(): Promise<void> {
    const run = async () => {
      const tmp = this.file + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
      await fs.copyFile(this.file, this.file + '.bak').catch(() => {});
      await fs.rename(tmp, this.file);
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

// um backend por diretório de dados
async function acquireLock(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const lock = path.join(DATA_DIR, 'lock');
  for (let i = 0; i < 2; i++) {
    try {
      const h = await fs.open(lock, 'wx');
      await h.writeFile(String(process.pid));
      await h.close();
      process.on('exit', () => { try { unlinkSync(lock); } catch {} });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = Number(await fs.readFile(lock, 'utf8').catch(() => ''));
      if (pid && alive(pid)) throw new Error(`outro backend já está rodando (pid ${pid})`);
      await fs.unlink(lock).catch(() => {}); // lock velho
    }
  }
  throw new Error('não foi possível obter o lock');
}

export async function openStore() {
  await acquireLock();
  const p = (n: string) => path.join(DATA_DIR, n);
  return {
    config: await JsonFile.open<Config>(p('config.json'), {
      version: 1, lastConnectionId: null, defaults: { model: 'sonnet', effort: 'medium' }, connections: [LOCAL],
    }),
    projects: await JsonFile.open<{ version: 1; projects: Project[] }>(p('projects.json'), { version: 1, projects: [] }),
    sessions: await JsonFile.open<{ version: 1; sessions: SessionMeta[] }>(p('sessions.json'), { version: 1, sessions: [] }),
  };
}
export type Store = Awaited<ReturnType<typeof openStore>>;

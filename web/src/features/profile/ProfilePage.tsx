import { useCallback, useEffect, useState } from 'react';
import type { ProfileView } from '@ccui/shared';
import { api } from '../../api';
import { UsageModal } from './UsageModal';

const field = 'rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700';
const btn = 'rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40';

// ms epochs and ISO strings become local dates; nested objects stay as compact JSON
const show = (v: unknown): string => {
  if (typeof v === 'number' && v > 1e12) return new Date(v).toLocaleString();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString();
  if (Array.isArray(v)) return v.join(', ');
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

function Fields({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  const rows = Object.entries(data ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">{title}</div>
      <dl className="grid grid-cols-[minmax(0,12rem)_1fr] gap-x-3 gap-y-0.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate font-mono text-zinc-500">{k}</dt>
            <dd className="break-all text-zinc-300">{show(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ProfileCard({ p, reload, setErr }: { p: ProfileView; reload: () => Promise<void>; setErr: (e: string) => void }) {
  const [code, setCode] = useState('');
  const [open, setOpen] = useState(p.active);
  const [usage, setUsage] = useState(false);
  const loggedIn = p.status?.loggedIn === true;
  const run = async (f: () => Promise<void>) => { try { await f(); setErr(''); } catch (e) { setErr((e as Error).message); } await reload(); };

  return (
    <div className={`rounded-lg border p-4 ${p.active ? 'border-zinc-600 bg-zinc-900/60' : 'border-zinc-800 bg-zinc-900/30'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button className="text-left text-sm font-semibold text-zinc-100" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {p.name}</button>
        {p.active && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">ativo</span>}
        <span className={`text-xs ${loggedIn ? 'text-zinc-400' : 'text-amber-400'}`}>{loggedIn ? String(p.status?.email ?? '') : 'sem login'}</span>
        <div className="ml-auto flex gap-1.5">
          {!p.active && <button className={btn} disabled={!loggedIn} onClick={() => void run(() => api.profileAction(p.id, 'activate'))}>Usar</button>}
          {loggedIn && <button className={btn} onClick={() => setUsage(true)}>Uso</button>}
          <button className={btn} onClick={() => void run(() => api.profileAction(p.id, 'login'))}>{loggedIn ? 'Reautenticar' : 'Login'}</button>
          {loggedIn && (
            <button className={btn} onClick={() => {
              if (confirm(p.id === 'default' ? 'Sair da conta padrão? Isso também desloga o Claude Code do terminal.' : `Sair da conta do perfil "${p.name}"?`)) void run(() => api.profileAction(p.id, 'logout'));
            }}>Logout</button>
          )}
          {p.id !== 'default' && (
            <button className={`${btn} hover:text-rose-400`} onClick={() => { if (confirm(`Remover o perfil "${p.name}" e o login dele?`)) void run(() => api.delProfile(p.id)); }}>Remover</button>
          )}
        </div>
      </div>

      {p.login?.running && (
        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
          <div className="mb-2">Login em andamento: conclua no navegador.{p.login.url && <> Se a página não abriu, <a className="text-sky-400 underline" href={p.login.url} target="_blank" rel="noreferrer">abra aqui</a>.</>}</div>
          <div className="flex gap-1.5">
            <input className={`${field} flex-1`} placeholder="Código de autorização (se a página pedir para colar)" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className={btn} disabled={!code.trim()} onClick={() => void run(async () => { await api.loginCode(p.id, code); setCode(''); })}>Enviar</button>
          </div>
        </div>
      )}
      {p.login && !p.login.running && !loggedIn && p.login.output && (
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-950/60 p-2 text-[11px] text-zinc-500">{p.login.output}</pre>
      )}

      {open && (
        <>
          <Fields title="Status (claude auth status)" data={p.status} />
          <Fields title="Conta" data={p.account} />
          <Fields title="Credenciais" data={p.credentials} />
        </>
      )}
      {usage && <UsageModal profile={p} onClose={() => setUsage(false)} />}
    </div>
  );
}

export function ProfilePage({ onClose }: { onClose: () => void }) {
  const [profiles, setProfiles] = useState<ProfileView[] | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');

  const reload = useCallback(async () => {
    try { setProfiles(await api.profiles()); } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // poll only while a login is waiting on the browser
  const waiting = profiles?.some((p) => p.login?.running) ?? false;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [waiting, reload]);

  const add = async () => {
    try { await api.addProfile(name.trim()); setName(''); setErr(''); } catch (e) { setErr((e as Error).message); }
    await reload();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Perfil</h1>
        <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onClose}>Fechar</button>
      </div>
      <p className="mb-5 text-xs leading-relaxed text-zinc-500">
        Contas do Claude usadas pelas sessões locais. A troca vale para sessões abertas a partir de agora; sessões já em execução continuam na conta anterior.
        Projetos SSH usam o login do servidor remoto.
      </p>
      {err && <div className="mb-3 text-sm text-rose-400">{err}</div>}
      {!profiles && !err && <div className="text-sm text-zinc-600">Carregando…</div>}
      <div className="space-y-3">
        {profiles?.map((p) => <ProfileCard key={p.id} p={p} reload={reload} setErr={setErr} />)}
      </div>
      <div className="mt-5 flex gap-1.5">
        <input className={`${field} w-64`} placeholder="Nome do novo perfil" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void add(); }} />
        <button className={btn} disabled={!name.trim()} onClick={() => void add()}>+ Adicionar perfil</button>
      </div>
    </div>
  );
}

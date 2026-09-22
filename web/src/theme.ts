export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'ccui-theme';
let mode: ThemeMode = 'system';
try {
  const v = localStorage.getItem(KEY);
  if (v === 'light' || v === 'dark' || v === 'system') mode = v;
} catch { /* storage indisponível: segue o sistema */ }

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
// o atributo fica no <body>: o tema claro redefine variáveis lendo cópias do :root (ver index.css)
const apply = () => { document.body.dataset.theme = mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode; };
mq.addEventListener('change', apply);
apply();

export const getTheme = () => mode;
export const subscribeTheme = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export function setTheme(m: ThemeMode) {
  mode = m;
  try { localStorage.setItem(KEY, m); } catch { /* ignora */ }
  apply();
  listeners.forEach((f) => f());
}
export const cycleTheme = () => setTheme(mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system');
export const themeLabel: Record<ThemeMode, string> = { system: 'Tema: sistema', light: 'Tema: claro', dark: 'Tema: escuro' };

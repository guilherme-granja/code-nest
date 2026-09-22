// Notificações do navegador (opt-in). Nunca incluem conteúdo de mensagens: só nome da sessão e um aviso genérico.
const KEY = 'ccui-notify';
const supported = () => typeof Notification !== 'undefined';

export function notifyEnabled(): boolean {
  try { return supported() && Notification.permission === 'granted' && localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export async function enableNotify(): Promise<boolean> {
  if (!supported()) return false;
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  try { localStorage.setItem(KEY, p === 'granted' ? '1' : '0'); } catch { /* ignora */ }
  return p === 'granted';
}

export function disableNotify() {
  try { localStorage.setItem(KEY, '0'); } catch { /* ignora */ }
}

export function notify(title: string, body: string, tag: string) {
  if (!notifyEnabled()) return;
  try { new Notification(title, { body, tag }); } catch { /* ignora */ }
}

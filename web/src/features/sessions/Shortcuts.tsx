import { useEffect } from 'react';
import { useApp } from '../../store';

const KEYS: [string, string][] = [
  ['Ctrl/Cmd + K', 'Paleta: buscar sessões e ações'],
  ['Alt + N', 'Nova sessão'],
  ['Alt + L', 'Mostrar/ocultar a barra lateral'],
  ['Alt + ↑ / ↓', 'Trocar de aba de sessão'],
  ['Ctrl + J', 'Painel de comandos (terminal, somente leitura)'],
  ['/', 'No início da mensagem: comandos e skills (↑↓, Tab/Enter, Esc)'],
  ['! comando', 'Modo shell: roda o comando no diretório do projeto (local ou servidor), sem gastar tokens'],
  ['Enter / Shift + Enter', 'Enviar / quebrar linha'],
  ['Esc', 'Fechar janelas'],
  ['?', 'Esta ajuda'],
];

export function Shortcuts() {
  const setUi = useApp((s) => s.setUi);
  const close = () => setUi({ help: false });
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
      <div className="w-96 space-y-2 rounded-lg border border-zinc-700 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">Atalhos</h2>
        <dl className="space-y-1 text-sm">
          {KEYS.map(([k, d]) => (
            <div key={k} className="flex gap-3"><dt className="w-40 shrink-0 font-mono text-xs text-zinc-300">{k}</dt><dd className="text-zinc-400">{d}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  );
}

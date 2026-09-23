import { useState } from 'react';
import { useApp } from '../../store';
import { FolderBrowserModal } from '../projects/FolderBrowserModal';

// "+" da composer: menu com uma opção por enquanto ("Selecionar arquivo"), abre o folder browser em modo arquivo.
export function AttachMenu({ sessionId, connectionId }: { sessionId: string; connectionId: string }) {
  const addAttachment = useApp((s) => s.addAttachment);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  return (
    <div className="relative">
      <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" title="Anexar" onClick={() => setOpen((o) => !o)}>+</button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-48 rounded-md border border-zinc-800 bg-zinc-900 p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <button className="block w-full rounded-sm px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800" onClick={() => { setOpen(false); setPicking(true); }}>Selecionar arquivo</button>
        </div>
      )}
      {picking && (
        <FolderBrowserModal
          connectionId={connectionId}
          mode="file"
          onPick={(p) => { addAttachment(sessionId, p); setPicking(false); }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

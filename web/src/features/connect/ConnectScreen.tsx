import { useState } from 'react';
import { useApp } from '../../store';
import { ServerForm } from './ServerForm';

export function ConnectScreen() {
  const chooseConnection = useApp((s) => s.chooseConnection);
  const [remote, setRemote] = useState(false);
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-96 space-y-4">
        <h1 className="text-center text-2xl font-semibold">Claude Code UI</h1>
        <p className="text-center text-zinc-400">Onde deseja executar o Claude?</p>
        <button onClick={() => chooseConnection('local')} className="w-full rounded-lg border border-zinc-700 p-4 text-left hover:border-zinc-500">
          <div className="font-medium">Local</div>
          <div className="text-sm text-zinc-400">Executar nesta máquina</div>
        </button>
        <div className="rounded-lg border border-zinc-700 p-4">
          <button className="w-full text-left" onClick={() => setRemote(true)}>
            <div className="font-medium">Servidor remoto</div>
            <div className="text-sm text-zinc-400">Conectar via SSH (usa sua configuração SSH existente)</div>
          </button>
          {remote && <div className="mt-3"><ServerForm onDone={(id) => void chooseConnection(id)} /></div>}
        </div>
      </div>
    </div>
  );
}

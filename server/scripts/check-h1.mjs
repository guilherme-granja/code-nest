import { spawn } from 'node:child_process';

if (process.argv[2] === 'parent') {
  const c = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--setting-sources', ''],
    { stdio: ['pipe', 'pipe', 'ignore'], detached: true });
  console.log(c.pid);
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000);
} else {
  const p = spawn(process.execPath, [new URL(import.meta.url).pathname, 'parent'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.on('exit', () => setTimeout(() => {
    const pid = Number(out.trim());
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    console.log(alive ? `H1 FALSA: claude (pid ${pid}) continua vivo` : `H1 CONFIRMADA: claude (pid ${pid}) saiu`);
    if (alive) process.kill(-pid, 'SIGKILL');
  }, 5000));
}

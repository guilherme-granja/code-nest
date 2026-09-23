// Mata o cliente ssh local no meio de um turno e confere que o histórico completo aparece depois do settle.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { SdkRuntime } from '../src/runtime/sdk-runtime';
import { sshTransport } from '../src/runtime/ssh-transport';
import { encodeCwd, runSsh, shq } from '../src/ssh-util';

const target = process.env.SSH_TARGET;
if (!target) throw new Error('defina SSH_TARGET=user@host');
const cwd = '/tmp/ccui-smoke-ssh-drop';
await runSsh(target, `mkdir -p ${shq(cwd)}`);
const rt = new SdkRuntime(sshTransport({ target }));
const sessionId = randomUUID();
const live = await rt.open({ cwd, sessionId, model: 'haiku', effort: 'low', lean: true, routing: false, permissionMode: 'default' });
live.send('Responda direto no chat, sem usar nenhuma ferramenta: escreva um poema de 60 versos numerados sobre o mar.');

let deltas = 0, killed = false, sawExit = false;
for await (const ev of live.events) {
  if (ev.type === 'message.delta') deltas++;
  if (deltas >= 5 && !killed) {
    killed = true;
    execFileSync('pkill', ['-f', `session-id=${sessionId}`]); // derruba só o cliente ssh deste smoke
    console.log(`ssh local morto após ${deltas} deltas`);
  }
  if (ev.type === 'error') { sawExit = true; console.log('error:', ev.code, ev.message.slice(0, 120).replace(/\n/g, ' ')); }
}
console.log('stream terminou; erro de saída visto:', sawExit);

const t0 = Date.now();
await rt.settle(sessionId, cwd);
console.log(`settle em ${Math.round((Date.now() - t0) / 1000)}s`);
const h = await rt.history(sessionId, cwd);
const versos = (h.find((x) => x.role === 'assistant')?.text.match(/^\d+/gm) ?? []).length;
console.log(`histórico: ${h.length} itens; versos no texto final: ${versos} (esperado 60; deltas vistos ao vivo: ${deltas})`);

await runSsh(target, `rm -rf ${shq(cwd)} "$HOME/.claude/projects/${encodeCwd(cwd)}"`);
console.log('limpo');
process.exit(0);

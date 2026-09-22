// Smoke real do SshTransport. Uso: SSH_TARGET=user@host npx tsx server/scripts/smoke-ssh.ts
import { randomUUID } from 'node:crypto';
import { SdkRuntime } from '../src/runtime/sdk-runtime';
import { sshTransport } from '../src/runtime/ssh-transport';
import { checkConnection, encodeCwd, runSsh, shq } from '../src/ssh-util';

const target = process.env.SSH_TARGET;
if (!target) throw new Error('defina SSH_TARGET=user@host');
const cwd = '/tmp/ccui-smoke-ssh';
const line = (tag: string, v: unknown) => console.log(tag, typeof v === 'string' ? v : JSON.stringify(v));

line('check:', await checkConnection(target));
await runSsh(target, `mkdir -p ${shq(cwd)}`);
const t = sshTransport({ target });
line('isDirectory (existe / não existe):', [await t.isDirectory(cwd), await t.isDirectory('/nao/existe')]);

const rt = new SdkRuntime(t);
const sessionId = randomUUID();
line('sessões antes:', (await rt.listSessions(cwd)).length);

const run = async (text: string) => {
  const live = await rt.open({ cwd, sessionId, model: 'haiku', effort: 'low', lean: true, routing: false, maxBudgetUsd: 0.5, permissionMode: 'default' });
  live.send(text);
  for await (const ev of live.events) {
    if (ev.type === 'message.completed' || ev.type === 'turn.completed' || ev.type === 'error') line('  ev:', JSON.stringify(ev).slice(0, 150));
    if (ev.type === 'turn.completed') await live.close();
  }
};

await run('diga apenas: remoto ok');
line('histórico:', await rt.history(sessionId, cwd));
line('sessões depois:', await rt.listSessions(cwd));
line('existe:', String(await t.sessionExists(sessionId, cwd)));
await t.waitSessionIdle(sessionId, 20_000);
line('idle: ok', '');
await run('qual foi a minha primeira mensagem? responda em poucas palavras'); // valida --resume via ssh
line('histórico após resume:', (await rt.history(sessionId, cwd)).map((h) => `${h.role}: ${h.text.slice(0, 40)}`));

await runSsh(target, `rm -rf ${shq(cwd)} "$HOME/.claude/projects/${encodeCwd(cwd)}"`); // só artefatos deste smoke
line('limpo', '');
process.exit(0);

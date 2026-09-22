// Smoke real (haiku, low, lean): 2 turnos no mesmo processo; o 2º pede permissão de Write e é negado.
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { localTransport } from '../src/runtime/local-transport';
import { SdkRuntime } from '../src/runtime/sdk-runtime';

const rt = new SdkRuntime(localTransport);
const live = await rt.open({ cwd: tmpdir(), sessionId: randomUUID(), model: 'haiku', effort: 'low', lean: true, routing: false, maxBudgetUsd: 0.5, permissionMode: 'default' });
const prompts = ['diga apenas: um', 'crie o arquivo smoke.txt com o conteúdo abc usando a ferramenta Write'];
let turns = 0;
live.send(prompts[0]);
for await (const ev of live.events) {
  console.log(JSON.stringify(ev).slice(0, 220));
  if (ev.type === 'permission.requested') live.answerPermission(ev.reqId, false);
  if (ev.type === 'turn.completed') {
    turns++;
    if (turns < prompts.length) live.send(prompts[turns]);
    else await live.close();
  }
}
console.log('FIM');

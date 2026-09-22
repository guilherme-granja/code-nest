import assert from 'node:assert/strict';
import { blockedSlash, visibleCommands } from '../src/commands';
import { forbiddenModel } from '../src/runtime/sdk-runtime';

// bloqueio no envio
for (const t of ['/clear', '/CLEAR', '  /clear extra', '/reset', '/new', '/model opus', '/model', '/fast', '/advisor x', '/effort max', '/config model=opus'])
  assert.ok(blockedSlash(t), `deveria bloquear ${JSON.stringify(t)}`);
for (const t of ['/context', '/usage', '/compact', '/superpowers:brainstorming', '/caminho/de/arquivo', 'explique /model', 'olá', '/models', '/clearx'])
  assert.equal(blockedSlash(t), null, `não deveria bloquear ${JSON.stringify(t)}`);
assert.match(blockedSlash('/clear')!, /Nova sessão/);

// lista: some o proibido (por nome ou alias) e o só-de-terminal
const list = [
  { name: 'context', description: 'ctx', argumentHint: '', builtin: true },
  { name: 'clear', description: 'x', argumentHint: '', aliases: ['reset', 'new'], builtin: true },
  { name: 'model', description: 'x', argumentHint: '<m>', builtin: true },
  { name: 'stats', description: 'y', argumentHint: '', aliases: ['cost'], builtin: true },
  { name: 'wrapper', description: 'z', argumentHint: '', aliases: ['fast'], builtin: false }, // alias proibido some junto
  { name: 'doctor', description: 'd', argumentHint: '', builtin: true },
  { name: 'superpowers:brainstorming', description: 'b', argumentHint: '', builtin: false },
];
const names = visibleCommands(list).map((c) => c.name);
assert.deepEqual(names, ['context', 'stats', 'superpowers:brainstorming']);
assert.deepEqual(visibleCommands(list)[1].aliases, ['cost']);

// defesa de modelo em toda resposta
for (const m of ['claude-opus-5', 'claude-opus-4-8[1m]', 'claude-fable-5-1', 'OPUS']) assert.ok(forbiddenModel(m), m);
for (const m of ['claude-haiku-4-5-20251001', 'claude-sonnet-5', '<synthetic>', undefined]) assert.ok(!forbiddenModel(m), String(m));
console.log('commands OK');

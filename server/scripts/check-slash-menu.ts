import assert from 'node:assert/strict';
import { matchCommands } from '../../web/src/lib/commands';

const c = (name: string, description = '', aliases?: string[]) => ({ name, description, argumentHint: '', builtin: true, ...(aliases ? { aliases } : {}) });
const all = [c('context', 'Mostra uso de contexto'), c('compact', 'Compacta a conversa'), c('stats', 'Estatísticas', ['cost']), c('superpowers:brainstorming', 'Explora ideias'), c('code-review', 'Revisa código')];

assert.deepEqual(matchCommands(all, '').map((x) => x.name), ['code-review', 'compact', 'context', 'stats', 'superpowers:brainstorming']); // vazio: todos, ordem alfabética
assert.deepEqual(matchCommands(all, 'co').map((x) => x.name).slice(0, 3), ['code-review', 'compact', 'context']); // prefixo primeiro
assert.equal(matchCommands(all, 'cost')[0].name, 'stats');            // alias
assert.equal(matchCommands(all, 'brain')[0].name, 'superpowers:brainstorming'); // nome contém
assert.equal(matchCommands(all, 'revisa')[0].name, 'code-review');   // descrição
assert.equal(matchCommands(all, 'CONTEXT')[0].name, 'context');      // sem diferenciar caixa
assert.deepEqual(matchCommands(all, 'zzz'), []);
assert.equal(matchCommands(Array.from({ length: 100 }, (_, i) => c(`c${i}`)), '').length, 40); // limite
console.log('slash menu OK');

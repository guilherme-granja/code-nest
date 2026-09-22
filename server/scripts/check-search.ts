import assert from 'node:assert/strict';
import { matchRow, norm } from '../../web/src/lib/search';

assert.equal(norm('Depuração ÁÉÍ'), 'depuracao aei');
const r = { name: 'Corrigir erro Datavalid 422', tags: ['sisar', 'bug-fix'] };
assert.ok(matchRow(r, ''));
assert.ok(matchRow(r, 'datavalid'));
assert.ok(matchRow(r, 'CORRIGIR 422'));        // todos os termos, qualquer ordem
assert.ok(matchRow(r, 'sisar'));               // termo casa por tag
assert.ok(matchRow(r, '#bug'));                // #tag casa só tags
assert.ok(!matchRow(r, '#datavalid'));         // #tag não casa nome
assert.ok(!matchRow(r, 'datavalid inexistente'));
assert.ok(matchRow({ name: 'Depuração', tags: [] }, 'depuracao'));
console.log('search OK');

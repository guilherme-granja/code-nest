import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { cleanTags, sumUsage } from '../src/runtime/events';
import { lastCostState, parseHistory } from '../src/runtime/jsonl';
import { fmtTokens } from '../../web/src/lib/format';

// sumUsage: soma por modelo; thinking já está em output; custo cai no fallback se não vier por modelo
const t = sumUsage({ a: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 7, costUSD: 0.5 }, b: { inputTokens: 1, outputTokens: 2, costUSD: 0.25 } });
assert.deepEqual(t, { costUsd: 0.75, input: 11, output: 7, cacheCreation: 7, cacheRead: 100 });
assert.equal(sumUsage({}, 0.3).costUsd, 0.3);
assert.deepEqual(sumUsage(undefined), { costUsd: 0, input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });

// cost-state: pega a ÚLTIMA linha; ignora linha cortada no começo do trecho
const tail = ['pedaço cortado {"type":"user"', JSON.stringify({ type: 'cost-state', totalCostUSD: 1, modelUsage: { m: { inputTokens: 1, outputTokens: 1, costUSD: 1 } } }),
  '{"type":"assistant"}', JSON.stringify({ type: 'cost-state', totalCostUSD: 9, modelUsage: { m: { inputTokens: 3, outputTokens: 4, cacheReadInputTokens: 5, cacheCreationInputTokens: 6, costUSD: 9 } } }), '{"type":"user"}'].join('\n');
assert.deepEqual(lastCostState(tail), { costUsd: 9, input: 3, output: 4, cacheCreation: 6, cacheRead: 5 });
assert.equal(lastCostState('{"type":"user"}\n'), null);

// tags do terminal
assert.equal(cleanTags('<bash-input>ls -la</bash-input>'), '```bash\n$ ls -la\n```');
assert.equal(cleanTags('<bash-stdout>a\nb</bash-stdout><bash-stderr></bash-stderr>'), '```\na\nb\n```');
assert.equal(cleanTags('<command-name>/context</command-name><command-message>context</command-message><command-args></command-args>'), '/context');
assert.equal(cleanTags('<command-name>/x</command-name><command-args>a b</command-args>'), '/x a b');
assert.equal(cleanTags('<local-command-caveat>ignore</local-command-caveat>'), '');
assert.equal(cleanTags('texto normal com <tag> solta'), 'texto normal com <tag> solta');
const h = parseHistory([JSON.stringify({ type: 'user', message: { content: '<bash-input>pwd</bash-input>' } }), JSON.stringify({ type: 'user', message: { content: '<bash-stdout>/tmp</bash-stdout>' } })].join('\n'));
assert.deepEqual(h.map((x) => x.text), ['```bash\n$ pwd\n```', '```\n/tmp\n```']);

// formatação
assert.deepEqual([999, 1000, 12345, 424460, 4_200_000].map(fmtTokens), ['999', '1.0k', '12.3k', '424.5k', '4.20M']);

// caso real (somente leitura): sessão longa do usuário, se existir
const real = path.join(homedir(), '.claude/projects/-home-guilhermegranja-Soluti-sisar-new-CRMSoluti/c0fb2809-5625-4e40-9a77-9e19a2c66578.jsonl');
try { const r = lastCostState(readFileSync(real, 'utf8')); console.log('real:', JSON.stringify(r)); } catch { console.log('(sessão real não encontrada, pulando)'); }
console.log('usage OK');

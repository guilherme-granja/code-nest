import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { claudeExpr, encodeCwd, shq, validClaudePath, validTarget } from '../src/ssh-util';

// target: aceita user@host/host; rejeita injeção de opção e metacaracteres
for (const ok of ['guilhermegranja@192.168.15.43', 'host', 'a.b-c@d.e', 'my_host']) assert.ok(validTarget(ok), `deveria aceitar ${ok}`);
for (const bad of ['-oProxyCommand=x', '-o', 'a b', 'a;b', '', "u@h'x", 'u@h;rm -rf /', 'u@@h', '@h', 'u@', 'a\nb', 'a$(x)']) assert.ok(!validTarget(bad), `deveria rejeitar ${JSON.stringify(bad)}`);

// claudePath
for (const ok of ['$HOME/.local/bin/claude', '~/bin/claude', '/opt/claude/bin/claude']) assert.ok(validClaudePath(ok), ok);
for (const bad of ['claude', '$HOME/../x', '/a b/c', '/x"; rm -rf /; "', '$(x)', '/x$y', '/x`y`', '']) assert.ok(!validClaudePath(bad), `deveria rejeitar ${JSON.stringify(bad)}`);
assert.equal(claudeExpr('$HOME/.local/bin/claude'), '"$HOME/.local/bin/claude"');
assert.equal(claudeExpr('~/bin/claude'), '"$HOME/bin/claude"');
assert.equal(claudeExpr('/opt/c'), '"/opt/c"');

// shq: ida-e-volta por um sh real com entradas hostis
for (const s of ["a'b", '$(id)', '; rm -rf /', 'é ü', 'line1\nline2', '`x`', '"q"', '\\', "''", '']) {
  assert.equal(execFileSync('sh', ['-c', `printf %s ${shq(s)}`]).toString(), s, `shq falhou para ${JSON.stringify(s)}`);
}

// codificação de cwd (regra confirmada em host real)
assert.equal(encodeCwd('/tmp/ccui h4.é_x'), '-tmp-ccui-h4---x');
assert.equal(encodeCwd('/home/u/proj-1'), '-home-u-proj-1');

console.log('ssh helpers OK');

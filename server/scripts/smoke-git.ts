// Smoke do status Git local e remoto em repositórios temporários (criados e removidos aqui).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseGitStatus } from '../src/git';
import { localTransport } from '../src/runtime/local-transport';
import { sshTransport } from '../src/runtime/ssh-transport';
import { runSsh, shq } from '../src/ssh-util';

// parser: casos fixos
assert.deepEqual(parseGitStatus('# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f.txt\n2 R. N... 100644 100644 100644 a b R100 n.txt\to.txt\nu UU N... 1 1 1 1 a b c x.txt\n? new.txt\n? new2.txt\n'),
  { branch: 'main', ahead: 2, behind: 1, changed: 3, untracked: 2 });
assert.equal(parseGitStatus('# branch.head (detached)\n')?.branch, null);
assert.equal(parseGitStatus(''), null);
console.log('parser OK');

// local
const dir = mkdtempSync(path.join(tmpdir(), 'ccui-git-'));
const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
g('init', '-q', '-b', 'main'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't');
writeFileSync(path.join(dir, 'a.txt'), '1'); g('add', '.'); g('commit', '-qm', 'i');
writeFileSync(path.join(dir, 'a.txt'), '2'); writeFileSync(path.join(dir, 'novo.txt'), 'x');
console.log('local:', JSON.stringify(parseGitStatus((await localTransport.git(dir))!)));
console.log('local (não-repo):', await localTransport.git(tmpdir()));
rmSync(dir, { recursive: true, force: true });

// remoto
const target = process.env.SSH_TARGET;
if (target) {
  const rd = '/tmp/ccui-git-smoke';
  await runSsh(target, `rm -rf ${shq(rd)}; mkdir -p ${shq(rd)} && cd ${shq(rd)} && git init -q -b main && git config user.email a@b.c && git config user.name t && echo 1 > a.txt && git add . && git commit -qm i && echo 2 > a.txt && echo x > novo.txt`, { timeoutMs: 30_000 });
  const t = sshTransport({ target });
  console.log('remoto:', JSON.stringify(parseGitStatus((await t.git(rd)) ?? '')));
  console.log('remoto (não-repo /):', await t.git('/'));
  await runSsh(target, `rm -rf ${shq(rd)}`);
  console.log('remoto limpo');
}
process.exit(0);

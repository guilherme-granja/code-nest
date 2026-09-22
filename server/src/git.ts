import type { GitInfo } from '@ccui/shared';

// `git status --porcelain=v2 --branch` -> resumo. Linhas: "# branch.head X", "# branch.ab +A -B", "1 …"/"2 …" (alterado), "u …" (conflito), "? …" (novo).
export function parseGitStatus(out: string): GitInfo | null {
  const info: GitInfo = { branch: null, ahead: 0, behind: 0, changed: 0, untracked: 0 };
  let seen = false;
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) { seen = true; const h = line.slice(14).trim(); info.branch = h === '(detached)' ? null : h; }
    else if (line.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(line); if (m) { info.ahead = Number(m[1]); info.behind = Number(m[2]); } }
    else if (line[0] === '1' || line[0] === '2' || line[0] === 'u') info.changed++;
    else if (line[0] === '?') info.untracked++;
  }
  return seen ? info : null;
}

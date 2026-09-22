import type { SlashCommandInfo } from '@ccui/shared';
import { norm } from './search';

// Ordena por relevância: prefixo do nome, prefixo de alias, nome contém, descrição contém.
export function matchCommands(commands: SlashCommandInfo[], query: string): SlashCommandInfo[] {
  const q = norm(query);
  const rank = (c: SlashCommandInfo) => {
    const n = norm(c.name);
    if (n.startsWith(q)) return 0;
    if (c.aliases?.some((a) => norm(a).startsWith(q))) return 1;
    if (n.includes(q)) return 2;
    if (norm(c.description).includes(q)) return 3;
    return 9;
  };
  return commands
    .map((c) => [c, rank(c)] as const)
    .filter(([, r]) => r < 9)
    .sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name))
    .slice(0, 40)
    .map(([c]) => c);
}

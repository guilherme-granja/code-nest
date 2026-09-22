import type { SessionRow } from '@ccui/shared';

// sem acentos e minúsculas: "Depuração" casa com "depuracao"
export const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// termos separados por espaço, todos precisam casar (nome ou tag); "#tag" casa só tags
export function matchRow(r: Pick<SessionRow, 'name' | 'tags'>, query: string): boolean {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  const name = norm(r.name);
  const tags = r.tags.map(norm);
  return terms.every((t) => (t.startsWith('#') ? tags.some((g) => g.includes(t.slice(1))) : name.includes(t) || tags.some((g) => g.includes(t))));
}

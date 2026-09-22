import type { HistoryItem, ModelUsage, UsageTotals } from '@ccui/shared';
import { blockText, cleanTags, rawModelUsage, sumUsage } from './events';

interface Entry { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: { content?: unknown } }

// jsonl do Claude Code -> histórico de texto (mesmo formato que o getSessionMessages local entrega)
export function parseHistory(jsonl: string): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line) continue;
    let e: Entry;
    try { e = JSON.parse(line); } catch { continue; } // linha cortada por head/tail
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain || e.isMeta) continue;
    const text = cleanTags(blockText(e.message?.content));
    if (text) out.push({ role: e.type, text });
  }
  return out;
}

export const firstPrompt = (jsonl: string): string | undefined => parseHistory(jsonl).find((h) => h.role === 'user')?.text.slice(0, 80);

// Última linha `cost-state` do jsonl: acumulado da sessão (custo e tokens, total e por modelo), inclusive de execuções anteriores.
// `modelUsage` semeia o snapshot de hub.ts pra calcular o delta do 1º turno depois de reabrir/reiniciar (sem isso, o 1º
// resumo de turno mostraria o acumulado da sessão inteira em vez do custo só daquela interação).
export function lastCostState(jsonlTail: string): { totals: UsageTotals; modelUsage: Record<string, ModelUsage> } | null {
  const lines = jsonlTail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"cost-state"')) continue;
    try {
      const e = JSON.parse(lines[i]) as { type?: string; totalCostUSD?: number; modelUsage?: Parameters<typeof sumUsage>[0] };
      if (e.type === 'cost-state') return { totals: sumUsage(e.modelUsage, e.totalCostUSD ?? 0), modelUsage: rawModelUsage(e.modelUsage) };
    } catch { /* linha cortada no começo do trecho lido */ }
  }
  return null;
}

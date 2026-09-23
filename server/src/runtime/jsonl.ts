import { ZERO_TOTALS, type HistoryItem, type ModelUsage, type UsageTotals } from '@ccui/shared';
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

export interface CostCheckpoint { ts: number; totals: UsageTotals; modelUsage: Record<string, ModelUsage> }

// cada cost-state associado ao timestamp da última mensagem (user/assistant) vista antes dele no arquivo
export function costCheckpoints(jsonlTail: string): CostCheckpoint[] {
  const out: CostCheckpoint[] = [];
  let lastTs = 0;
  for (const line of jsonlTail.split('\n')) {
    if (!line) continue;
    let e: { type?: string; timestamp?: string; totalCostUSD?: number; modelUsage?: Parameters<typeof sumUsage>[0] };
    try { e = JSON.parse(line); } catch { continue; } // linha cortada pela leitura em janela
    if ((e.type === 'user' || e.type === 'assistant') && e.timestamp) {
      const t = Date.parse(e.timestamp);
      if (Number.isFinite(t)) lastTs = t;
    } else if (e.type === 'cost-state') {
      out.push({ ts: lastTs, totals: sumUsage(e.modelUsage, e.totalCostUSD ?? 0), modelUsage: rawModelUsage(e.modelUsage) });
    }
  }
  return out;
}

// delta entre o checkpoint mais recente e o último anterior a todayStartMs; clamp >=0 (mesmo padrão de hub.ts diffModelUsage)
export function todayDelta(checkpoints: CostCheckpoint[], todayStartMs: number): { totals: UsageTotals; modelUsage: Record<string, ModelUsage> } {
  if (checkpoints.length === 0) return { totals: ZERO_TOTALS, modelUsage: {} };
  const latest = checkpoints[checkpoints.length - 1];
  const baseline = [...checkpoints].reverse().find((c) => c.ts < todayStartMs);
  if (!baseline) return { totals: latest.totals, modelUsage: latest.modelUsage }; // sessão inteira é de hoje: tudo conta
  const totals: UsageTotals = {
    costUsd: Math.max(0, latest.totals.costUsd - baseline.totals.costUsd),
    input: Math.max(0, latest.totals.input - baseline.totals.input),
    output: Math.max(0, latest.totals.output - baseline.totals.output),
    cacheCreation: Math.max(0, latest.totals.cacheCreation - baseline.totals.cacheCreation),
    cacheRead: Math.max(0, latest.totals.cacheRead - baseline.totals.cacheRead),
  };
  const modelUsage: Record<string, ModelUsage> = {};
  for (const [model, cur] of Object.entries(latest.modelUsage)) {
    const prev = baseline.modelUsage[model];
    modelUsage[model] = {
      input: Math.max(0, cur.input - (prev?.input ?? 0)),
      output: Math.max(0, cur.output - (prev?.output ?? 0)),
      cacheCreation: Math.max(0, cur.cacheCreation - (prev?.cacheCreation ?? 0)),
      cacheRead: Math.max(0, cur.cacheRead - (prev?.cacheRead ?? 0)),
      costUsd: Math.max(0, cur.costUsd - (prev?.costUsd ?? 0)),
    };
  }
  return { totals, modelUsage };
}

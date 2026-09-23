import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import type { DirEntry, Effort, EventBody, HistoryItem, Model, ModelUsage, ShellResult, SlashCommandInfo, UsageTotals } from '@ccui/shared';

export interface SessionInfo { sessionId: string; summary: string; customTitle?: string; firstPrompt?: string; lastModified: number }

// Tudo o que difere entre rodar o Claude local ou remoto.
export interface Transport {
  spawn(o: SpawnOptions, onStderr: (chunk: string) => void): SpawnedProcess;
  isDirectory(path: string): Promise<boolean>;
  /** lista o conteúdo de um diretório; path null = resolve e lista o $HOME da conexão. null de volta = não existe/sem permissão/falha */
  listDir(path: string | null): Promise<{ path: string; entries: DirEntry[] } | null>;
  /** lê um arquivo inteiro em base64; null se não existe/não é arquivo/sem permissão/maior que maxBytes */
  readFile(path: string, maxBytes: number): Promise<string | null>;
  listSessions(cwd: string): Promise<SessionInfo[]>;
  history(sessionId: string, cwd: string): Promise<HistoryItem[]>;
  sessionExists(sessionId: string, cwd: string): Promise<boolean>;
  /** custo/tokens acumulados da sessão (último `cost-state` do jsonl), ou null se ainda não há */
  usage(sessionId: string, cwd: string): Promise<{ totals: UsageTotals; modelUsage: Record<string, ModelUsage> } | null>;
  /** modo shell (`!cmd`): executa o comando DIGITADO PELO USUÁRIO no diretório do projeto (local ou remoto), com timeout e limite de saída */
  shell(cwd: string, command: string): Promise<ShellResult>;
  /** saída de `git status --porcelain=v2 --branch` do diretório, ou null (não é repositório / sem resposta) */
  git(cwd: string): Promise<string | null>;
  /** espera não haver `claude` ativo para a sessão (remoto: turno terminando após queda de SSH). Lança no timeout. */
  waitSessionIdle(sessionId: string, timeoutMs: number): Promise<void>;
}
export interface OpenOptions {
  cwd: string; sessionId: string; model: Model; effort: Effort; lean: boolean; routing: boolean; maxBudgetUsd: number; permissionMode: 'default' | 'plan' | 'bypassPermissions';
}
export interface LiveSession {
  send(text: string): void;
  interrupt(): Promise<void>;
  answerPermission(reqId: string, allow: boolean, updatedInput?: Record<string, unknown>): void;
  setModel(model: Model): Promise<void>;
  close(): Promise<void>;
  events: AsyncIterable<EventBody>;
}
export interface ClaudeRuntime {
  listSessions(cwd: string): Promise<SessionInfo[]>;
  history(sessionId: string, cwd: string): Promise<HistoryItem[]>;
  open(o: OpenOptions): Promise<LiveSession>;
  usage(sessionId: string, cwd: string): Promise<{ totals: UsageTotals; modelUsage: Record<string, ModelUsage> } | null>;
  shell(cwd: string, command: string): Promise<ShellResult>;
  /** comandos `/` disponíveis para o projeto (skills, plugins e nativos permitidos); não envia nada ao modelo */
  commands(cwd: string, lean: boolean): Promise<SlashCommandInfo[]>;
  /** decide Haiku ou Sonnet pra uma mensagem (heurística + fallback Haiku descartável) */
  classify(cwd: string, text: string): Promise<Model>;
  /** após uma queda: espera o claude da sessão terminar (não lança) */
  settle(sessionId: string, cwd: string): Promise<void>;
}

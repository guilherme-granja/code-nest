import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { SlashCommandInfo } from '@ccui/shared';

// Comandos que mudariam modelo/effort/configuração/conversa por dentro da sessão e furariam as regras da UI
// (allowlist de modelos, aprovação de permissões, histórico alinhado ao jsonl). `reset`/`new` são aliases do /clear.
const CLEAR = 'a UI mantém o histórico alinhado ao jsonl: crie uma Nova sessão (Alt+N)';
const MODEL = 'o modelo é definido ao criar a sessão (apenas haiku/sonnet)';
const BLOCKED: Record<string, string> = {
  clear: CLEAR, reset: CLEAR, new: CLEAR,
  model: MODEL,
  fast: 'o modo rápido usa modelos fora da lista permitida (apenas haiku/sonnet)',
  advisor: 'o advisor usa outro modelo, fora da lista permitida (apenas haiku/sonnet)',
  effort: 'o effort é definido ao criar a sessão',
  config: 'as configurações do Claude Code não são alteradas por aqui',
};
// só fazem sentido no terminal (o `init` do CLI lista doctor, color e reload-plugins; os demais são precaução)
const TERMINAL_ONLY = new Set(['doctor', 'color', 'reload-plugins', 'exit', 'quit', 'statusline']);

/** motivo do bloqueio se o texto começa com um comando proibido; senão null */
export function blockedSlash(text: string): string | null {
  const m = /^\s*\/(\S+)/.exec(text);
  const why = m ? BLOCKED[m[1].toLowerCase()] : undefined;
  return why ? `O comando /${m![1]} é bloqueado nesta UI: ${why}.` : null;
}

export function visibleCommands(list: SlashCommand[]): SlashCommandInfo[] {
  return list
    .filter((c) => ![c.name, ...(c.aliases ?? [])].some((n) => BLOCKED[n.toLowerCase()] || TERMINAL_ONLY.has(n.toLowerCase())))
    .map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint, ...(c.aliases?.length ? { aliases: c.aliases } : {}), builtin: !!c.builtin }));
}

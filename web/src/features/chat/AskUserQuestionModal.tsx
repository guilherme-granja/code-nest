import { useState } from 'react';
import type { PendingPermission } from '@ccui/shared';

interface AUQOption { label: string; description: string; preview?: string }
interface AUQQuestion { question: string; header: string; options: AUQOption[]; multiSelect: boolean }
interface AUQInput { questions: AUQQuestion[] }

// AskUserQuestion (tool nativa do Claude Code) não tem canal próprio pra resposta: a resposta volta pelo
// mesmo canUseTool de permissão, embutida em `updatedInput` (ver sdk-runtime.ts). Este modal monta esse payload.
export function isAskUserQuestion(p: PendingPermission): boolean {
  return p.toolName === 'AskUserQuestion' && !!p.input && typeof p.input === 'object' && Array.isArray((p.input as { questions?: unknown }).questions);
}

export function AskUserQuestionModal({ p, onAnswer }: { p: PendingPermission; onAnswer: (allow: boolean, updatedInput?: Record<string, unknown>) => void }) {
  const input = p.input as AUQInput;
  const [selected, setSelected] = useState<string[][]>(() => input.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => input.questions.map(() => ''));

  const toggle = (qi: number, label: string, multi: boolean) => {
    setSelected((s) => {
      const next = s.slice();
      const cur = next[qi];
      next[qi] = multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : (cur[0] === label ? [] : [label]);
      return next;
    });
    setCustom((c) => { const n = c.slice(); n[qi] = ''; return n; }); // escolher opção limpa o texto customizado
  };

  const setCustomAt = (qi: number, v: string) => {
    setCustom((c) => { const n = c.slice(); n[qi] = v; return n; });
    if (v) setSelected((s) => { const n = s.slice(); n[qi] = []; return n; });
  };

  const answered = (qi: number) => selected[qi].length > 0 || custom[qi].trim() !== '';
  const canSubmit = input.questions.every((_, qi) => answered(qi));

  const submit = () => {
    const answers: Record<string, string> = {};
    input.questions.forEach((q, qi) => { answers[q.question] = custom[qi].trim() || selected[qi].join(', '); });
    onAnswer(true, { ...(p.input as Record<string, unknown>), answers });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl">
        <div className="mb-3 text-sm text-zinc-400">Claude tem uma pergunta antes de continuar</div>
        <div className="space-y-5">
          {input.questions.map((q, qi) => (
            <div key={qi}>
              <div className="mb-1 inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{q.header}</div>
              <div className="mb-2 text-sm font-medium text-zinc-100">{q.question}</div>
              <div className="space-y-1.5">
                {q.options.map((o) => {
                  const on = selected[qi].includes(o.label);
                  return (
                    <button
                      key={o.label}
                      onClick={() => toggle(qi, o.label, q.multiSelect)}
                      className={`block w-full rounded border px-3 py-2 text-left text-sm transition-colors duration-150 ${on ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/50'}`}
                    >
                      <div className="font-medium text-zinc-100">{o.label}</div>
                      <div className="text-xs text-zinc-500">{o.description}</div>
                      {on && o.preview && <pre className="mt-1.5 whitespace-pre-wrap rounded bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400">{o.preview}</pre>}
                    </button>
                  );
                })}
              </div>
              <input
                className="mt-1.5 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none transition-colors duration-150 focus:border-zinc-600"
                placeholder="Ou escreva sua própria resposta…"
                value={custom[qi]}
                onChange={(e) => setCustomAt(qi, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200" onClick={() => onAnswer(false)}>Cancelar</button>
          <button className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 disabled:opacity-40" disabled={!canSubmit} onClick={submit}>Responder</button>
        </div>
      </div>
    </div>
  );
}

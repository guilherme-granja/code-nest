import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

// react-markdown não renderiza HTML cru e só aceita URLs seguras (http/https/mailto) por padrão.
// ponytail: re-renderiza a cada delta durante o streaming; se pesar em respostas enormes, throttle do texto.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={{ a: ({ node: _node, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

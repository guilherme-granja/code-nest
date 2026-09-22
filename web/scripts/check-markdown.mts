import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/features/chat/Markdown';

const text = [
  '# Titulo', '', '<script>alert(1)</script>', '', '<img src=x onerror=alert(1)>', '',
  '[perigoso](javascript:alert(1))', '', '[ok](https://example.com)', '',
  '```ts', 'const a: number = 1; // c', '```', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '**negrito** e `codigo`',
].join('\n');
const html = renderToStaticMarkup(createElement(Markdown, { text }));
const has = (re: RegExp) => re.test(html);
console.log('elemento <script> cru:      ', has(/<script/i) ? 'SIM (FALHA)' : 'não');
console.log('elemento <img> cru:         ', has(/<img/i) ? 'SIM (FALHA)' : 'não');
console.log('atributo onerror:           ', has(/<[^>]*\sonerror=/i) ? 'SIM (FALHA)' : 'não');
console.log('href javascript::           ', has(/href="javascript:/i) ? 'SIM (FALHA)' : 'não');
console.log('link https com noopener:    ', has(/href="https:\/\/example\.com"[^>]*target="_blank"[^>]*rel="noopener noreferrer"|target="_blank"[^>]*rel="noopener noreferrer"[^>]*href="https:\/\/example\.com"/) ? 'sim' : 'NÃO');
console.log('realce (hljs) no bloco ts:  ', has(/class="hljs-keyword"/) ? 'sim' : 'NÃO');
console.log('tabela renderizada:         ', has(/<table>/) ? 'sim' : 'NÃO');
console.log('negrito/código inline:      ', has(/<strong>negrito<\/strong>/) && has(/<code>codigo<\/code>/) ? 'sim' : 'NÃO');

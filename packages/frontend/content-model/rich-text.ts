/** Small builders for authoring RichTextDocument content in code (seed content, fixtures). */
import type { RichTextDocument, RichTextNode } from '../src/types.ts';

type Inline = string | RichTextNode;
const inline = (parts: Inline[]): RichTextNode[] =>
  parts.map((x) => (typeof x === 'string' ? { nodeType: 'text', value: x, marks: [] } : x));

export const doc = (...content: RichTextNode[]): RichTextDocument => ({
  nodeType: 'document',
  content,
});
export const p = (...parts: Inline[]): RichTextNode => ({
  nodeType: 'paragraph',
  content: inline(parts),
});
export const h2 = (text: string): RichTextNode => ({
  nodeType: 'heading-2',
  content: inline([text]),
});
export const h3 = (text: string): RichTextNode => ({
  nodeType: 'heading-3',
  content: inline([text]),
});
export const b = (value: string): RichTextNode => ({
  nodeType: 'text',
  value,
  marks: [{ type: 'bold' }],
});
export const code = (value: string): RichTextNode => ({
  nodeType: 'text',
  value,
  marks: [{ type: 'code' }],
});
export const a = (text: string | RichTextNode, uri: string): RichTextNode => ({
  nodeType: 'hyperlink',
  data: { uri },
  content: inline([text]),
});
export const ul = (...items: Inline[][]): RichTextNode => ({
  nodeType: 'unordered-list',
  content: items.map((parts) => ({ nodeType: 'list-item', content: [p(...parts)] })),
});
export const pre = (text: string): RichTextNode => ({
  nodeType: 'code-block',
  content: inline([text]),
});
/** A paragraph holding one bold link: the runtime renders it as a primary button. */
export const button = (text: string, uri: string): RichTextNode => p(a(b(text), uri));

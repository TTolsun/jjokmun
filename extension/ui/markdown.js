import MarkdownIt from '../vendor/markdown-it-15.0.3.mjs';
import { memoFormat } from '../documents.js';

export const markdown = MarkdownIt({ html: false });

// Run after standard ATX headings and only at Markdown block boundaries.
markdown.block.ruler.after('heading', 'compact_heading', (state, line, endLine, silent) => {
  if (state.sCount[line] - state.blkIndent >= 4) return false;
  const start = state.bMarks[line] + state.tShift[line];
  if (state.src[start] !== '#') return false;
  const source = state.src.slice(start, state.eMarks[line]);
  const match = /^(#{1,6})(?=[^#\s])/.exec(source);
  if (!match) return false;
  if (silent) return true;

  const marker = match[1];
  const tag = 'h' + marker.length;
  const open = state.push('heading_open', tag, 1);
  open.markup = marker;
  open.map = [line, line + 1];
  const inline = state.push('inline', '', 0);
  inline.content = source.slice(marker.length).replace(/[ \t]+#+[ \t]*$/, '').trim();
  inline.map = open.map;
  inline.children = [];
  state.push('heading_close', tag, -1).markup = marker;
  state.line = line + 1;
  return true;
}, { alt: ['paragraph', 'reference', 'blockquote'] });

export function markdownTitle(memo) {
  if (!/^ {0,3}#/.test(memo.text) || memoFormat(memo) !== 'markdown') return;
  const end = memo.text.search(/[\r\n]/);
  const line = end < 0 ? memo.text : memo.text.slice(0, end);
  const [open, inline] = markdown.parse(line, {});
  if (open?.type === 'heading_open') return markdown.renderer.renderInlineAsText(inline.children);
}

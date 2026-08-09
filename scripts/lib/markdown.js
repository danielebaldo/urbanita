/* ==========================================================================
   Urbanita — a deliberately small Markdown -> HTML converter

   Covers exactly what the journal posts use: paragraphs, ## / ### headings,
   bullet lists, **bold**, *italic*, `code`, [text](url) links, and " -- "
   as an em dash. Not a general-purpose Markdown engine — if a post needs
   more than this, write that bit of HTML by hand in the output file.
   ========================================================================== */

import { escapeHtml } from './post-page.js';

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
    `<a href="${href}" rel="noopener">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/ -- /g, ' — ');   // " -- " -> " — "
  return out;
}

export function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) blocks.push(`<p>\n      ${inline(para.join(' '))}\n    </p>`);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.map(item => `      <li>${inline(item)}</li>`).join('\n');
      blocks.push(`<ul>\n${items}\n    </ul>`);
    }
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') { flushPara(); flushList(); continue; }

    const h2 = /^##\s+(.*)/.exec(line);
    const h3 = /^###\s+(.*)/.exec(line);
    const li = /^[-*]\s+(.*)/.exec(line);

    if (h2) { flushPara(); flushList(); blocks.push(`<h2>${inline(h2[1])}</h2>`); }
    else if (h3) { flushPara(); flushList(); blocks.push(`<h3>${inline(h3[1])}</h3>`); }
    else if (li) { flushPara(); (list ??= []).push(li[1]); }
    else { flushList(); para.push(line); }
  }
  flushPara();
  flushList();

  return blocks.join('\n\n    ');
}

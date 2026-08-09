/* ==========================================================================
   Urbanita — start a Markdown draft

   Usage:
     node scripts/new-draft.js "Post Title"

   Creates drafts/<slug>.md with a frontmatter header — open it in whatever
   editor you like to actually write the post (VS Code, iA Writer, Obsidian,
   TextEdit in plain-text mode, anything with Markdown support). When it's
   ready, run:
     node scripts/publish-post.js drafts/<slug>.md
   ========================================================================== */

import { writeFile, mkdir, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './lib/post-page.js';

const ROOT        = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DRAFTS_DIR  = path.join(ROOT, 'drafts');

async function fileExists(file) {
  return access(file, FS.F_OK).then(() => true, () => false);
}

async function main() {
  const title = process.argv[2];
  if (!title) {
    console.error('Usage: node scripts/new-draft.js "Post Title"');
    process.exit(1);
  }

  const slug = slugify(title);
  if (!slug) {
    console.error('Could not derive a filename slug from that title.');
    process.exit(1);
  }

  await mkdir(DRAFTS_DIR, { recursive: true });
  const draftFile = path.join(DRAFTS_DIR, `${slug}.md`);
  if (await fileExists(draftFile)) {
    console.error(`drafts/${slug}.md already exists — open it directly, or pick a different title.`);
    process.exit(1);
  }

  const draft = `---
title: ${title}
excerpt: TODO: one-line excerpt for the journal index and social previews.
---

Write the post here, in Markdown:

## A subheading, if you want one

**bold**, *italic*, \`code\`, [a link](https://example.com), and " -- " for
an em dash all work. Plain paragraphs and "- " bullet lists work too.
Blank lines separate paragraphs.
`;

  await writeFile(draftFile, draft);
  console.log(`Created drafts/${slug}.md`);
  console.log(`Next: write the post, then run:`);
  console.log(`  node scripts/publish-post.js drafts/${slug}.md`);
}

main();

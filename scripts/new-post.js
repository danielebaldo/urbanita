/* ==========================================================================
   Urbanita — quick empty post scaffold

   Usage:
     node scripts/new-post.js "Post Title" ["One-line excerpt"]

   Creates blog/<slug>.html with a TODO paragraph you fill in by hand, and
   adds it to the top of blog/index.html's post list. If you'd rather write
   the post itself in Markdown, use new-draft.js + publish-post.js instead.
   ========================================================================== */

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify, formatDate, renderPostPage, insertIndexEntry } from './lib/post-page.js';

const ROOT       = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BLOG_DIR   = path.join(ROOT, 'blog');
const INDEX_FILE = path.join(BLOG_DIR, 'index.html');

async function fileExists(file) {
  return access(file, FS.F_OK).then(() => true, () => false);
}

async function main() {
  const [title, excerptArg] = process.argv.slice(2);
  if (!title) {
    console.error('Usage: node scripts/new-post.js "Post Title" ["One-line excerpt"]');
    process.exit(1);
  }

  const excerpt = excerptArg || 'TODO: one-line excerpt for the journal index and social previews.';
  const slug = slugify(title);
  if (!slug) {
    console.error('Could not derive a filename slug from that title.');
    process.exit(1);
  }

  const postFile = path.join(BLOG_DIR, `${slug}.html`);
  if (await fileExists(postFile)) {
    console.error(`blog/${slug}.html already exists — pick a different title, or edit it directly.`);
    process.exit(1);
  }

  const { display, iso } = formatDate(new Date());
  const bodyHtml = `<p>\n      TODO: write the post. Delete this paragraph.\n    </p>`;

  await writeFile(postFile, renderPostPage({ title, excerpt, iso, display, bodyHtml }));

  const indexHtml = await readFile(INDEX_FILE, 'utf8');
  const updatedIndex = insertIndexEntry(indexHtml, { title, excerpt, slug, iso, display });
  if (!updatedIndex) {
    console.error('Could not find <ul class="post-list"> in blog/index.html — add the entry there manually.');
    process.exit(1);
  }
  await writeFile(INDEX_FILE, updatedIndex);

  console.log(`Created blog/${slug}.html`);
  console.log(`Added it to the top of blog/index.html's post list.`);
  console.log(`Next: open blog/${slug}.html, replace the TODO paragraph, then commit + push.`);
}

main();

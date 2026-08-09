/* ==========================================================================
   Urbanita — publish a Markdown draft as a blog post

   Usage:
     node scripts/publish-post.js drafts/<slug>.md

   Reads the draft's frontmatter (title, excerpt) and Markdown body,
   converts the body to HTML, writes blog/<slug>.html from the site
   template, and adds it to the top of blog/index.html's post list.
   Doesn't touch the live site by itself — commit + push as usual.
   ========================================================================== */

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify, formatDate, renderPostPage, insertIndexEntry } from './lib/post-page.js';
import { markdownToHtml } from './lib/markdown.js';

const ROOT       = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BLOG_DIR   = path.join(ROOT, 'blog');
const INDEX_FILE = path.join(BLOG_DIR, 'index.html');

async function fileExists(file) {
  return access(file, FS.F_OK).then(() => true, () => false);
}

/** Minimal `key: value` frontmatter — no list/nested support, none needed here. */
function parseFrontmatter(raw) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };
  const data = {};
  for (const line of match[1].split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { data, body: raw.slice(match[0].length) };
}

async function main() {
  const draftPath = process.argv[2];
  if (!draftPath) {
    console.error('Usage: node scripts/publish-post.js drafts/<slug>.md');
    process.exit(1);
  }

  const draftFile = path.resolve(ROOT, draftPath);
  if (!(await fileExists(draftFile))) {
    console.error(`No such file: ${draftPath}`);
    process.exit(1);
  }

  const raw = await readFile(draftFile, 'utf8');
  const { data, body } = parseFrontmatter(raw);

  const title = data.title;
  if (!title) {
    console.error('Draft is missing a "title:" line in its frontmatter.');
    process.exit(1);
  }
  const excerpt = data.excerpt || 'TODO: one-line excerpt for the journal index and social previews.';

  const slug = slugify(title);
  const postFile = path.join(BLOG_DIR, `${slug}.html`);
  if (await fileExists(postFile)) {
    console.error(`blog/${slug}.html already exists. Edit it directly, or rename the draft's title to publish as a new post.`);
    process.exit(1);
  }

  const { display, iso } = formatDate(new Date());
  const bodyHtml = markdownToHtml(body);

  await writeFile(postFile, renderPostPage({ title, excerpt, iso, display, bodyHtml }));

  const indexHtml = await readFile(INDEX_FILE, 'utf8');
  const updatedIndex = insertIndexEntry(indexHtml, { title, excerpt, slug, iso, display });
  if (!updatedIndex) {
    console.error('Could not find <ul class="post-list"> in blog/index.html — add the entry there manually.');
    process.exit(1);
  }
  await writeFile(INDEX_FILE, updatedIndex);

  console.log(`Published blog/${slug}.html`);
  console.log(`Added it to the top of blog/index.html's post list.`);
  console.log(`Next: open blog/${slug}.html in a browser to check it, then commit + push.`);
}

main();

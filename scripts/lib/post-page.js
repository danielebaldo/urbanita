/* ==========================================================================
   Urbanita — shared helpers for the blog scripts
   Used by both new-post.js (empty HTML scaffold) and publish-post.js
   (Markdown draft -> HTML post). Keeps the page template in one place.
   ========================================================================== */

export function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatDate(date) {
  const display = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  }).format(date);
  const iso = date.toISOString().slice(0, 10);
  return { display, iso };
}

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The full post page, wrapping whatever HTML `bodyHtml` already is. */
export function renderPostPage({ title, excerpt, iso, display, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<script>
(function () {
  try {
    var saved = localStorage.getItem('urbanita-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) { /* storage unavailable */ }
})();
</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>${escapeHtml(title)} — Urbanìta</title>
<meta name="description" content="${escapeHtml(excerpt)}">

<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(excerpt)}">
<meta property="og:type" content="article">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Work+Sans:ital,wght@0,300..600;1,300..600&display=swap">

<link rel="stylesheet" href="../css/style.css">
</head>
<body>

<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header">
  <nav class="site-nav" aria-label="Main">
    <a class="wordmark" href="../">Urbanìta</a>
    <ul>
      <li><a href="../">Cities</a></li>
      <li><a href="../about.html">About</a></li>
      <li><a href="./" aria-current="page">Journal</a></li>
    </ul>
  </nav>
</header>

<main id="main">
  <article class="prose">
    <h1>${escapeHtml(title)}</h1>
    <p class="byline"><time datetime="${iso}">${display}</time></p>

    ${bodyHtml}
  </article>
</main>

<footer class="site-footer">
  <p>
    City summaries from <a href="https://en.wikipedia.org" rel="noopener">Wikipedia</a>,
    available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener license">CC BY-SA 4.0</a>.
  </p>
  <p class="colophon">Urbanìta &middot; set in Young Serif &amp; Work Sans &middot; <a href="../attribution.html">Attribution</a></p>
  <button type="button" id="theme-toggle" class="theme-toggle" aria-pressed="false"></button>
</footer>

<script type="module" src="../js/theme.js"></script>
</body>
</html>
`;
}

/** The <li> for one post, as it appears in blog/index.html's post list. */
function indexEntry({ title, excerpt, slug, iso, display }) {
  return `
      <li>
        <time datetime="${iso}">${display}</time>
        <a href="${slug}.html">${escapeHtml(title)}</a>
        <p class="excerpt">
          ${escapeHtml(excerpt)}
        </p>
      </li>`;
}

/** The existing <li> for a slug, or null. Used to update a post in place. */
function findEntry(indexHtml, slug) {
  const href = `href="${slug}.html"`;
  const at = indexHtml.indexOf(href);
  if (at === -1) return null;

  const start = indexHtml.lastIndexOf('<li>', at);
  const close = indexHtml.indexOf('</li>', at);
  if (start === -1 || close === -1) return null;

  const end = close + '</li>'.length;
  // Swallow the preceding whitespace too, so replacing doesn't leave a gap.
  const lineStart = indexHtml.lastIndexOf('\n', start);
  return { start: lineStart === -1 ? start : lineStart, end };
}

/**
 * Add the post to blog/index.html, or update it if it's already listed.
 *
 * Re-publishing has to be safe: the CI workflow regenerates every draft on
 * each run, and a plain insert would stack up duplicate entries. An existing
 * post is rewritten where it already sits, which also keeps the list in
 * publication order rather than jumping an edited old post to the top.
 *
 * Returns null if the list marker is missing (see blog/index.html).
 */
export function upsertIndexEntry(indexHtml, { title, excerpt, slug, iso, display }) {
  const entry = indexEntry({ title, excerpt, slug, iso, display });

  const existing = findEntry(indexHtml, slug);
  if (existing) {
    return indexHtml.slice(0, existing.start) + entry + indexHtml.slice(existing.end);
  }

  const marker = '<ul class="post-list">';
  const markerIndex = indexHtml.indexOf(marker);
  if (markerIndex === -1) return null;

  const insertAt = markerIndex + marker.length;
  return indexHtml.slice(0, insertAt) + entry + indexHtml.slice(insertAt);
}

/** Kept for scripts/new-post.js, which only ever creates brand-new posts. */
export const insertIndexEntry = upsertIndexEntry;

/**
 * The date already published for this post, if any, so that editing a draft
 * doesn't silently re-date the post to today.
 */
export function existingPostDate(postHtml) {
  const match = /<time datetime="(\d{4}-\d{2}-\d{2})">([^<]*)<\/time>/.exec(postHtml || '');
  return match ? { iso: match[1], display: match[2] } : null;
}

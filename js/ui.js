/* ==========================================================================
   Urbanita — rendering
   Every string from Wikipedia goes in via textContent. No innerHTML, ever.
   ========================================================================== */

export function el(tag, attrs, children) {
  const node = document.createElement(tag);

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
  }
  (children || []).forEach(child => { if (child) node.appendChild(child); });
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function formatCoords({ lat, lon }) {
  return `${Math.abs(lat).toFixed(3)}\u00B0 ${lat >= 0 ? 'N' : 'S'}, ` +
         `${Math.abs(lon).toFixed(3)}\u00B0 ${lon >= 0 ? 'E' : 'W'}`;
}

/* --------------------------------------------------------------------------
   Hero photograph

   The summary endpoint hands us a ~330px thumbnail, which is far too small
   to run across the top of the card. Wikimedia's thumbnailer will render
   other sizes from the same source, but only at widths on its allow-list
   (960/1280/1920 are on it; 640/800/1024 are not — those 400), and never
   larger than the original. So: rewrite the width in the thumb URL, offer
   the valid sizes as a srcset, and fall back to what the API gave us if
   the URL isn't the shape we expect.
   -------------------------------------------------------------------------- */

const HERO_WIDTHS = [960, 1280, 1920];
const THUMB_WIDTH = /\/(\d+)px-/;

function heroImage(data) {
  const thumb = data.thumbnail?.source || null;
  const original = data.originalimage || null;
  if (!thumb) return original?.source ? { src: original.source } : null;

  const [path, query] = thumb.split('?');
  const widths = THUMB_WIDTH.test(path)
    ? HERO_WIDTHS.filter(w => !original?.width || w <= original.width)
    : [];

  // Original smaller than our smallest hero size, or an unfamiliar URL:
  // use the biggest thing we were actually handed.
  if (!widths.length) return { src: original?.source || thumb };

  const at = w => path.replace(THUMB_WIDTH, `/${w}px-`) + (query ? '?' + query : '');
  return {
    src: at(widths[0]),
    srcset: widths.map(w => `${at(w)} ${w}w`).join(', '),
    fallback: thumb
  };
}

const numberFormat = new Intl.NumberFormat('en-US');
const newsDateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Population / country / area / elevation / timezone, as a definition-list
 * grid. Any field that's missing is left out of the list entirely; if
 * nothing is present at all, no box is rendered (returns null).
 */
function renderFacts(facts) {
  if (!facts) return null;

  const population = facts.population != null
    ? numberFormat.format(facts.population) + (facts.populationYear ? ` (${facts.populationYear})` : '')
    : null;

  const rows = [
    ['Population', population],
    ['Country', facts.country || null],
    ['Area', facts.area ? `${numberFormat.format(facts.area.value)} ${facts.area.unit}` : null],
    ['Elevation', facts.elevation ? `${numberFormat.format(facts.elevation.value)} ${facts.elevation.unit}` : null],
    ['Timezone', facts.timezone || null]
  ].filter(([, value]) => value);

  if (!rows.length) return null;

  const dl = el('dl', { class: 'facts' });
  rows.forEach(([label, value]) => {
    dl.appendChild(el('div', { class: 'fact' }, [
      el('dt', { text: label }),
      el('dd', { text: value })
    ]));
  });
  return dl;
}

/**
 * The shared shell for a titled result section — a surface with its own
 * header (serif title, a small right-aligned eyebrow, and an optional note
 * of small print) so news and map read as separate things rather than as
 * tail-ends of the city card. The note lives in the header, above its rule,
 * so it reads as part of the heading rather than as the first item of the
 * content. `flush` drops the padded body, for content that should meet the
 * edges.
 */
function panel(modifier, { title, eyebrow = null, note = null, flush = false }, children) {
  const head = el('div', { class: 'panel-head' }, [
    el('h3', { class: 'panel-title', text: title })
  ]);
  if (eyebrow) head.appendChild(el('span', { class: 'panel-eyebrow', text: eyebrow }));
  if (note) head.appendChild(el('p', { class: 'panel-note', text: note }));

  return el('section', { class: 'panel panel--' + modifier }, [
    head,
    flush ? children[0] : el('div', { class: 'panel-body' }, children)
  ]);
}

/**
 * A handful of recent headlines mentioning the city, newest first. Empty
 * or missing news is expected (most small towns won't have any recent
 * English coverage) — no section is rendered rather than an empty one.
 */
function renderNews(news) {
  if (!news || !news.length) return null;

  const list = el('ul', { class: 'news-list' });
  news.forEach(item => {
    const link = el('a', {
      href: item.url, target: '_blank', rel: 'noopener', text: item.title
    });
    const metaParts = [item.domain];
    if (item.publishedAt) {
      const date = new Date(item.publishedAt);
      if (!Number.isNaN(date.getTime())) metaParts.push(newsDateFormat.format(date));
    }
    list.appendChild(el('li', null, [
      link,
      el('span', { class: 'news-meta', text: metaParts.join(' · ') })
    ]));
  });

  // Sets expectations before the headlines: this is a narrow, curated feed,
  // not general news about the city. It goes in the panel header, keeping
  // the headline links the only <a>s inside `.news` — that count is what
  // the news tests assert on.
  return panel('news', {
    title: 'In the news',
    eyebrow: news.length === 1 ? '1 recent story' : `${news.length} recent stories`,
    note: 'Mostly recent pieces on urbanism and architecture, from a small ' +
          'set of selected sources \u2014 when there\u2019s any coverage of this city.'
  }, [el('div', { class: 'news' }, [list])]);
}

/* -------------------------------------------------------------------------- */

export function showSkeleton(container) {
  clear(container);
  container.setAttribute('aria-busy', 'true');
  container.appendChild(
    el('div', { class: 'skeleton', 'aria-hidden': 'true' },
       [el('span'), el('span'), el('span'), el('span')])
  );
}

export function showState(container, { heading, message, isError }) {
  clear(container);
  container.setAttribute('aria-busy', 'false');
  container.appendChild(
    el('div', { class: isError ? 'state error' : 'state' }, [
      el('h2', { text: heading }),
      el('p', { text: message })
    ])
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A city renders as three stacked surfaces rather than one long card:
 * the city itself (hero photograph, summary, key facts), what's in the news,
 * and where it is. `.city` stacks and staggers them; each section is omitted
 * when there's nothing to put in it.
 */
export function renderCity(container, data, { facts = null, news = [] } = {}) {
  clear(container);
  container.setAttribute('aria-busy', 'false');

  const sections = el('div', { class: 'city' });

  /* --- 1. The city itself ------------------------------------------ */

  const card = el('article', { class: 'card city-card' });

  /* Masthead: the article photograph running the full width of the card,
     with the name and description set into a scrim over it. Cities without
     a photograph get the same masthead over a plain gradient, so the card
     keeps its shape either way. */
  const photo = heroImage(data);
  const hero = el('div', { class: photo ? 'city-hero' : 'city-hero city-hero--plain' });

  if (photo) {
    const img = el('img', {
      class: 'city-hero-img',
      src: photo.src,
      srcset: photo.srcset ?? null,
      sizes: '(max-width: 800px) 100vw, 760px',
      // Decorative: the heading sitting on top of it says the same thing,
      // and empty alt keeps stray text off the scrim if the photo 404s.
      alt: '',
      decoding: 'async'
    });
    // If a rewritten width is refused after all, drop back to the exact
    // URL the API gave us rather than showing a broken hero.
    if (photo.fallback) {
      img.addEventListener('error', function once() {
        img.removeEventListener('error', once);
        img.removeAttribute('srcset');
        img.setAttribute('src', photo.fallback);
      });
    }
    hero.appendChild(img);
  }

  const heroText = el('div', { class: 'city-hero-text' }, [el('h2', { text: data.title })]);
  if (data.description) {
    heroText.appendChild(el('p', { class: 'description', text: data.description }));
  }
  hero.appendChild(heroText);
  card.appendChild(hero);

  card.appendChild(el('p', {
    class: 'extract',
    text: data.extract || 'Wikipedia has no summary for this entry yet.'
  }));

  const factsBox = renderFacts(facts);
  if (factsBox) card.appendChild(factsBox);

  // Coordinates head up the map section now, so the card's footer is just
  // the credit.
  const url = data.content_urls?.desktop?.page;
  if (url) {
    card.appendChild(el('div', { class: 'card-meta' }, [
      el('span', null, [
        document.createTextNode('Source: '),
        el('a', { href: url, target: '_blank', rel: 'noopener', text: 'Wikipedia' })
      ])
    ]));
  }

  sections.appendChild(card);

  /* --- 2. What's in the news --------------------------------------- */

  const newsPanel = renderNews(news);
  if (newsPanel) sections.appendChild(newsPanel);

  /* --- 3. Where it is ---------------------------------------------- */

  let mapContainer = null;
  if (data.coordinates) {
    mapContainer = el('div', {
      class: 'map-container',
      'aria-label': 'Map showing ' + data.title
    });
    sections.appendChild(panel('map', {
      title: 'On the map',
      eyebrow: formatCoords(data.coordinates),
      flush: true
    }, [mapContainer]));
  }

  container.appendChild(sections);
  return { mapContainer };
}

/* --------------------------------------------------------------------------
   "Did you mean…?" — also used for the not-a-city case.
   -------------------------------------------------------------------------- */

export function renderOptions(container, { heading, message, hits, onPick }) {
  clear(container);
  container.setAttribute('aria-busy', 'false');

  const card = el('div', { class: 'card options-card' }, [
    el('h2', { class: 'options-heading', text: heading })
  ]);

  if (message) card.appendChild(el('p', { class: 'options-message', text: message }));

  if (hits.length) {
    const list = el('ul', { class: 'options' });
    hits.forEach(hit => {
      const link = el('button', { type: 'button', class: 'option-link', text: hit.title });
      link.addEventListener('click', () => onPick(hit.title));
      const item = el('li', null, [link]);
      if (hit.snippet) item.appendChild(el('span', { class: 'option-snippet', text: hit.snippet }));
      list.appendChild(item);
    });
    card.appendChild(list);
  }

  container.appendChild(card);
}

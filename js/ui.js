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
 * A handful of recent headlines mentioning the city, newest first. Empty
 * or missing news is expected (most small towns won't have any recent
 * English coverage) — no box is rendered rather than an empty one.
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

  return el('div', { class: 'news' }, [
    el('h3', { class: 'news-heading', text: 'In the news' }),
    list
  ]);
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

export function renderCity(container, data, { facts = null, news = [] } = {}) {
  clear(container);
  container.setAttribute('aria-busy', 'false');

  const card = el('article', { class: 'card' });

  if (data.thumbnail?.source) {
    card.appendChild(el('figure', null, [
      el('img', {
        src: data.thumbnail.source,
        alt: 'Photograph of ' + data.title,
        width: data.thumbnail.width ?? null,
        height: data.thumbnail.height ?? null,
        loading: 'lazy'
      })
    ]));
  }

  const head = el('div', { class: 'card-head' }, [el('h2', { text: data.title })]);
  if (data.description) {
    head.appendChild(el('p', { class: 'description', text: data.description }));
  }
  card.appendChild(head);

  card.appendChild(el('p', {
    class: 'extract',
    text: data.extract || 'Wikipedia has no summary for this entry yet.'
  }));

  const factsBox = renderFacts(facts);
  if (factsBox) card.appendChild(factsBox);

  const newsBox = renderNews(news);
  if (newsBox) card.appendChild(newsBox);

  const meta = el('div', { class: 'card-meta' });

  if (data.coordinates) {
    meta.appendChild(el('span', { class: 'coords', text: formatCoords(data.coordinates) }));
  }

  const url = data.content_urls?.desktop?.page;
  if (url) {
    meta.appendChild(el('span', null, [
      document.createTextNode('Source: '),
      el('a', { href: url, target: '_blank', rel: 'noopener', text: 'Wikipedia' })
    ]));
  }
  if (meta.childNodes.length) card.appendChild(meta);

  let mapContainer = null;
  if (data.coordinates) {
    mapContainer = el('div', {
      class: 'map-container',
      'aria-label': 'Map showing ' + data.title
    });
    card.appendChild(mapContainer);
  }

  container.appendChild(card);
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

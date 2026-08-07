/* ==========================================================================
   Urbanita — wiring
   Search, city-only filtering, disambiguation, ?city= URLs, key facts, map.
   ========================================================================== */

import {
  fetchSummary, searchTitles, classifyTitle, fetchFacts, filterToSettlements
} from './wiki.js';

import {
  showSkeleton, showState, renderCity, renderOptions
} from './ui.js';

import { attachMap, detachMap, refreshTheme } from './map.js';

const SITE_NAME = 'Urbanita';
const SEARCH_LIMIT = 10;

// The footer's light/dark switch (js/theme.js) doesn't know the map
// exists — it just announces the change.
document.addEventListener('urbanita:theme-change', refreshTheme);

const form        = document.getElementById('search-form');
const input       = document.getElementById('city-input');
const results     = document.getElementById('results');
const suggestions = document.getElementById('suggestions');
const submitBtn   = form.querySelector('button[type="submit"]');

let inFlight = null;
const cache = new Map();      // normalised query -> { summary, facts }

/* --------------------------------------------------------------------------
   URL state — /?city=Lisbon
   -------------------------------------------------------------------------- */

function setUrl(city, { replace = false } = {}) {
  const url = city
    ? location.pathname + '?city=' + encodeURIComponent(city)
    : location.pathname;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ city: city || null }, '', url);
  document.title = city ? `${city} \u2014 ${SITE_NAME}`
                        : `${SITE_NAME} \u2014 Explore the world's cities`;
}

function cityFromUrl() {
  return new URLSearchParams(location.search).get('city');
}

/* --------------------------------------------------------------------------
   Lookup
   -------------------------------------------------------------------------- */

/** Render the card and (re)attach its map, if it has coordinates. */
function showCity(summary, facts) {
  const { mapContainer } = renderCity(results, summary, { facts });
  if (mapContainer) attachMap(mapContainer, summary.coordinates);
  else detachMap();
}

async function lookup(rawQuery, { push = true } = {}) {
  const query = (rawQuery || '').trim();
  if (!query) return;

  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;
  const signal = controller.signal;

  if (push) setUrl(query);
  if (input.value !== query) input.value = query;

  // Whatever was on screen is about to be replaced (skeleton, a fresh
  // card, or a state message) — its map, if any, must go with it.
  detachMap();

  const key = query.toLowerCase();
  if (cache.has(key)) {
    const cached = cache.get(key);
    showCity(cached.summary, cached.facts);
    inFlight = null;
    return;
  }

  showSkeleton(results);
  submitBtn.disabled = true;

  try {
    let summary;
    try {
      summary = await fetchSummary(query, signal);
    } catch (err) {
      if (err.status === 404) {
        await offerAlternatives(query, {
          heading: 'No article found',
          message: `Wikipedia has nothing under \u201C${query}\u201D.`,
          signal
        });
        return;
      }
      throw err;
    }

    if (summary.type === 'disambiguation') {
      await offerAlternatives(query, {
        heading: 'Several places share that name',
        message: 'Pick the one you meant:',
        signal
      });
      return;
    }

    /* --- Is it actually a city? ------------------------------------- */
    let qid = null, verdict;
    try {
      ({ qid, isCity: verdict } = await classifyTitle(summary.title, signal));
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      verdict = null;                       // Wikidata unreachable
    }

    // null means "couldn't tell" — fall back to the weaker geographic
    // signal rather than hiding a legitimate result.
    const isCity = verdict === null ? Boolean(summary.coordinates) : verdict;

    if (!isCity) {
      await offerAlternatives(query, {
        heading: `\u201C${summary.title}\u201D doesn\u2019t look like a city`,
        message: 'Urbanita only shows towns and cities. Did you mean one of these?',
        signal
      });
      return;
    }

    /* --- Key facts (population, country, area, elevation, timezone) - */
    let facts = null;
    try {
      facts = qid ? await fetchFacts(qid, signal) : null;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      facts = null;                         // Wikidata down/partial: card still renders
    }

    cache.set(key, { summary, facts });
    showCity(summary, facts);

  } catch (err) {
    if (err.name === 'AbortError') return;
    showState(results, {
      heading: 'Something went wrong',
      message: `${err.message}. Check your connection and try again.`,
      isError: true
    });
  } finally {
    if (inFlight === controller) {
      inFlight = null;
      submitBtn.disabled = false;
    }
  }
}

/* --------------------------------------------------------------------------
   Search fallback, filtered to settlements
   -------------------------------------------------------------------------- */

async function offerAlternatives(query, { heading, message, signal }) {
  let hits = [];
  try {
    hits = await searchTitles(query, SEARCH_LIMIT, signal);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
  }

  let cities = [];
  let filtered = true;
  try {
    cities = await filterToSettlements(hits, signal);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    cities = hits;            // Wikidata down: show everything, unfiltered
    filtered = false;
  }

  if (!cities.length) {
    showState(results, {
      heading,
      message: hits.length
        ? 'No towns or cities matched that search. Try a different spelling, or the local name.'
        : 'Nothing matched that search. Check the spelling, or try the local name.'
    });
    return;
  }

  renderOptions(results, {
    heading,
    message: filtered ? message : message + ' (Showing unfiltered results.)',
    hits: cities,
    onPick: title => lookup(title)
  });
}

/* --------------------------------------------------------------------------
   Events
   -------------------------------------------------------------------------- */

form.addEventListener('submit', event => {
  event.preventDefault();
  lookup(input.value);
});

suggestions.addEventListener('click', event => {
  const btn = event.target.closest('button[data-city]');
  if (btn) lookup(btn.getAttribute('data-city'));
});

window.addEventListener('popstate', event => {
  const city = (event.state && event.state.city) || cityFromUrl();
  if (city) {
    lookup(city, { push: false });
  } else {
    detachMap();
    input.value = '';
    while (results.firstChild) results.removeChild(results.firstChild);
    document.title = `${SITE_NAME} \u2014 Explore the world's cities`;
  }
});

/* Deep link on first load: /?city=Kyoto */
const initial = cityFromUrl();
if (initial) lookup(initial, { push: false });

export { lookup };

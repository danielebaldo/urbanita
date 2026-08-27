/* ==========================================================================
   Urbanita — wiring
   Search, city-only filtering, disambiguation, ?city= URLs, key facts, map.
   ========================================================================== */

import {
  fetchSummary, searchTitles, classifyTitle, fetchFacts, filterToSettlements,
  fetchRandomCityTitle
} from './wiki.js';

import { fetchCityNews } from './news.js';
import { fetchCityFilms } from './films.js';
import { fetchCityFigures } from './figures.js';

import {
  showSkeleton, showState, renderCity, renderFilms, renderFigures, renderOptions
} from './ui.js';

import { attachMap, detachMap, refreshTheme } from './map.js';

const SITE_NAME = 'Urbanìta';
const SEARCH_LIMIT = 10;

// The footer's light/dark switch (js/theme.js) doesn't know the map
// exists — it just announces the change.
document.addEventListener('urbanita:theme-change', refreshTheme);

const form        = document.getElementById('search-form');
const input       = document.getElementById('city-input');
const results     = document.getElementById('results');
const suggestions = document.getElementById('suggestions');
const submitBtn   = form.querySelector('button[type="submit"]');
const randomBtn   = document.getElementById('random-btn');

const RANDOM_ATTEMPTS = 5;

let inFlight = null;
const cache = new Map();      // normalised query -> { summary, facts, news, films, figures }

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

/* Films and figures are fetched after the card is already on screen — their
   Wikidata queries can take a few seconds for a big city, and nothing else
   should wait on them. They run alongside each other, and share one little
   lifecycle: a token, so a late answer for a city the user has moved on from
   is discarded, and a controller each to stop the requests themselves. */
let renderToken = 0;
const deferredControllers = new Set();

function cancelDeferred() {
  renderToken++;
  for (const controller of deferredControllers) controller.abort();
  deferredControllers.clear();
}

/** Render the card, (re)attach its map, and start filling in the rest. */
function showCity(summary, facts, news, { qid = null, cacheKey = null, films = null, figures = null } = {}) {
  cancelDeferred();
  const token = renderToken;

  const { mapContainer, filmsSlot, figuresSlot } = renderCity(results, summary, { facts, news });
  if (mapContainer) attachMap(mapContainer, summary.coordinates);
  else detachMap();

  loadDeferred({
    slot: figuresSlot, key: 'figures', known: figures,
    fetchItems: fetchCityFigures, render: renderFigures, qid, cacheKey, token
  });
  loadDeferred({
    slot: filmsSlot, key: 'films', known: films,
    fetchItems: fetchCityFilms, render: renderFilms, qid, cacheKey, token
  });
}

/**
 * Fill one deferred slot once Wikidata answers. Never throws, never blocks —
 * an unreachable endpoint just means no section, like an empty result.
 */
async function loadDeferred({ slot, key, known, fetchItems, render, qid, cacheKey, token }) {
  // Already known, from a cache hit or the back button — no second query.
  // An empty array counts as known: "none" is an answer we keep.
  if (known) { render(slot, known); return; }
  if (!qid) { render(slot, []); return; }

  const controller = new AbortController();
  deferredControllers.add(controller);

  let items = [];
  try {
    items = await fetchItems(qid, controller.signal);
  } catch (err) {
    if (err.name === 'AbortError') return;    // superseded by a newer search
    items = [];                               // Wikidata down: no section, no error
  } finally {
    deferredControllers.delete(controller);
  }

  // The user may have searched again while Wikidata was thinking.
  if (token !== renderToken) return;

  if (cacheKey && cache.has(cacheKey)) cache.get(cacheKey)[key] = items;
  render(slot, items);
}

/**
 * Resolve a query into a renderable city, or a typed failure reason.
 * Pure orchestration over wiki.js — no DOM access, so it's reusable by
 * both the normal search flow and the random-city picker.
 */
async function resolveCity(query, signal) {
  let summary;
  try {
    summary = await fetchSummary(query, signal);
  } catch (err) {
    if (err.status === 404) return { ok: false, reason: 'not-found' };
    throw err;
  }

  if (summary.type === 'disambiguation') {
    return { ok: false, reason: 'disambiguation', summary };
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
  if (!isCity) return { ok: false, reason: 'not-a-city', summary };

  /* --- Key facts (population, country, area, elevation, timezone) - */
  let facts = null;
  try {
    facts = qid ? await fetchFacts(qid, signal) : null;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    facts = null;                         // Wikidata down/partial: card still renders
  }

  /* --- Fresh news (best-effort — most small towns will have none) - */
  let news = [];
  try {
    news = await fetchCityNews(summary.title, facts?.country, signal);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    news = [];                            // proxy down/empty: card still renders
  }

  return { ok: true, summary, facts, news, qid };
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
    showCity(cached.summary, cached.facts, cached.news, {
      qid: cached.qid, cacheKey: key, films: cached.films, figures: cached.figures
    });
    inFlight = null;
    return;
  }

  cancelDeferred();       // whatever is loading is for the previous city
  showSkeleton(results);
  submitBtn.disabled = true;

  try {
    const result = await resolveCity(query, signal);

    if (!result.ok) {
      if (result.reason === 'not-found') {
        await offerAlternatives(query, {
          heading: 'No article found',
          message: `Wikipedia has nothing under \u201C${query}\u201D.`,
          signal
        });
      } else if (result.reason === 'disambiguation') {
        await offerAlternatives(query, {
          heading: 'Several places share that name',
          message: 'Pick the one you meant:',
          signal
        });
      } else {
        await offerAlternatives(query, {
          heading: `\u201C${result.summary.title}\u201D doesn\u2019t look like a city`,
          message: 'Urbanìta only shows towns and cities. Did you mean one of these?',
          signal
        });
      }
      return;
    }

    cache.set(key, {
      summary: result.summary, facts: result.facts, news: result.news, qid: result.qid
    });
    showCity(result.summary, result.facts, result.news, { qid: result.qid, cacheKey: key });

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
   Random city
   -------------------------------------------------------------------------- */

async function lookupRandom() {
  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;
  const signal = controller.signal;

  detachMap();
  cancelDeferred();
  showSkeleton(results);
  submitBtn.disabled = true;
  randomBtn.disabled = true;

  try {
    for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt++) {
      let title;
      try {
        title = await fetchRandomCityTitle(signal);
      } catch (err) {
        if (err.name === 'AbortError') return;
        continue;                         // WDQS hiccup — try again
      }
      if (!title) continue;               // sampled entity had no enwiki article

      const result = await resolveCity(title, signal);
      if (!result.ok) continue;           // stub/disambiguation/reclassified — try again

      const key = title.toLowerCase();
      cache.set(key, {
        summary: result.summary, facts: result.facts, news: result.news, qid: result.qid
      });
      setUrl(result.summary.title);
      input.value = '';
      showCity(result.summary, result.facts, result.news, { qid: result.qid, cacheKey: key });
      return;
    }

    showState(results, {
      heading: `Couldn’t find a random city`,
      message: `Wikidata didn’t cooperate. Try again in a moment.`,
      isError: true
    });

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
      randomBtn.disabled = false;
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

randomBtn.addEventListener('click', () => lookupRandom());

window.addEventListener('popstate', event => {
  const city = (event.state && event.state.city) || cityFromUrl();
  if (city) {
    lookup(city, { push: false });
  } else {
    detachMap();
    cancelDeferred();
    input.value = '';
    while (results.firstChild) results.removeChild(results.firstChild);
    document.title = `${SITE_NAME} \u2014 Explore the world's cities`;
  }
});

/* Deep link on first load: /?city=Kyoto */
const initial = cityFromUrl();
if (initial) lookup(initial, { push: false });

export { lookup };

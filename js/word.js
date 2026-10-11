/* ==========================================================================
   Urbanita — the word the web pairs with a city
   Pure logic: no DOM access anywhere in this file.

   "What's the one word people put next to this city when they search?" The
   honest source for that is search autocomplete: type "berlin " and what the
   box offers is, more or less, what everyone else typed after it. The Worker
   (worker/news-proxy.js, /word) asks two of them, Google and DuckDuckGo,
   keyless, and hands their suggestion lists to pickWords() below. It's the
   same arrangement as the Wikidata queries: one definition, exported, used
   server-side, and testable here in Node.

   ---- Why it isn't just the first suggestion ----
   The first suggestion is "weather" or "time" for nearly every city on
   earth. What makes a city's list its own is what's left once the searches
   anyone would make about anywhere are taken out — and once that's done the
   lists say surprising, true things: Berlin is its wall, Detroit its Lions,
   Chernobyl a television series, Paris a Hilton. So:

     - Route and match searches go entirely ("porto to lisbon", "paris fc vs
       lorient"): their other words are another city or another team.
     - The city's own words go, and so does its country — "lisbon portugal"
       is a search for an address, not an association.
     - A short list of utility words goes (UTILITY): weather in a few
       languages, time, maps, airports, hotels, flights, webcams.
     - Numbers go (years, mostly), and so does anything under three letters,
       which is either a state abbreviation or a stray article.

   What's left is scored by rank, since both engines order suggestions by how
   often they're searched: a word earns more the higher its suggestion sits,
   from each engine once at its best position, and a little more for every
   further suggestion it turns up in. Agreeing engines therefore beat one
   engine repeating itself — "berlin wall" (top of both) is worth more than a
   run of "berlin marathon 2026 / 2027 / lottery" from one.
   ========================================================================== */

export const WORD_COUNT = 4;

/* Searches people make about any place at all. Kept to things that are
   never the point of a city — a sports club or a cathedral can be, so
   neither is here. "city" is: "detroit city" is just Detroit again. */
const UTILITY = new Set([
  'weather', 'wetter', 'meteo', 'météo', 'tempo', 'clima', 'forecast',
  'time', 'now', 'today', 'zone', 'timezone',
  'map', 'maps', 'airport', 'airports', 'flight', 'flights', 'code', 'zip',
  'hotel', 'hotels', 'webcam', 'webcams', 'cam', 'live',
  'population', 'pronunciation', 'news', 'city', 'things', 'what', 'where',
  'which', 'country', 'capital', 'located', 'near', 'from', 'for', 'and',
  'the', 'with', 'how', 'best', 'top',
  // The calendar and the shop: what a club or a store gets searched for,
  // never the club or the store itself.
  'schedule', 'standings', 'score', 'scores', 'results', 'tickets',
  'online', 'shop', 'store', 'tracking', 'hours', 'open', 'distance'
]);

/* A suggestion with one of these between words is a route or a fixture —
   everything else in it is about somewhere, or someone, else. */
const CONNECTOR = /\s(?:to|vs\.?|v|versus|from)\s/;

/** Lower-case words, letters only (accents kept). */
function wordsOf(text) {
  return (text || '').toLowerCase().match(/\p{L}[\p{L}'’]*/gu) || [];
}

/* For telling a city's own name apart from everything else, accents have to
   go: people type "reykjavik" far more often than "reykjavík". Only the
   comparison folds them — a word that's shown keeps its own spelling. */
function fold(word) {
  return word.normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * The city as people type it: "New York City" -> "new york", "Washington,
 * D.C." -> "washington". The same simplification the news uses (see
 * mentionTerm in worker/news-proxy.js), for the same reason — autocomplete
 * is fed what people type, and nobody types the disambiguated title.
 */
export function searchTerm(title) {
  const base = (title || '').split(',')[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
  const stripped = base.replace(/\s+City$/i, '').trim();
  return (stripped || base).toLowerCase();
}

/**
 * The words most associated with a city, best first: [{ word, score }].
 *
 * `lists` is one array of suggestion strings per engine, each in the
 * engine's own order. `city` and `country` are what to leave out. Always
 * returns an array, possibly empty — a village nobody searches for has no
 * associations, and that's an answer.
 */
export function pickWords(lists, { city = '', country = '' } = {}) {
  const own = new Set([...wordsOf(city), ...wordsOf(country)].map(fold));
  const tally = new Map();     // word -> { best: per-engine best weight, extra }

  (lists || []).forEach((list, engine) => {
    if (!Array.isArray(list)) return;
    const n = list.length;
    list.forEach((suggestion, rank) => {
      if (typeof suggestion !== 'string') return;
      const text = ' ' + suggestion.toLowerCase() + ' ';
      if (CONNECTOR.test(text)) return;

      const weight = (n - rank) / n;
      const seen = new Set();
      for (const word of wordsOf(suggestion)) {
        if (seen.has(word)) continue;
        seen.add(word);
        if (word.length < 3 || own.has(fold(word)) || UTILITY.has(word)) continue;

        const entry = tally.get(word) || { best: new Map(), extra: 0 };
        if (entry.best.has(engine)) entry.extra += weight / 4;
        else entry.best.set(engine, weight);
        tally.set(word, entry);
      }
    });
  });

  return [...tally]
    .map(([word, { best, extra }]) => ({
      word,
      score: Math.round(([...best.values()].reduce((a, b) => a + b, 0) + extra) * 100) / 100
    }))
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
    .slice(0, WORD_COUNT);
}

/* --------------------------------------------------------------------------
   The browser side — a thin client for the Worker's /word route, the same
   Worker that serves the news. No direct fallback: neither autocomplete
   endpoint answers a browser (no CORS), so with the Worker away the section
   simply isn't there, as with the news.
   -------------------------------------------------------------------------- */

const WORD_PROXY_URL = 'https://urbanita-news.daniele-baldo.workers.dev/word';

/**
 * The words search pairs with this city, best first: [{ word, score }].
 * Always resolves — an unreachable or not-yet-deployed Worker yields [],
 * the same as a city nobody searches for. Only AbortError propagates.
 */
export async function fetchCityWords(title, country, signal) {
  if (!title) return [];
  const params = new URLSearchParams({ city: title, country: country || '' });

  let data;
  try {
    const res = await fetch(WORD_PROXY_URL + '?' + params, { signal });
    if (!res.ok) return [];
    data = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return [];
  }

  const words = Array.isArray(data?.words) ? data.words : [];
  return words.filter(w => w && typeof w.word === 'string' && w.word);
}

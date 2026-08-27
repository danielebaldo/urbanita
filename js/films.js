/* ==========================================================================
   Urbanita — films connected to a city
   Pure logic: no DOM access anywhere in this file.

   Asks Wikidata (WDQS) for films whose narrative location (P840) or filming
   location (P915) is this city, ranked by how many Wikipedias cover them —
   a decent stand-in for "would anyone recognise this title?".

   No API key and no proxy: the city's QID is already in hand by the time we
   get here (classifyTitle resolves it), and WDQS is public. That's why this
   file talks to the endpoint directly, unlike js/news.js.

   ---- Why the query is shaped the way it is ----
   Every clause below is load-bearing; the obvious alternatives all fail on
   big cities, where the candidate set is enormous:

     - `wdt:P31 wd:Q11424` and NOT `wdt:P31/wdt:P279* wd:Q11424`. The
       subclass walk makes New York City exceed the 60s WDQS limit (504).
       The cost is a few films typed only as e.g. "animated film".
     - `wikibase:sitelinks`, a count Wikidata stores on the item, and NOT
       `COUNT(DISTINCT ?sitelink)`. Counting also times out on New York.
     - The enwiki article is required, not OPTIONAL: it gives us both a link
       target and a reliable title, and prunes obscure entries.
     - No `SERVICE wikibase:label`. Deriving the title from the article URL
       (as fetchRandomCityTitle does) took New York from 16s to 4.8s, and
       avoids items whose label doesn't resolve coming back as "Q134773".
     - The request itself — deadline, cancellation, and the retry that
       covers WDQS's erratic latency (the same New York request measured
       6.4s, 17.7s and a 502 on three consecutive tries) — lives in
       js/wdqs.js, shared with the figures query.

   Measured after all that: Lisbon 0.4s, Bosco Gurin 1.3s, New York 4.8s.
   ========================================================================== */

import { queryWdqs } from './wdqs.js';

const FILM_LIMIT = 6;

/** Wikipedia disambiguators: "Alive (2009 film)" -> "Alive". */
const DISAMBIGUATOR = /\s*\([^)]*\b(?:film|movie)\b[^)]*\)\s*$/i;

/**
 * Exported because worker/news-proxy.js builds the very same query
 * server-side — the Worker takes a QID, never SPARQL, so it can't be used
 * as an open query endpoint, and this stays the single definition of what
 * "films for a city" means.
 */
export function filmsQuery(qid) {
  return `SELECT ?film (MIN(?yr) AS ?year) (SAMPLE(?art) AS ?article) ?links WHERE {
  VALUES ?rel { wdt:P840 wdt:P915 }
  ?film ?rel wd:${qid} ;
        wdt:P31 wd:Q11424 ;
        wikibase:sitelinks ?links .
  ?art schema:about ?film ;
       schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL { ?film wdt:P577 ?d . BIND(YEAR(?d) AS ?yr) }
} GROUP BY ?film ?links ORDER BY DESC(?links) LIMIT ${FILM_LIMIT}`;
}

/** "https://en.wikipedia.org/wiki/Alive_(2009_film)" -> "Alive" */
function titleFromArticle(url) {
  const slug = url.replace('https://en.wikipedia.org/wiki/', '');
  const title = decodeURIComponent(slug).replace(/_/g, ' ');
  return title.replace(DISAMBIGUATOR, '').trim();
}

/**
 * Films set or shot in this city, best-known first.
 * Always resolves — a QID we never resolved, a malformed response, or
 * Wikidata being unreachable all yield [], since "no films" is an expected,
 * valid state (most small towns have none), not an error the caller has to
 * handle specially. Only AbortError propagates, so a superseded search still
 * cancels cleanly. See js/wdqs.js for the retry behind it.
 */
export async function fetchCityFilms(qid, signal) {
  if (!qid) return [];

  const bindings = await queryWdqs(
    { kind: 'films', qid, sparql: filmsQuery(qid) }, signal);

  return bindings
    .map(row => {
      const url = row?.article?.value;
      if (!url) return null;
      const title = titleFromArticle(url);
      if (!title) return null;
      const year = Number.parseInt(row?.year?.value, 10);
      return { title, url, year: Number.isFinite(year) ? year : null };
    })
    .filter(Boolean);
}

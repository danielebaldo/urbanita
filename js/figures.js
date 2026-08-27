/* ==========================================================================
   Urbanita — figures born in a city
   Pure logic: no DOM access anywhere in this file.

   Asks Wikidata (WDQS) for people whose place of birth (P19) is this city
   and whose occupation (P106) is one of the fields this site is actually
   about — the built environment, design, ecology, and the social sciences
   that study cities. Ranked by how many Wikipedias cover them, the same
   "would anyone recognise this name?" stand-in js/films.js uses.

   No API key and no proxy, for the same reason as films: the city's QID is
   already in hand by the time we get here, and WDQS is public.

   ---- Why the query is shaped the way it is ----
   The constraints are the ones films.js documents, plus one of its own:

     - `wdt:P106 ?job` against an explicit VALUES list, and NOT a
       `wdt:P106/wdt:P279*` subclass walk. Same reason as films: the walk
       makes the big cities exceed the 60s WDQS limit.
     - `wikibase:sitelinks`, the count stored on the item, not a COUNT.
     - The enwiki article is required, not OPTIONAL — link target, reliable
       name, and it prunes the obscure entries.
     - No `SERVICE wikibase:label`: the name comes from the article URL, and
       the occupation label comes from OCCUPATIONS below, since the query
       can only ever return a QID that's already in that table.
     - The request itself — deadline, cancellation, and the retry that
       covers WDQS's erratic latency — lives in js/wdqs.js, shared with the
       films query.
     - The MINUS on PERFORMERS. Sitelink fame is a blunt instrument, and
       plenty of celebrities carry one of these occupations as a secondary
       Wikidata tag. Without it New York's top names were Paris Hilton and
       Sienna Miller (both tagged "fashion designer") ahead of any of the
       sociologists, and Lisbon offered a singer tagged "architect".

   "fashion designer" (Q3501317) is deliberately *not* in OCCUPATIONS. It
   was the single biggest source of that noise, it earned no place in the
   top six of any city tried, and it was expensive: including it took
   Barcelona from 8.3s to 25.2s and Milan to a 502.

   Measured after all that: Porto 2.2s, Milan 2.7s, Lisbon 4.3s,
   Barcelona 8.3s, New York 13.6s.
   ========================================================================== */

import { queryWdqs } from './wdqs.js';

const FIGURE_LIMIT = 6;

/**
 * The fields Urbanìta is about, as Wikidata occupation QIDs -> the label
 * shown under a name. This table is both the filter and the labels: the
 * query returns one of these QIDs or nothing, so no label service is
 * needed. Four families — the built environment, design, ecology, and the
 * social sciences that study cities.
 *
 * **The order matters.** Plenty of people hold several of these at once, and
 * only one goes under the name; the earliest entry here wins. So the built
 * environment outranks design, which outranks ecology, which outranks the
 * social sciences — Jane Jacobs is tagged both `urban planner` and
 * `sociologist`, and reads better as the former. Reordering this table
 * reorders that preference; nothing else depends on the sequence.
 */
export const OCCUPATIONS = {
  // Built environment
  Q42973:    'architect',
  Q11486702: 'architectural historian',
  Q17391659: 'architectural theorist',
  Q2815948:  'landscape architect',
  Q131062:   'urban planner',
  Q84308440: 'urban designer',
  Q13582652: 'civil engineer',
  // Design
  Q5322166:  'designer',
  Q627325:   'graphic designer',
  Q11287574: 'industrial designer',
  Q2133309:  'interior designer',
  Q354034:   'type designer',
  // Ecology
  Q15839134: 'ecologist',
  Q3578589:  'environmentalist',
  Q16060693: 'conservationist',
  // The social sciences
  Q2306091:  'sociologist',
  Q4773904:  'anthropologist',
  Q901402:   'geographer'
};

/* Occupations that mean the sitelink count is measuring a different kind of
   fame than the one we're asking about. Kept deliberately short: it exists
   to stop a pop career outranking the city's architects, not to adjudicate
   who counts as a real designer. */
const PERFORMERS = ['Q177220', 'Q33999', 'Q639669', 'Q947873', 'Q512314', 'Q4610556'];

/** Person articles disambiguate by trade or birth year: "Gisela (singer)". */
const DISAMBIGUATOR = /\s*\([^)]*\)\s*$/;

/* Table order is the preference order — see OCCUPATIONS above. */
const PRIORITY = Object.keys(OCCUPATIONS);

/**
 * Exported because worker/news-proxy.js builds the very same query
 * server-side — the Worker takes a QID, never SPARQL, so it can't be used
 * as an open query endpoint, and this stays the single definition of what
 * "figures for a city" means.
 */
export function figuresQuery(qid) {
  const jobs = Object.keys(OCCUPATIONS).map(id => 'wd:' + id).join(' ');
  const performers = PERFORMERS.map(id => 'wd:' + id).join(' ');

  /* Every matching occupation comes back, not SAMPLE(?job): sampling picks
     an arbitrary one, so the same person could read "urban planner" on one
     load and "sociologist" on the next. Concatenated here, ranked below. */
  return `SELECT ?person (GROUP_CONCAT(DISTINCT ?job; SEPARATOR="|") AS ?occupations) (MIN(?yr) AS ?year) (SAMPLE(?art) AS ?article) ?links WHERE {
  VALUES ?job { ${jobs} }
  ?person wdt:P19 wd:${qid} ;
          wdt:P106 ?job ;
          wikibase:sitelinks ?links .
  MINUS { VALUES ?bad { ${performers} } ?person wdt:P106 ?bad }
  ?art schema:about ?person ;
       schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL { ?person wdt:P569 ?d . BIND(YEAR(?d) AS ?yr) }
} GROUP BY ?person ?links ORDER BY DESC(?links) LIMIT ${FIGURE_LIMIT}`;
}

/** "https://en.wikipedia.org/wiki/Gisela_(singer)" -> "Gisela" */
function nameFromArticle(url) {
  const slug = url.replace('https://en.wikipedia.org/wiki/', '');
  const name = decodeURIComponent(slug).replace(/_/g, ' ');
  return name.replace(DISAMBIGUATOR, '').trim();
}

/**
 * Of everything this person is tagged as, the label for the one that ranks
 * highest in OCCUPATIONS. Takes WDQS's concatenated entity URIs:
 * "http://www.wikidata.org/entity/Q2306091|http://...Q131062" -> "urban planner".
 */
function occupationLabel(concatenated) {
  if (!concatenated) return null;

  let best = null;
  let bestRank = Infinity;
  for (const uri of concatenated.split('|')) {
    const rank = PRIORITY.indexOf(uri.split('/').pop());
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank;
      best = uri.split('/').pop();
    }
  }
  return best ? OCCUPATIONS[best] : null;
}

/**
 * People born in this city who worked in one of Urbanìta's fields,
 * best-known first. Always resolves — an unresolved QID, a malformed
 * response, or Wikidata being unreachable all yield [], since "nobody" is
 * an expected, valid state (most small towns have none), not an error the
 * caller has to handle. Only AbortError propagates, so a superseded search
 * still cancels cleanly. See js/wdqs.js for the retry behind it.
 */
export async function fetchCityFigures(qid, signal) {
  if (!qid) return [];

  const bindings = await queryWdqs(
    { kind: 'figures', qid, sparql: figuresQuery(qid) }, signal);

  return bindings
    .map(row => {
      const url = row?.article?.value;
      if (!url) return null;
      const name = nameFromArticle(url);
      if (!name) return null;
      const year = Number.parseInt(row?.year?.value, 10);
      return {
        name,
        url,
        occupation: occupationLabel(row?.occupations?.value),
        year: Number.isFinite(year) ? year : null
      };
    })
    .filter(Boolean);
}

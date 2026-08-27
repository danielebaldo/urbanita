/* ==========================================================================
   Urbanita — the site's Worker (Cloudflare)

   Two jobs, on two paths:

     /           news for a city (everything below)
     /wikidata   the films and figures queries, cached — see WIKIDATA below

   ---- News ----
   Sits between the site and its news sources:
     - hides the Currents API key (never shipped to the browser)
     - caches results per city for an hour, so real upstream requests stay
       rare and controlled regardless of visitor volume, instead of every
       visitor's browser being its own client against a daily quota
     - returns CORS headers so the static site can call it directly

   ---- Sources, and why two layers ----
   Primary: a curated set of RSS feeds (RSS_SOURCES below) — fetched
   directly, server-side (no CORS concern here at all; that constraint
   only ever applies to browser calls). Each source is either:
     - `trusted: true` — its whole editorial focus already IS urbanism
       (Guardian Cities, ArchDaily, Next City, The Architect's Newspaper),
       so a result only needs to mention the city.
     - `trusted: false` — a general-interest outlet (Monocle, NYT, Le
       Monde, Politico) that covers plenty else besides, so a result must
       ALSO read as being about the topic (TOPIC_KEYWORDS) before it
       counts, same requirement as the Currents fallback below.

   Fallback (only when the RSS sources return nothing): the Currents API,
   a general news search. Results must mention the city AND either come
   from a short allowlist of known-urbanist sources
   (isTrustedUrbanismSource) where the outlet itself is the guarantee
   (e.g. Bloomberg CityLab, which doesn't publish a public RSS feed so
   it's folded in this way instead), or read as being about the topic
   per TOPIC_KEYWORDS.

   An earlier version tried Currents alone with a required topic-keyword
   match and came back empty for nearly everything, including major
   cities — a generic news feed mostly doesn't cover this niche, and even
   when it does, the exact keyword rarely lands in the short
   title/description snippet Currents exposes. Expect "no news" to still
   be common — most cities most days won't have fresh urbanism coverage —
   but real matches should now actually be found.

   ---- Deploy ----
   The dashboard's drag-and-drop uploader is unreliable for a single-file
   Worker like this one (it tends to insist on a build step that isn't
   needed here). Use Wrangler instead — no separate install, npx runs it
   on demand:
     cd worker
     npx wrangler login
     npx wrangler secret put CURRENTS_API_KEY   # paste your key in
     npx wrangler deploy
   Then put the printed URL into NEWS_PROXY_URL at the top of js/news.js.

   Re-run `npx wrangler deploy` after any edit to this file — the cache
   (CACHE_TTL_SECONDS) is keyed by city/country, not by code version, so
   a city already cached under old logic keeps serving the old result
   until that hour is up, even after a redeploy.
   ========================================================================== */

/* ==========================================================================
   WIKIDATA (/wikidata?kind=films|figures&qid=Q90)

   Why this is here at all: WDQS answers the same query in half a second or
   in forty, essentially at random, and the figures query for a city the
   size of Berlin came in under the browser's 20s ceiling once in seven
   tries. Rewriting the query didn't help — ranking in a subquery and
   dropping the performer filter were both within the noise — because the
   cost is a shared public endpoint scanning everyone born in a large city,
   not the shape of the question.

   Run here instead, it's off the critical path: nobody is watching a
   skeleton, the budget can be generous, and the answer is cached per city
   for a week. Only the first visitor to a city ever waits, and even a
   visitor who gives up warms the cache for the next one — this Worker
   finishes and stores the result whether or not the browser is still
   listening.

   The route takes a `kind` and a QID, never SPARQL: the query is built
   here, from the very same builders the browser uses (js/films.js,
   js/figures.js), so this can't be used as an open query endpoint and
   there's still only one definition of each query. Wrangler bundles those
   imports; they're pure logic with no DOM in them.

   Failures are never cached. An empty result *is* cached — "no films here"
   is a real answer, and re-asking it weekly is enough.
   ========================================================================== */

import { filmsQuery } from '../js/films.js';
import { figuresQuery } from '../js/figures.js';

const WDQS = 'https://query.wikidata.org/sparql';

/* A week. Wikidata's answer to "who was born in Lisbon" does not change
   hourly, and the whole point is that almost nobody pays the query cost. */
const WIKIDATA_TTL_SECONDS = 604800;

/* Far more generous than the browser's 20s, because nothing is waiting on
   it here — but still short of WDQS's own 60s limit, so a doomed query is
   dropped rather than held open. */
const WIKIDATA_TIMEOUT_MS = 50000;

const QUERY_BUILDERS = { films: filmsQuery, figures: figuresQuery };

const CURRENTS_SEARCH = 'https://api.currentsapi.services/v1/search';
const CACHE_TTL_SECONDS = 3600;   // 1 hour: fresh enough, keeps upstream calls rare
const DISPLAY_COUNT = 5;

const RSS_SOURCES = [
  { name: 'The Guardian — Cities', url: 'https://www.theguardian.com/cities/rss', trusted: true },
  { name: 'ArchDaily', url: 'http://feeds.feedburner.com/Archdaily', trusted: true },
  { name: 'Next City', url: 'https://nextcity.org/feeds/features', trusted: true },
  { name: "The Architect's Newspaper", url: 'https://www.archpaper.com/feed', trusted: true },
  { name: 'Monocle', url: 'https://monocle.com/feed', trusted: false },
  { name: 'The New York Times — Real Estate', url: 'https://rss.nytimes.com/services/xml/rss/nyt/RealEstate.xml', trusted: false },
  { name: 'Le Monde', url: 'https://www.lemonde.fr/en/rss/une.xml', trusted: false },
  { name: 'Politico', url: 'https://rss.politico.com/politics-news.xml', trusted: false }
  // NYT/Le Monde/Politico URLs are well-documented conventions, not
  // independently verified live — theguardian.com and politico.com's own
  // fetch-tool access was blocked while building this. Check them with
  // ?debug=1 after deploying (per-source status/rawItems/matched/error).
];

// Currents-fallback-only: sources whose whole focus is urbanism, so a
// result from them is trusted on topic without needing a keyword match.
function isTrustedUrbanismSource(articleUrl) {
  try {
    const u = new URL(articleUrl);
    return u.hostname.replace(/^www\./, '') === 'bloomberg.com' && u.pathname.startsWith('/citylab');
  } catch {
    return false;
  }
}

// Required for untrusted RSS sources and the Currents fallback: a
// title/description must contain at least one of these (case-insensitive
// substring) since the source alone doesn't guarantee the topic. Covers
// urbanism/architecture/mobility/governance and city-focused travel
// writing. Deliberately broad phrasing over precise jargon — substring
// matching can't do synonym/stemming matching.
const TOPIC_KEYWORDS = [
  'urban planning', 'urbanism', 'urbanist', 'urban design',
  'architecture', 'architect', 'skyline', 'landmark', 'redevelopment',
  'renovation', 'heritage', 'historic preservation', 'public space', 'waterfront',
  'mobility', 'transit', 'public transport', 'metro', 'subway', 'tram',
  'bike lane', 'cycling', 'pedestrian', 'walkability', 'congestion',
  'housing', 'affordable housing', 'gentrification', 'zoning',
  'city council', 'mayor', 'municipal', 'city hall', 'infrastructure', 'smart city',
  'travel', 'tourism', 'tourist', 'traveler', 'city guide', 'neighborhood guide',
  'itinerary', 'hotel', 'sightseeing', 'things to do', 'weekend getaway'
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/wikidata') {
      return handleWikidata(url, request, ctx);
    }

    const city = (url.searchParams.get('city') || '').trim();
    const country = (url.searchParams.get('country') || '').trim();
    if (!city) return jsonResponse({ articles: [] }, 400);

    // ?debug=1 — temporary diagnostic mode: bypasses the cache (always
    // fresh) and reports what happened at each source, instead of just
    // the final article list. Not used by js/news.js; for troubleshooting
    // via a direct URL hit only. Remove once the pipeline's trustworthy.
    const debugMode = url.searchParams.has('debug');
    const debugLog = debugMode ? { rss: [], currents: null, usedSource: null } : null;

    const cache = caches.default;
    const cacheKey = new Request(cacheKeyUrl(city, country), request);

    if (!debugMode) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    const articles = await fetchNews(city, country, env.CURRENTS_API_KEY, debugLog);
    const response = jsonResponse(debugMode ? { articles, debug: debugLog } : { articles }, 200);

    if (!debugMode) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};

/* --------------------------------------------------------------------------
   /wikidata
   -------------------------------------------------------------------------- */

async function handleWikidata(url, request, ctx) {
  const kind = (url.searchParams.get('kind') || '').trim();
  const qid = (url.searchParams.get('qid') || '').trim();

  // Both are strictly checked: this endpoint builds its own SPARQL, and a
  // QID is the only thing a caller gets to influence.
  const build = QUERY_BUILDERS[kind];
  if (!build || !/^Q\d+$/.test(qid)) {
    return jsonResponse({ bindings: [], error: 'bad request' }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(
    `https://urbanita-wdqs-cache.internal/?kind=${kind}&qid=${qid}`, request);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  /* The query AND the cache write both go inside waitUntil, not just the
     write. Cloudflare cancels a Worker when its client disconnects, so with
     the query on the request path a visitor who gave up took the whole
     thing down with them and nothing was cached — measured: a request
     abandoned after 5s left the city still uncached 75s later. That is
     precisely backwards, because the cities worth caching are the slow ones
     nobody waits for. Now the work outlives the browser: the first visitor
     may still see nothing, and every visit after that is instant. */
  const work = (async () => {
    const bindings = await runSparql(build(qid));
    // A failure must not be cached for a week — it would turn one bad
    // minute at WDQS into a city that has nobody in it until next Tuesday.
    if (bindings === null) return null;

    const response = jsonResponse({ bindings }, 200, WIKIDATA_TTL_SECONDS);
    await cache.put(cacheKey, response.clone());
    return response;
  })();

  ctx.waitUntil(work);

  const response = await work;
  return response ?? jsonResponse({ bindings: [], error: 'upstream unavailable' }, 502);
}

/**
 * The bindings array, or null if WDQS couldn't be made to answer. Tried
 * twice: roughly one request in nine came back 502 while this was being
 * built, independently of the query.
 */
async function runSparql(sparql) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(WDQS + '?format=json&query=' + encodeURIComponent(sparql), {
        headers: {
          'Accept': 'application/json',
          // Server-side we can set a real User-Agent, which is what
          // Wikimedia's policy actually asks for; browsers can't.
          'User-Agent': 'Urbanita/0.3 (https://urbanita.it)'
        },
        signal: AbortSignal.timeout(WIKIDATA_TIMEOUT_MS)
      });
      if (!res.ok) continue;
      const data = await res.json();
      const bindings = data?.results?.bindings;
      if (Array.isArray(bindings)) return bindings;
    } catch {
      // timeout or transport error — fall through to the second attempt
    }
  }
  return null;
}

function cacheKeyUrl(city, country) {
  return 'https://urbanita-news-cache.internal/?city=' +
    encodeURIComponent(city) + '&country=' + encodeURIComponent(country);
}

function jsonResponse(body, status, maxAge = CACHE_TTL_SECONDS) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${maxAge}`
    }
  });
}

/**
 * Urbanism news for a city: curated RSS sources first, Currents API only
 * if those come back empty. Always resolves to an array, deduped by
 * outlet and trimmed to DISPLAY_COUNT.
 */
async function fetchNews(city, country, apiKey, debugLog) {
  const fromRss = await fetchFromRssSources(city, debugLog);
  const articles = fromRss.length ? fromRss : await fetchFromCurrents(city, country, apiKey, debugLog);
  if (debugLog) debugLog.usedSource = fromRss.length ? 'rss' : 'currents';
  return dedupeAndTrim(articles);
}

function dedupeAndTrim(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    if (seen.has(a.domain)) continue;
    seen.add(a.domain);
    out.push(a);
    if (out.length >= DISPLAY_COUNT) break;
  }
  return out;
}

/** Fetches every RSS_SOURCES feed in parallel; a single bad/slow feed can't block the rest. */
async function fetchFromRssSources(city, debugLog) {
  const mention = mentionTerm(city);
  const perSource = await Promise.all(RSS_SOURCES.map(src => fetchOneRssSource(src, mention)));
  if (debugLog) debugLog.rss = perSource.map(r => r.info);
  return perSource.flatMap(r => r.articles);
}

async function fetchOneRssSource(source, mention) {
  const info = { name: source.name, url: source.url, status: null, rawItems: 0, matched: 0, error: null };

  let xml;
  try {
    // Some publishers' WAFs reject requests with no/generic User-Agent as
    // bot-like (confirmed live: The Guardian and Next City both 406/403'd
    // a bare fetch()). Identify honestly, same convention as js/wiki.js's
    // Api-User-Agent for Wikipedia, rather than spoofing a browser.
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': 'UrbanitaNewsBot/1.0 (+https://urbanita.it)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });
    info.status = res.status;
    if (!res.ok) { info.error = `HTTP ${res.status}`; return { articles: [], info }; }
    xml = await res.text();
  } catch (e) {
    info.error = String((e && e.message) || e);
    return { articles: [], info };
  }

  const items = parseRssItems(xml).filter(it => it.title && it.link);
  info.rawItems = items.length;

  const matched = items.filter(it => {
    const text = `${it.title} ${it.description || ''}`.toLowerCase();
    if (!text.includes(mention)) return false;
    return source.trusted || TOPIC_KEYWORDS.some(k => text.includes(k));
  });
  info.matched = matched.length;

  const articles = matched.map(it => ({
    title: it.title,
    url: it.link,
    domain: hostnameOf(it.link) || source.name,
    publishedAt: it.pubDate || null
  }));
  return { articles, info };
}

/**
 * Recent English-language urbanism/travel news for a city from Currents
 * API — used only when the curated RSS sources found nothing. Filtered
 * to articles that mention the city AND (are from a trusted urbanist
 * source, or read as being on-topic per TOPIC_KEYWORDS). Always resolves
 * to an array — an upstream failure or empty result both just mean no
 * matching news right now, not an error to surface.
 */
async function fetchFromCurrents(city, country, apiKey, debugLog) {
  const info = { hasApiKey: Boolean(apiKey), status: null, rawItems: 0, matched: 0, error: null };
  if (debugLog) debugLog.currents = info;

  if (!apiKey) { info.error = 'CURRENTS_API_KEY not set'; return []; }   // fail quiet, not loud

  const searchTerm = mentionTerm(city);
  const keywords = country ? `"${searchTerm}" "${country}"` : `"${searchTerm}"`;
  const upstream = new URL(CURRENTS_SEARCH);
  upstream.searchParams.set('keywords', keywords);
  upstream.searchParams.set('language', 'en');
  // page_size=30 (the API's documented ceiling) got a flat 400 back —
  // confirmed live — so it's above what the free tier actually allows.
  // Omitted; the default page size worked fine in earlier testing.

  let data;
  try {
    const res = await fetch(upstream, { headers: { Authorization: `Bearer ${apiKey}` } });
    info.status = res.status;
    if (!res.ok) { info.error = `HTTP ${res.status}`; return []; }
    data = await res.json();
  } catch (e) {
    info.error = String((e && e.message) || e);
    return [];
  }

  const raw = Array.isArray(data?.news) ? data.news : [];
  info.rawItems = raw.length;

  const mustMentionCity = searchTerm;
  const matched = raw
    .filter(a => a && a.title && a.url)
    .filter(a => {
      const text = `${a.title} ${a.description || ''}`.toLowerCase();
      if (!text.includes(mustMentionCity)) return false;
      return isTrustedUrbanismSource(a.url) || TOPIC_KEYWORDS.some(k => text.includes(k));
    });
  info.matched = matched.length;

  return matched.map(a => ({
    title: a.title,
    url: a.url,
    domain: hostnameOf(a.url),
    publishedAt: a.published || null
  }));
}

function hostnameOf(articleUrl) {
  try { return new URL(articleUrl).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

/**
 * A Wikipedia article title as it's more likely to actually appear in
 * news prose — e.g. "New York City" -> "new york", "Washington, D.C."
 * -> "washington". Wikipedia titles a city by its full disambiguated
 * name (needed to tell it apart from same-named things), but real
 * articles usually just say the short form once context is clear;
 * requiring the exact full title was silently zeroing out results for
 * major cities like New York, which is worse than the occasional
 * over-broad match this trades for (e.g. "Kansas City" -> "kansas" can
 * also pick up stories about the state).
 */
function mentionTerm(title) {
  const base = (title || '').split(',')[0].trim();
  const stripped = base.replace(/\s+City$/i, '').trim();
  return (stripped || base).toLowerCase();
}

/**
 * A deliberately small, hand-rolled RSS 2.0 <item> extractor — no XML
 * parser is available in Workers without bundling a library, and
 * RSS_SOURCES are all plain RSS 2.0, not Atom. Doesn't handle nested
 * CDATA-within-CDATA or malformed feeds; a feed that doesn't parse
 * cleanly just yields no items for that source, handled the same as any
 * other source-level failure.
 */
function parseRssItems(xml) {
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  return blocks.map(block => {
    const body = block.split(/<\/item>/i)[0];
    return {
      title: extractTag(body, 'title'),
      link: extractTag(body, 'link'),
      pubDate: extractTag(body, 'pubDate'),
      description: extractTag(body, 'description')
    };
  });
}

function extractTag(xml, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  if (!m) return '';
  return decodeXmlEntities(m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim());
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

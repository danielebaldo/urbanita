# Urbanita

A personal site with a city lookup tool. Type any city name, get a summary
pulled live from Wikipedia — and only for places that are actually cities.

No build step. Static files, which is exactly what GitHub Pages wants — the
one dependency, MapLibre GL JS, loads from a CDN with no install step. The
one exception is news: it goes through a small serverless proxy (see "How
city news works" below) rather than being called directly from the browser,
to keep an API key private and results cached.

## Status

Milestones 1–7 complete.

- [x] 1. Search + summary card
- [x] 2. Disambiguation fallback ("Did you mean…?")
- [x] 3. Shareable `?city=` URLs, back-button support
- [x] 2.5 City-only filtering via Wikidata `instance of`
- [x] 4. Wikidata infobox (population, country, area, elevation, timezone)
- [x] 5. MapLibre map (custom OpenFreeMap style, full-width strip pinned to
      the bottom of the page; flies to each searched city)
- [x] 6. About page, blog, attribution page
- [x] 7. Fresh news per city (Currents API, via a small caching proxy)

Also: a manual light/dark switch in the footer (defaults to the OS
preference, remembered after that) on every page.

## Files

```
index.html                    home page + search
about.html                    project + author
attribution.html              full data/library/font credits
blog/index.html               journal index
blog/building-urbanita.html   the first post
css/style.css                 design tokens and layout
js/wiki.js                    Wikipedia + Wikidata calls, city classification (no DOM)
js/news.js                    thin client for the news proxy, per city (no DOM)
js/ui.js                      rendering (no network)
js/map.js                     MapLibre map lifecycle (the one third-party global)
js/map-style.json             custom OpenFreeMap/MapLibre style
js/theme.js                   light/dark switch (every page)
js/app.js                     wiring, URL state (index.html only)
worker/news-proxy.js          Cloudflare Worker: Currents API key, cache, CORS (deployed separately)
worker/wrangler.toml          Worker deploy config, for `npx wrangler deploy`
test/                         Node test suite
package.json                  only tells Node these are ES modules — nothing to install
```

## How the city filter works

The Wikipedia summary endpoint cannot tell a city from a mountain, so
classification comes from Wikidata:

1. Resolve the article title to a Wikidata Q-ID (`prop=pageprops`).
2. Read `instance of` (P31).
3. If none of those match a known settlement class, walk `subclass of` (P279)
   upward up to 3 hops.

This means `commune of France`, `city of the United States` and `city-state`
all resolve without being hardcoded. Requests are batched (50 ids at a time)
and cached, and the taxonomy repeats across cities, so a typical lookup costs
**one extra request**, often zero once warm.

Coordinates are deliberately *not* used as the primary test — Mount Fuji and
Portugal both have coordinates. They're only a fallback if Wikidata is
unreachable.

### Known limits

- Unusual administrative types (e.g. Hong Kong, a "special administrative
  region") can be misclassified as non-cities. A rejection isn't a dead
  end — offer alternatives, or search again with a more specific name.
- If Wikidata is down, results are shown unfiltered rather than blocked.

## How city news works

`js/news.js` calls Urbanìta's own proxy (`worker/news-proxy.js`, a small
Cloudflare Worker), not a news source directly. Two layers, in order:

1. **Primary — curated RSS feeds** (`RSS_SOURCES` in the Worker), each
   marked `trusted` or not:
   - `trusted: true` — the whole outlet already *is* urbanism, so a
     result only needs to mention the city:
     [The Guardian's Cities section](https://www.theguardian.com/cities),
     [ArchDaily](https://www.archdaily.com),
     [Next City](https://nextcity.org),
     [The Architect's Newspaper](https://www.archpaper.com).
   - `trusted: false` — general-interest outlets that cover plenty else
     besides, so a result must also read as on-topic (`TOPIC_KEYWORDS`,
     same requirement as the Currents fallback below):
     [Monocle](https://monocle.com),
     [The New York Times — Real Estate](https://www.nytimes.com/real-estate),
     [Le Monde](https://www.lemonde.fr/en/), [Politico](https://www.politico.com).

     Fetched directly, server-side — RSS needs no API key and no CORS
     (that constraint only ever applied to browser calls).
2. **Fallback — the [Currents API](https://currentsapi.services)**, used
   only when the RSS sources turn up nothing. A general news search, so
   results must mention the city **and** either come from a short
   allowlist of known-urbanist sources (`isTrustedUrbanismSource` — e.g.
   Bloomberg CityLab, which doesn't publish a public RSS feed so it's
   folded in this way instead) or read as on-topic per `TOPIC_KEYWORDS`.

`TOPIC_KEYWORDS` covers urbanism/architecture/mobility/governance *and*
city-focused travel writing (city guides, tourism, hotels, itineraries).

Results are de-duplicated by outlet, capped at 5, and cached per city for
an hour. The site only ever shows headline, date, and source outlet, each
linking back to the original article — it's an index, not a mirror.

An earlier version tried Currents alone with a required topic-keyword
match and came back empty for nearly everything, including major cities —
a general news feed mostly doesn't cover this niche, and even when it
does, the exact keyword rarely lands in the short title/description
snippet Currents exposes. Still, expect **"no news" to be common** — most
cities most days won't have fresh coverage from any of these sources —
but real matches should now actually surface.

**This needs a one-time deploy** before it does anything live — it isn't
part of `git push` the way the rest of the site is:

1. Get a free API key at [currentsapi.services](https://currentsapi.services).
2. From `worker/`, deploy with [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
   (no install needed — `npx` runs it on demand; the dashboard's
   drag-and-drop uploader is flaky about single-file Workers and will
   often ask for this instead):
   ```sh
   cd worker
   npx wrangler login                        # opens a browser to authorize
   npx wrangler secret put CURRENTS_API_KEY  # pastes your key in, kept private
   npx wrangler deploy                       # prints the worker's URL
   ```
3. Copy the printed URL (`https://urbanita-news.<your-subdomain>.workers.dev`)
   into `NEWS_PROXY_URL` at the top of `js/news.js`.

Until that's done, `fetchCityNews` fails closed — cities just render
without a news section, same as the "no recent coverage" case.

### Why a proxy, not a direct call

The first version of this called [GDELT](https://www.gdeltproject.org)'s
DOC 2.0 API directly from the browser — free, keyless, and CORS-open, so
(like Wikipedia/Wikidata) it needed no backend at all. In practice its
rate limit (documented at roughly one request per 5 seconds per IP) proved
far too easy to trip and slow to clear, reproducing on two unrelated
networks during testing. Every other free-tier news API worth using
requires an API key, which can't be safely embedded in a static site's
public JS — so a small proxy became necessary either way, and it also
solves the reliability problem: real upstream requests now come from one
cached, controlled origin instead of every visitor's own browser.

### Known limits

- City names that are also common English words (e.g. "Nice") can still
  pull in some irrelevant results even with country-narrowing.
- The mention-check simplifies "New York City" -> "New York",
  "Washington, D.C." -> "Washington", etc. (`mentionTerm()` in the
  Worker), since prose rarely uses a city's full disambiguated Wikipedia
  title. This trades a bit of precision for a lot of recall — a small
  number of "X City" names (Kansas City, Ho Chi Minh City) can pick up
  stories about the shorter, more ambiguous name instead.
- The topic filter (untrusted RSS sources + Currents fallback) is plain
  substring matching against a curated keyword list — it won't catch
  synonyms, stemmed variants ("cyclist" vs "cycling"), or the concept
  phrased without any listed term. Precision over recall, deliberately.
- The RSS parser (`parseRssItems` in the Worker) is a small hand-rolled
  `<item>` extractor, not a real XML parser — it handles plain RSS 2.0
  (all of `RSS_SOURCES` are) but not Atom feeds or malformed XML. A feed
  that fails to fetch or parse just contributes zero items, same as any
  other per-source failure.
- **Next City is currently blocked (HTTP 403)** — confirmed live, and a
  descriptive `User-Agent` (which fixed the same symptom on The Guardian)
  didn't help, so this reads as an IP-range/ASN-level block rather than a
  header check. Contributes nothing rather than breaking anything else;
  worth revisiting later or swapping for a different source.
- The New York Times, Le Monde, and Politico feed URLs were confirmed
  live via `?debug=1` (200 OK, real item counts) after deploying — the
  tool used to build this couldn't reach those three domains directly to
  check in advance, unlike every other source here.
- Most cities most days simply won't have recent English-language
  coverage from any of these sources — "no news" is the common case,
  not a bug.
- The Worker's request-building/filtering/de-duplication logic isn't
  covered by `test/run.js` (it's a separate deployable, not part of the
  Node module graph the test suite loads) — verify it manually after
  deploying.

## Run locally

```sh
python3 -m http.server 8000    # then visit http://localhost:8000
```

Use a server, not `file://` — ES modules won't load from the filesystem.

## Deploy to GitHub Pages

1. Create a repo.
   - `<your-username>.github.io` serves at that root domain.
   - Any other name (e.g. `urbanita`) serves at `<your-username>.github.io/urbanita`.
2. Push these files to the default branch.
3. **Settings → Pages → Source: Deploy from a branch**, choose `main` and `/ (root)`.

All paths are relative, so both naming schemes work unchanged.

## Tests

```sh
node test/run.js
```

130 assertions, no npm install. Covers classification (including the subclass
walk and the batching/caching behaviour), key facts (population, country,
area, elevation, timezone — including partial/missing data and the
entity-claims cache reuse), city news (the proxy client's request shape and
pass-through of results, and rendering/omitting the news section), map
lifecycle (a single persistent instance created once, flown to each
searched/cached/back-button city rather than recreated), the light/dark
switch (including that a manual choice overrides the OS in both
directions), disambiguation, URL state, the back button, request
cancellation, XSS safety, and graceful degradation when Wikidata or the
news proxy is unreachable. The Worker itself (`worker/news-proxy.js`) is
verified manually — see its Known Limits above.

## Attribution

City content comes from Wikipedia and is licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Every result links back to its source article. News headlines come from
the Currents API and link back to the original publisher. Full credits
(Wikidata, Currents, map tiles, MapLibre, fonts) are on the site's own
`attribution.html`.

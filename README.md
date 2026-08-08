# Urbanita

A personal site with a city lookup tool. Type any city name, get a summary
pulled live from Wikipedia — and only for places that are actually cities.

No build step, no backend. Static files, which is exactly what GitHub Pages
wants — the one dependency, Leaflet, loads from a CDN with no install step.

## Status

Milestones 1–6 complete.

- [x] 1. Search + summary card
- [x] 2. Disambiguation fallback ("Did you mean…?")
- [x] 3. Shareable `?city=` URLs, back-button support
- [x] 2.5 City-only filtering via Wikidata `instance of`
- [x] 4. Wikidata infobox (population, country, area, elevation, timezone)
- [x] 5. Leaflet map (CARTO Positron/Dark Matter tiles, follows the site theme)
- [x] 6. About page, blog, attribution page

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
js/ui.js                      rendering (no network)
js/map.js                     Leaflet map lifecycle (the one third-party global)
js/theme.js                   light/dark switch (every page)
js/app.js                     wiring, URL state (index.html only)
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

109 assertions, no npm install. Covers classification (including the subclass
walk and the batching/caching behaviour), key facts (population, country,
area, elevation, timezone — including partial/missing data and the
entity-claims cache reuse), map lifecycle (attach/detach across searches,
cache hits, back button, dark-mode tile swap), the light/dark switch
(including that a manual choice overrides the OS in both directions),
disambiguation, URL state, the back button, request cancellation, XSS
safety, and graceful degradation when Wikidata is unreachable.

## Attribution

City content comes from Wikipedia and is licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Every result links back to its source article. Full credits (Wikidata, map
tiles, Leaflet, fonts) are on the site's own `attribution.html`.

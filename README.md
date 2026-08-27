# Urbanita

A personal site with a city lookup tool. Type any city name, get a summary
pulled live from Wikipedia — and only for places that are actually cities.

No build step. Static files, which is exactly what GitHub Pages wants — the
one dependency, Leaflet, loads from a CDN with no install step. The one
exception is news: it goes through a small serverless proxy (see "How city
news works" below) rather than being called directly from the browser, to
keep an API key private and results cached.

## Status

Milestones 1–9 complete.

- [x] 1. Search + summary card
- [x] 2. Disambiguation fallback ("Did you mean…?")
- [x] 3. Shareable `?city=` URLs, back-button support
- [x] 2.5 City-only filtering via Wikidata `instance of`
- [x] 4. Wikidata infobox (population, country, area, elevation, timezone)
- [x] 5. Leaflet map (CARTO Positron/Dark Matter tiles, follows the site theme)
- [x] 6. About page, blog, attribution page
- [x] 7. Fresh news per city (Currents API, via a small caching proxy)
- [x] 8. "On film" per city (Wikidata narrative/filming location)
- [x] 9. "Born here" per city (Wikidata place of birth, filtered by field)

Also: a manual light/dark switch in the footer (defaults to the OS
preference, remembered after that) on every page.

A result renders as separate surfaces rather than one long card: the city
(a full-bleed hero photograph with the name and description set into a
scrim over it, then the summary), its key facts, where it is on the map,
what's in the news, who was born there, and films set or shot there. Each
is omitted when there's nothing to put in it.

Below 1200px they stack in one column. Above it they become a collage —
facts and figures down the left, the city card in the middle, map and films
down the right, tilted a degree or two and lapping over one another, with
the news running the full width underneath them all. Everything in the
collage proper is what a city *is*; the news is what happens to be true
this week, so it reads as a footer to the rest rather than as one more
column of reference (and it breaks into columns at that width, rather than
running as a few very long lines). Cards are sized by their content, so the
composition breathes between cities rather than clipping anything. Two rail
wrappers (`display: contents` while stacked) group the columns, which is
what lets the collage close up when a city has no figures, no films or no
photograph. Stacked, the order is unchanged: the news stays third, right
after the facts.

One consequence worth knowing: Leaflet has no rotation support, so while the
map card is tilted the interactions that convert a screen point to a
coordinate (drag, double-click zoom, pinch) are disabled — `js/map.js`
follows the breakpoint and restores them below it. The +/- buttons work
throughout. The hero rewrites the width in Wikipedia's thumbnail URL to get a
usable size — see `heroImage` in `js/ui.js` for why only certain widths
work.

## On a phone

Three things behave differently on touch, all decided by the pointer rather
than the window width — an accurate pointer in a narrow window doesn't need
any of it, and a tablet doesn't escape it by being wide.

- **The map takes two fingers.** Stacked, it's a full-width band in the
  middle of a scrolling page, and Leaflet's one-finger drag swallows the
  swipe that lands on it — you try to scroll past the map and pan it
  instead. So `js/map.js` gives up one-finger dragging on a coarse pointer,
  the same trade `scrollWheelZoom: false` already makes for the wheel.
  Pinch still zooms *and* pans (Leaflet's touch-zoom handler moves the
  centre as it scales) and the +/- buttons are untouched. The map panel says
  so in its header, via a note that only renders on touch (`.panel-hint`).
- **Tap targets are ~44px.** Every control the site owns was under 36px, the
  nav links 16. The touch block near the end of `css/style.css` grows them
  with padding only, so the type stays exactly where it was and a desktop
  sees no difference at all.
- **Hover affordances stay off.** The news list's slide-in accent bar is
  behind `@media (hover: hover)`: a tap would otherwise leave :hover stuck
  on the headline it landed on, shunting the row sideways for good.

Also: each page carries a `theme-color` meta pair so the mobile browser's
own chrome takes the paper colour, and `js/theme.js` rewrites both when the
footer's switch is used — the media queries on those metas can see the OS,
but not a manual choice.

## Files

```
index.html                    home page + search
about.html                    project + author
attribution.html              full data/library/font credits
blog/index.html               journal index (no posts yet)
css/style.css                 design tokens and layout
js/wiki.js                    Wikipedia + Wikidata calls, city classification (no DOM)
js/news.js                    thin client for the news proxy, per city (no DOM)
js/films.js                   films set/shot in a city, via Wikidata SPARQL (no DOM)
js/figures.js                 people born in a city, via Wikidata SPARQL (no DOM)
js/wdqs.js                    the SPARQL request: proxy-first, deadline, cancel, retry (no DOM)
js/ui.js                      rendering (no network)
js/map.js                     Leaflet map lifecycle (the one third-party global)
js/theme.js                   light/dark switch (every page)
js/app.js                     wiring, URL state (index.html only)
worker/news-proxy.js          Cloudflare Worker, two paths: news (/) and cached Wikidata (/wikidata)
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

## How "Born here" works

`js/figures.js` asks Wikidata (WDQS) for people whose **place of birth**
(P19) is this city and whose **occupation** (P106) is one of the fields
this site is actually about, ranked by how many Wikipedias cover them —
the same "would anyone recognise this name?" stand-in the films use. No
API key and no proxy: the city's QID is already in hand, and WDQS is
public.

The occupation list (`OCCUPATIONS` in `js/figures.js`) is a flat table of
Q-IDs covering four families — the built environment (architect, urban
planner, landscape architect, architectural historian…), design (graphic,
industrial, interior, type), ecology (ecologist, environmentalist,
conservationist), and the social sciences that study cities (sociologist,
anthropologist, geographer). That table is both the filter and the labels:
the query can only return a Q-ID that's already in it, so the occupation
under each name needs no label service.

### Known limits

- **Sitelink fame is a blunt instrument.** Plenty of celebrities carry one
  of these occupations as a secondary Wikidata tag, and they outrank the
  people the section is for. Without a guard, New York's top names were
  Paris Hilton and Sienna Miller (both tagged "fashion designer") ahead of
  any sociologist, and Lisbon offered a singer tagged "architect" — so a
  short `PERFORMERS` list (singer, actor, musician, TV presenter,
  socialite, model) is subtracted from the results. It exists to stop a pop
  career outranking the city's architects, not to adjudicate who counts as
  a real designer.
- **"fashion designer" (Q3501317) is deliberately not in the table.** It
  was the biggest single source of that noise, it earned no place in the
  top six of any city tried, and it was expensive: including it took
  Barcelona from 8.3s to 25.2s and Milan to a 502.
- **Occupation is exact-matched, not walked up `subclass of`.** Same
  reason as the films query — the walk pushes the big cities past the 60s
  WDQS limit. The cost is people typed only as something more specific
  than the list.
- **Place of birth is exact too.** Someone recorded as born in a borough,
  a suburb or a hospital rather than the city itself won't appear; walking
  P131 upward is likewise too slow.
- Names are taken from the article URL with any trailing parenthetical
  removed, since on a person's article that's always a disambiguator
  ("Gisela (singer)", "Giuseppe Castiglione (Jesuit painter)"). Two people
  who share a base name therefore display identically — each link still
  goes to the right article.
- A person with several listed occupations shows the one ranking highest in
  `OCCUPATIONS`, whose **order is therefore load-bearing**: the built
  environment first, then design, ecology, and the social sciences last.
  Jane Jacobs is tagged both `urban planner` and `sociologist`, and reads
  as the former because of it. (An earlier version used `SAMPLE(?job)` and
  she genuinely alternated between the two across reloads.) Reordering that
  table reorders the preference; nothing else depends on the sequence.
- Wikidata's own tagging is occasionally generous (a politician tagged
  "sociologist"). The names are real; the label under one is only as good
  as Wikidata.
- **WDQS latency is wildly inconsistent**, which is what the Worker cache
  exists to absorb — see "Why the Wikidata queries go through the Worker"
  below.
- Measured against WDQS directly, on a good day: Porto 2.2s, Milan 2.7s,
  Lisbon 4.3s, Barcelona 8.3s, New York 13.6s. Cached by the Worker, a
  city that's been looked up before is immediate. Like the films, the
  section fills in after the card is already on screen.

## Why the Wikidata queries go through the Worker

`js/films.js` and `js/figures.js` don't call WDQS themselves any more —
`js/wdqs.js` asks the Worker's `/wikidata` route first, and only falls back
to calling WDQS directly if the Worker isn't there.

**The problem.** WDQS answers the same query in half a second or in forty,
essentially at random. Measured over seven interleaved runs, the figures
query for Berlin came in under the browser's 20s ceiling **once**; Paris
four times in seven. A section that misses renders as "this city has
nobody", which is indistinguishable from the truthful empty case.

**What didn't work.** Rewriting the query. Ranking in a subquery, dropping
the `MINUS` performer filter, and both together were all inside the noise —
run-to-run variance on one variant (Paris, 8.5s / 23.3s / 17.2s) was larger
than the gaps between variants. Berlin went from 1/7 to 2/7 under the
ceiling at best. The cost isn't the shape of the question; it's a shared
public endpoint scanning everyone born in a large city, on the critical
path of a page load, while somebody watches a skeleton. Roughly 1 request
in 9 also came back 502, independently of the query.

**What did.** Moving the query off that path. The Worker runs it
server-side with a 50s budget (nobody is watching) and caches the answer
per city for a **week** — Wikidata's answer to "who was born in Paris" does
not change hourly. Only the first visitor to a city ever waits.

Some details that matter:

- **The route takes a `kind` and a QID, never SPARQL**, so it can't be used
  as an open query endpoint. The Worker builds the query with the very same
  `filmsQuery`/`figuresQuery` builders the browser exports, so there's still
  one definition of each query rather than a copy drifting out of sync.
- **Failures are never cached; empty results are.** Caching a failure for a
  week would turn one bad minute at WDQS into a city that has nobody in it
  until next Tuesday. "No films here" is a real answer, and re-asking it
  weekly is enough.
- **The query runs inside `ctx.waitUntil`, not on the request path.**
  Cloudflare cancels a Worker when its client disconnects, so with the query
  awaited normally, a visitor who gave up took the whole thing down with
  them and nothing was cached — measured: a request abandoned after 5s left
  that city still uncached 75s later. That's exactly backwards, since the
  cities worth caching are the slow ones nobody waits for. With the work in
  `waitUntil` it outlives the browser, so a first visit that shows nothing
  still makes every later visit instant.
- **The cache is per-datacenter.** Cloudflare's `caches.default` is not
  global, so a city warmed at one colo is still cold at another. Measured
  live: a warm entry answers in 36–105ms, consistently — but a city warmed
  moments earlier occasionally re-ran anyway (Naples, 3.1s, right after two
  browser visits had warmed it), which is what an edge cache that isn't a
  single shared store looks like. On a low-traffic site that means more cold
  misses than the warm numbers suggest. The fix, if it ever matters, is
  Workers KV, which replicates globally.
- **A failed proxy is only worth going direct for when it failed *fast*.**
  A 404, a refused connection or a malformed body means the Worker is
  missing or broken, and WDQS direct is the better bet. A proxy that times
  out was waiting on the very same WDQS, so falling back would just be a
  second long wait for the same answer. That distinction is what keeps the
  worst case at roughly one ceiling's wait rather than four.
- **Until the Worker is redeployed, nothing breaks.** The old deployment
  answers `/wikidata` with a 400, which reads as a fast failure, so the site
  falls straight through to calling WDQS itself — exactly the behaviour it
  had before. Verified live.

### Redeploying after this change

The Worker now serves two paths and imports the query builders from `js/`,
so it needs `wrangler` to bundle it (the dashboard uploader can't):

```sh
cd worker
npx wrangler deploy
```

`npx wrangler deploy --dry-run --outdir /tmp/wk-out` builds it without
publishing, which is worth running first — it's how the bundling of those
`../js/` imports was confirmed (13 KB, both queries inlined).

## Run locally

```sh
python3 -m http.server 8000    # then visit http://localhost:8000
```

Use a server, not `file://` — ES modules won't load from the filesystem.

## Writing a journal post

**Add a Markdown file to `drafts/` and push it. That's the whole process.**

`.github/workflows/publish-journal.yml` turns it into `blog/<slug>.html`,
lists it on the Journal index, and commits the result back; Pages deploys
from there as usual. Nothing runs locally, so a post can be written and
published entirely from github.com — or a phone.

A draft is Markdown with two frontmatter lines:

```markdown
---
title: Changelog of a Summer project
excerpt: The road towards a complete urbanite tool
---

## A heading

The post.
```

The filename doesn't matter — the slug comes from `title`. Add an optional
`date: 2026-08-18` to backdate a post; otherwise the first publish date is
used and kept.

**To correct a post, edit its draft and push again.** Re-publishing rewrites
the post in place and updates its index entry rather than duplicating it,
keeping the date it first went out. The workflow regenerates *every* draft on
each run, which is why that has to hold. "Run workflow" in the Actions tab
regenerates everything by hand — useful after changing the post template or
the Markdown converter.

Locally, if you'd rather (needs node on PATH):

```sh
node scripts/new-draft.js "Post Title"          # -> drafts/<slug>.md
node scripts/publish-post.js drafts/<slug>.md   # -> blog/<slug>.html
```

`node scripts/new-post.js "Title" "excerpt"` scaffolds an HTML post directly,
skipping Markdown entirely.

`scripts/lib/markdown.js` is deliberately tiny and supports only what these
posts use: `##`/`###` headings, `**bold**`, `*italic*` (asterisks only — not
`_underscores_`), `` `code` ``, `[links](url)`, `- ` bullets, and ` -- ` for
an em dash. Blank lines separate blocks; consecutive lines are joined into
one paragraph. Anything beyond that, write as HTML in the generated file.

`blog/index.html` must keep its `<ul class="post-list">` even when empty —
that's the anchor `publish-post.js` inserts entries after. The "no entries
yet" line below it hides itself once the list has a post.

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

240 assertions, no npm install. Covers classification (including the subclass
walk and the batching/caching behaviour), key facts (population, country,
area, elevation, timezone — including partial/missing data and the
entity-claims cache reuse), city news (the proxy client's request shape and
pass-through of results, and rendering/omitting the news section), films
(title cleanup, the empty and unreachable cases, and that a cache hit
doesn't re-query Wikidata), figures born in the city (name cleanup,
occupation labelling including a Q-ID outside the table, and that the two
deferred sections neither cancel nor block each other), map
lifecycle (attach/detach across searches, cache hits, back button,
dark-mode tile swap, and which interactions survive a tilt or a touch
screen), the light/dark switch (including that a manual
choice overrides the OS in both directions, and reaches the `theme-color`
metas), disambiguation, URL state, the
back button, request cancellation, XSS safety, and graceful degradation
when Wikidata or the news proxy is unreachable — including that a flaky
WDQS is retried and recovers, that a genuinely dead one stops rather than
looping, that an empty result is never retried, that both sections are
served through the Worker when it's there, that a 404 or a refused
connection falls back to calling WDQS directly, and that a Worker which
merely hangs does *not* trigger that fallback. The Worker itself
(`worker/news-proxy.js`) is verified manually — see its Known Limits above.

## Attribution

City content comes from Wikipedia and is licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Every result links back to its source article. News headlines come from
the Currents API and link back to the original publisher. Full credits
(Wikidata, Currents, map tiles, Leaflet, fonts) are on the site's own
`attribution.html`.

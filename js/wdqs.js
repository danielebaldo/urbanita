/* ==========================================================================
   Urbanita — the Wikidata Query Service client
   Pure logic: no DOM access anywhere in this file.

   Both js/films.js and js/figures.js ask WDQS for a ranked list tied to a
   city's QID, and both want the same handling around it — a deadline, a
   relay so a superseded search cancels cleanly, and "an empty list is a
   valid answer, an error is not something the caller should have to think
   about". This is that shared middle.

   ---- Why this goes through the Worker ----
   WDQS answers the same question in half a second or in forty, essentially
   at random. Measured over seven interleaved runs, Berlin's figures query
   came in under 20s once; Paris four times in seven. Rewriting the query
   didn't move that: ranking in a subquery, dropping the performer filter,
   and both together were all within the noise (Berlin 1/7 vs 2/7 under 20s),
   because the cost isn't the query's shape — it's a shared public endpoint
   scanning everyone born in a large city, on the critical path of a page
   load, while somebody watches a skeleton.

   So the query moves off that path. worker/news-proxy.js runs it
   server-side, where nobody is watching, and caches the answer per city for
   a week — Wikidata's answer to "who was born in Paris" does not change
   hourly. Only the first visitor to a city ever waits.

   A first visit that gives up still isn't wasted: the Worker finishes and
   caches regardless of whether the browser is still listening, so the retry
   (or the next page load) lands on a warm cache.

   ---- Why a failed proxy is not always worth going direct for ----
   The fallback exists so the site degrades to exactly its old behaviour if
   the Worker is unreachable or hasn't been deployed yet. But it's only
   worth taking when the proxy failed *fast* — a 404, a refused connection,
   a malformed body — which means the Worker is missing or broken, and WDQS
   direct is the better bet. When the proxy fails *slowly*, it timed out
   waiting on the very same WDQS, and going direct would only be slower.
   That distinction is what keeps the worst case at roughly one ceiling's
   worth of waiting rather than four.
   ========================================================================== */

const WDQS = 'https://query.wikidata.org/sparql';

/* The same Worker that serves the news, on its own path. Until it's
   deployed this 404s, which reads as a fast failure and falls straight
   through to the direct call below — so the site behaves exactly as it did
   before the Worker existed. */
const WDQS_PROXY_URL = 'https://urbanita-news.daniele-baldo.workers.dev/wikidata';

// Matches js/wiki.js — Wikipedia asks browser clients to identify themselves
// with Api-User-Agent, since the real User-Agent is locked down by browsers.
const API_USER_AGENT = 'Urbanita/0.3 (https://urbanita.it)';

/* Per attempt, not for the pair. If the first one burned its whole budget,
   the second needs a full one to have any chance of finishing. Both of the
   sections built on this fill in after the card is already on screen, so a
   slow answer costs a skeleton that shimmers a while longer, nothing more. */
const TIMEOUT_MS = 20000;

const ATTEMPTS = 2;

/* Long enough not to hammer a service that's already struggling, short
   enough that nobody reads it as the page having given up. */
const RETRY_DELAY_MS = 500;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    }, { once: true });
  });
}

/**
 * One request, with a deadline. Throws a tagged failure carrying `slow`:
 * true when our own ceiling stopped it, false for anything that failed on
 * its own. Only the caller's own abort propagates as AbortError.
 */
async function fetchJson(url, signal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const relay = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener?.('abort', relay);
  }

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'Api-User-Agent': API_USER_AGENT }
    });
    if (!res.ok) throw new Error('responded ' + res.status);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError' && signal?.aborted) throw err;   // caller gave up
    const failure = new Error(err.message);
    failure.name = 'WdqsFailure';
    failure.slow = timedOut;
    throw failure;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', relay);
  }
}

/**
 * Run a city query and hand back its WDQS bindings — through the Worker if
 * it answers, straight to WDQS if it doesn't.
 *
 * `kind` and `qid` address the proxy (which builds the SPARQL itself, so it
 * can't be used as an open query endpoint); `sparql` is the same query for
 * the direct fallback. Always resolves to an array: a malformed response or
 * an unreachable endpoint yields [], since "nothing" is an expected, valid
 * state for both callers (most small towns have no films and nobody
 * notable), not an error they should have to handle. Only AbortError
 * propagates, and only from the caller, so a superseded search unwinds
 * cleanly.
 */
export async function queryWdqs({ kind, qid, sparql }, signal) {
  let proxyWasSlow = false;

  if (kind && qid) {
    const url = `${WDQS_PROXY_URL}?kind=${encodeURIComponent(kind)}&qid=${encodeURIComponent(qid)}`;
    for (let i = 0; i < ATTEMPTS; i++) {
      try {
        const data = await fetchJson(url, signal);
        if (Array.isArray(data?.bindings)) return data.bindings;
        break;                       // answered, but not with what we asked for
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (!err.slow) break;        // missing or broken — the direct call is better
        proxyWasSlow = true;
        if (i < ATTEMPTS - 1) await sleep(RETRY_DELAY_MS, signal);
      }
    }
  }

  // It timed out on the same WDQS we'd be calling ourselves, only with a
  // cache in front of it. Asking again directly would just be slower.
  if (proxyWasSlow) return [];

  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const data = await fetchJson(WDQS + '?format=json&query=' + encodeURIComponent(sparql), signal);
      const bindings = data?.results?.bindings;
      // A malformed body isn't worth a second round trip — the query would
      // only come back just as malformed.
      return Array.isArray(bindings) ? bindings : [];
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (i === ATTEMPTS - 1) return [];
      await sleep(RETRY_DELAY_MS, signal);
    }
  }
  return [];
}

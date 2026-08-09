/* ==========================================================================
   Urbanita — fresh news per city
   Pure logic: no DOM access anywhere in this file.

   Calls Urbanìta's own news proxy (see worker/news-proxy.js), not a news
   API directly. The proxy holds the API key, builds the actual upstream
   query, caches results per city, and returns them pre-normalized and
   de-duplicated — so this file is just a thin fetch wrapper.
   ========================================================================== */

const NEWS_PROXY_URL = 'https://urbanita-news.daniele-baldo.workers.dev/';

/**
 * Recent English-language news mentioning this city, newest first.
 * Always resolves — a malformed/empty response, or the proxy not being
 * configured yet, both yield [], since "no recent coverage" is an
 * expected, valid state (most small towns won't have any), not an error
 * the caller needs to handle specially.
 */
export async function fetchCityNews(title, country, signal) {
  const params = new URLSearchParams({ city: title, country: country || '' });

  let data;
  try {
    const res = await fetch(NEWS_PROXY_URL + '?' + params, { signal });
    if (!res.ok) return [];
    data = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return [];
  }

  return Array.isArray(data?.articles) ? data.articles : [];
}
